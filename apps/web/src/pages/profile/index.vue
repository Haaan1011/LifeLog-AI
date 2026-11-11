<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppFrame from '../../components/AppFrame.vue'
import PanelState from '../../components/PanelState.vue'
import { clearSession, demoSender, errorLabel, exportCalendar, exportData, getJob, getJobs, makeBindCode, newMessageId, removeAccount, retryJob, saveExport, sendDemo, toast, updateGoals, updateMe, type DemoInput } from '../../lib/api'
import { localClock } from '../../lib/date'
import { goalLabels, nutrientLabels, type DemoReply, type Goals, type Job, type Me, type Nutrient } from '../../lib/models'
import { useLife } from '../../lib/store'

const life = useLife()
const name = ref('')
const zone = ref('Asia/Shanghai')
const weight = ref('')
const goalMode = ref<Goals['mode']>('maintain')
const goalValues = ref<Record<Nutrient, string>>({ kcal: '', protein: '', carbs: '', fat: '' })
const goalModes = Object.keys(goalLabels) as Goals['mode'][]
const binding = ref<{ code: string; expiresAt: string }>()
const demoText = ref('')
const demoPhoto = ref('')
const jobs = ref<Job[]>([])
const reply = ref<DemoReply>()
const last = ref<DemoInput>()
const loading = ref(false)
const busy = ref('')
const error = ref('')
const formError = ref('')
const demoError = ref('')
const jobError = ref('')
const modeLabel = computed(() => life.status?.ai === 'remote' ? '在线 AI' : life.status?.ai === 'local' ? '本地演示解析器' : '未配置')
const connected = computed(() => life.me?.bound)
const demo = computed(() => life.status?.mode === 'demo')
const statusLabels: Record<string, string> = { unbound: '等待绑定', queued: '等待处理', pending: '等待处理', processing: '整理中', done: '已保存', failed: '处理失败', bound: '绑定成功', rejected: '绑定未成功' }
const templates = [
  { label: '早餐示例', value: '今天早餐吃了两个鸡蛋、一杯250ml牛奶和两片面包。' },
  { label: '训练示例', value: '今天练胸，杠铃卧推60kg，4组，每组10次；哑铃飞鸟12kg，3组12次。' },
  { label: '混合示例', value: '今天下午做了实验，晚上练了腿，明天上午十点交报告。' },
]

function populate(value: Me) {
  name.value = value.name
  zone.value = value.timezone
  weight.value = value.weightKg == null ? '' : String(value.weightKg)
  goalMode.value = value.goals.mode
  for (const entry of nutrientLabels) {
    const goal = value.goals[entry.key]
    goalValues.value[entry.key] = goal == null ? '' : String(goal)
  }
}
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const [me] = await Promise.all([life.refreshProfile(), life.refreshStatus()])
    populate(me)
    await refreshJobs()
    const focus = uni.getStorageSync('lifelog.openDemo')
    if (focus) {
      uni.removeStorageSync('lifelog.openDemo')
      await nextTick()
      setTimeout(() => uni.pageScrollTo({ selector: '#demo-console', duration: 250 }), 50)
    }
  } catch (err) { error.value = errorLabel(err) }
  finally { loading.value = false }
}
onShow(refresh)

function optionalNumber(value: string, label: string) {
  if (String(value).trim() === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(label + '请输入大于 0 的数值。')
  return number
}
async function run(key: string, fn: () => Promise<void>, demoAction = false) {
  if (busy.value) return
  busy.value = key
  const target = demoAction ? demoError : formError
  target.value = ''
  try { await fn() } catch (err) { target.value = errorLabel(err) }
  finally { busy.value = '' }
}
function saveProfile() {
  void run('profile', async () => {
    if (!name.value.trim()) throw new Error('请填写昵称。')
    new Intl.DateTimeFormat('zh-CN', { timeZone: zone.value.trim() }).format(new Date())
    life.me = await updateMe({ name: name.value.trim(), timezone: zone.value.trim(), weightKg: optionalNumber(weight.value, '体重') })
    populate(life.me)
    toast('资料已保存')
  })
}
function saveGoals() {
  void run('goals', async () => {
    life.me = await updateGoals({
      mode: goalMode.value,
      kcal: optionalNumber(goalValues.value.kcal, '热量'),
      protein: optionalNumber(goalValues.value.protein, '蛋白质'),
      carbs: optionalNumber(goalValues.value.carbs, '碳水化合物'),
      fat: optionalNumber(goalValues.value.fat, '脂肪'),
    })
    populate(life.me)
    toast('目标已保存')
  })
}
function makeCode() {
  void run('binding', async () => { binding.value = await makeBindCode() })
}
function copyCode() {
  if (binding.value) uni.setClipboardData({ data: '绑定 ' + binding.value.code })
}
function refreshBinding() {
  void run('refresh', async () => { await life.refreshProfile(); toast(life.me?.bound ? '公众号已绑定' : '尚未绑定', Boolean(life.me?.bound)) })
}
function pickPhoto() {
  uni.chooseImage({
    count: 1, sizeType: ['compressed', 'original'], sourceType: ['album', 'camera'],
    success: result => {
      const path = Array.isArray(result.tempFilePaths) ? result.tempFilePaths[0] : result.tempFilePaths
      if (path) demoPhoto.value = path
    },
  })
}

async function refreshJobs() {
  try {
    jobs.value = (await getJobs()).items
    jobError.value = ''
  } catch (err) { jobError.value = errorLabel(err) }
}

async function followJob(id: string) {
  for (let attempt = 0; attempt < 9; attempt++) {
    const job = await getJob(id)
    if (reply.value?.jobId === id) reply.value = { ...reply.value, status: job.status }
    if (job.status === 'done' || job.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 450))
  }
  await refreshJobs()
}

async function deliver(input: DemoInput) {
  last.value = input
  const response = await sendDemo(input)
  reply.value = response
  if (response.status === 'bound') {
    await life.refreshProfile()
    binding.value = undefined
  }
  if (response.jobId) await followJob(response.jobId)
  else await refreshJobs()
}

function send() {
  void run('send', async () => {
    if (!demoText.value.trim() && !demoPhoto.value) throw new Error('请输入文字或选择一张图片。')
    await deliver({ sender: await demoSender(), messageId: newMessageId(), text: demoText.value.trim(), image: demoPhoto.value || undefined })
    demoText.value = ''
    demoPhoto.value = ''
  }, true)
}
function demoBind() {
  void run('demo-bind', async () => {
    if (!binding.value || Date.parse(binding.value.expiresAt) <= Date.now()) binding.value = await makeBindCode()
    await deliver({ sender: await demoSender(), messageId: newMessageId(), text: '绑定 ' + binding.value.code })
  }, true)
}
function resend() {
  const input = last.value
  if (input) void run('resend', () => deliver(input), true)
}
function retry(id: string) {
  void run('retry', async () => { await retryJob(id); await followJob(id) })
}
function exportJson() {
  void run('export', async () => {
    const data = await exportData()
    await saveExport('lifelog-' + life.today + '.json', JSON.stringify(data, null, 2), 'application/json')
    toast('已准备数据文件')
  })
}
function exportIcs() {
  void run('calendar', async () => {
    await saveExport('lifelog-' + life.today + '.ics', await exportCalendar(), 'text/calendar')
    toast('已准备日历文件')
  })
}
async function deleteMe() {
  const confirmed = await new Promise<boolean>(resolve => uni.showModal({
    title: '永久删除账户？', content: '记录、目标、绑定关系和已存储的图片将被删除。', confirmText: '删除账户', confirmColor: '#a44237',
    success: response => resolve(response.confirm), fail: () => resolve(false),
  }))
  if (!confirmed) return
  void run('remove', async () => {
    await removeAccount()
    clearSession()
    life.me = undefined
    binding.value = undefined
    jobs.value = []
    last.value = undefined
    reply.value = undefined
    toast('账户已删除')
    uni.reLaunch({ url: '/pages/home/index' })
  })
}
</script>

<template>
  <AppFrame active="profile">
    <view class="title-row">
      <view><text class="eyebrow">SETTINGS</text><text class="hero-title">我的</text><text class="subhead">管理个人资料、目标与微信连接。</text></view>
      <text v-if="life.status" class="pill good">{{ demo ? '演示工作台' : '正式工作台' }}</text>
    </view>
    <PanelState v-if="error || loading" :error="error" :loading="loading" @retry="refresh" />
    <template v-else-if="life.me">
      <view v-if="formError" class="tip error profile-alert">{{ formError }}</view>
      <view class="grid grid-main">
        <view class="stack">
          <view class="card">
            <view class="section-head"><view><text class="section-title">个人资料</text><text class="section-note">体重用于计算训练能量消耗的估算值。</text></view><view class="icon-box"><image class="icon" src="/static/profile.png" mode="aspectFit" /></view></view>
            <view class="form-grid">
              <view class="field"><text class="field-label">昵称</text><input v-model="name" class="control" maxlength="50" placeholder="你的昵称" aria-label="昵称" /></view>
              <view class="field"><text class="field-label">体重（kg）</text><input v-model="weight" class="control" type="digit" placeholder="选填" aria-label="体重（kg）" /></view>
            </view>
            <view class="field zone-field"><text class="field-label">时区</text><input v-model="zone" class="control" maxlength="80" placeholder="Asia/Shanghai" aria-label="时区" /><text class="section-note">使用 IANA 时区名称，例如 Asia/Shanghai 或 America/New_York。</text></view>
            <view class="end form-actions"><button class="btn" :disabled="!!busy" @tap="saveProfile">{{ busy === 'profile' ? '保存中…' : '保存资料' }}</button></view>
          </view>
          <view class="card">
            <view class="section-head"><view><text class="section-title">每日营养目标</text><text class="section-note">自行填写目标，留空的项目不计算目标进度。</text></view><view class="icon-box diet"><image class="icon" src="/static/diet.png" mode="aspectFit" /></view></view>
            <view class="inline goal-modes">
              <button v-for="mode in goalModes" :key="mode" class="chip" :class="{ selected: goalMode === mode }" @tap="goalMode = mode">{{ goalLabels[mode] }}</button>
            </view>
            <view class="form-grid">
              <view v-for="entry in nutrientLabels" :key="entry.key" class="field">
                <text class="field-label">{{ entry.name }}（{{ entry.unit }}）</text>
                <input :id="'goal-' + entry.key" v-model="goalValues[entry.key]" class="control" type="digit" placeholder="未设置" :aria-label="entry.name + '目标'" />
              </view>
            </view>
            <view class="end form-actions"><button id="goal-save" class="btn primary" :disabled="!!busy" @tap="saveGoals">{{ busy === 'goals' ? '保存中…' : '保存目标' }}</button></view>
          </view>
        </view>

        <view class="stack">
          <view class="card">
            <view class="section-head"><text class="section-title">公众号绑定</text><text class="pill" :class="{ good: connected }">{{ connected ? '已绑定' : '未绑定' }}</text></view>
            <view v-if="connected" class="tip">{{ demo ? '模拟公众号已关联到当前演示账户。' : '公众号消息会整理到当前账户。' }}</view>
            <template v-else>
              <text class="section-note">生成短期绑定码，然后向公众号发送「绑定 绑定码」。</text>
              <view v-if="binding" class="bind-code">
                <text class="code-value">{{ binding.code }}</text>
                <text class="section-note">有效至 {{ localClock(binding.expiresAt, life.timezone).time }}</text>
              </view>
              <view class="inline form-actions">
                <button class="btn small" :disabled="!!busy" @tap="makeCode">{{ binding ? '重新生成' : '生成绑定码' }}</button>
                <button v-if="binding" class="btn small" @tap="copyCode">复制指令</button>
                <button class="btn ghost small" :disabled="!!busy" @tap="refreshBinding">刷新状态</button>
              </view>
            </template>
          </view>
          <view class="card">
            <view class="section-head"><text class="section-title">连接状态</text><view class="icon-box"><image class="icon" src="/static/link.png" mode="aspectFit" /></view></view>
            <view class="row status-row"><text>文本解析</text><text class="pill">{{ modeLabel }}</text></view>
            <view class="row status-row"><text>多模态识别</text><text class="pill">{{ life.status?.vision ? '已配置' : '未配置' }}</text></view>
            <view class="row status-row"><text>微信回调</text><text class="pill">{{ life.status?.wechat ? '已配置' : '未配置' }}</text></view>
            <view class="row status-row"><text>待办提醒</text><text class="pill">应用内查看</text></view>
          </view>
        </view>
      </view>

      <view v-if="demo" id="demo-console" class="card demo-console">
        <view class="section-head">
          <view><text class="eyebrow">LOCAL MESSAGE CONSOLE</text><text class="section-title">模拟公众号</text><text class="section-note">在这里发送文字或图片，体验消息入库与自动整理。当前使用{{ modeLabel }}。</text></view>
          <view class="icon-box diet"><image class="icon" src="/static/inbox.png" mode="aspectFit" /></view>
        </view>
        <view v-if="!connected" class="tip warning bind-tip"><view class="row"><text>请先绑定模拟公众号。绑定前收到的消息会等待关联。</text><button id="demo-bind" class="btn small" :disabled="!!busy" @tap="demoBind">{{ busy === 'demo-bind' ? '绑定中…' : '模拟绑定' }}</button></view></view>
        <view class="inline demo-examples"><button v-for="example in templates" :key="example.label" class="chip" @tap="demoText = example.value">{{ example.label }}</button></view>
        <textarea id="demo-text" v-model="demoText" class="control" auto-height maxlength="4000" placeholder="像在公众号聊天一样输入一段话…" aria-label="模拟公众号文字" />
        <image v-if="demoPhoto" class="demo-photo" :src="demoPhoto" mode="aspectFit" />
        <view class="inline form-actions">
          <button id="demo-image" class="btn" :disabled="!!busy" @tap="pickPhoto">{{ demoPhoto ? '更换图片' : '上传图片' }}</button>
          <button v-if="demoPhoto" class="btn ghost" @tap="demoPhoto = ''">移除图片</button>
          <button id="demo-send" class="btn primary" :disabled="!!busy" @tap="send">{{ busy === 'send' ? '处理中…' : '发送消息' }}</button>
          <button v-if="last" id="demo-resend" class="btn" :disabled="!!busy" @tap="resend">重复投递</button>
        </view>
        <view v-if="demoError" class="tip error demo-result">{{ demoError }}</view>
        <view v-if="reply" id="demo-result" class="tip demo-result">
          <view class="inline"><text class="bold">{{ statusLabels[reply.status] || reply.status }}</text><text v-if="reply.duplicate" class="pill good">已去重</text></view>
          <text class="section-note">{{ reply.reply }}</text>
          <button v-if="reply.status === 'done'" class="btn ghost small" @tap="life.viewRecords()">查看记录 →</button>
        </view>
      </view>

      <view class="card activity-card">
        <view class="section-head"><view><text class="section-title">消息处理记录</text><text class="section-note">查看解析进度或重试失败的任务。</text></view><button class="btn small" @tap="refreshJobs">刷新</button></view>
        <PanelState v-if="jobError" :error="jobError" @retry="refreshJobs" />
        <PanelState v-else-if="!jobs.length" title="还没有消息任务" />
        <view v-for="job in jobs" :key="job.id" class="job-row row">
          <view><text class="bold">{{ statusLabels[job.status] || job.status }}</text><text class="section-note">{{ job.source === 'demo' ? '模拟公众号' : '微信公众号' }} · {{ localClock(job.createdAt, life.timezone).date }} {{ localClock(job.createdAt, life.timezone).time }} · {{ job.attempts }} 次处理</text><text v-if="job.error" class="job-error wrap">{{ job.error }}</text></view>
          <button v-if="job.status === 'failed'" class="btn small" :disabled="!!busy" @tap="retry(job.id)">重试</button>
        </view>
      </view>

      <view class="card">
        <view class="section-head"><view><text class="section-title">数据与隐私</text><text class="section-note">记录默认私有。在线 AI 已启用时，消息内容会发送给配置的模型服务处理。</text></view></view>
        <view class="inline">
          <button class="btn" :disabled="!!busy" @tap="exportJson">导出个人数据</button>
          <button class="btn" :disabled="!!busy" @tap="exportIcs">导出系统日历</button>
          <button class="btn danger" :disabled="!!busy" @tap="deleteMe">删除账户</button>
        </view>
      </view>
    </template>
  </AppFrame>
</template>

<style scoped>
.profile-alert { margin-bottom: 12px; }
.zone-field, .goal-modes { margin-top: 12px; }
.goal-modes { margin-bottom: 12px; }
.status-row, .job-row { padding: 9px 0; border-bottom: 1px solid var(--line); }
.status-row:last-child, .job-row:last-child { border-bottom: 0; }
.bind-code { margin-top: 10px; border: 1px dashed #cce3d8; border-radius: 10px; background: #eff7f2; padding: 10px; }
.code-value { color: var(--accent); font-size: 20px; font-weight: 700; letter-spacing: .17em; }
.demo-console, .activity-card { margin-top: 14px; }
.demo-console { scroll-margin-top: 14px; }
.demo-console .section-title { margin-top: 4px; }
.demo-examples, .demo-result, .demo-photo { margin-top: 10px; }
.demo-examples { margin-bottom: 8px; }
.demo-photo { display: block; width: 140px; height: 95px; background: #f1f5f2; border-radius: 9px; }
.job-error { display: block; color: #963d33; font-size: 12px; margin-top: 4px; }
</style>
