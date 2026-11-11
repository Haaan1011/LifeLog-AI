<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import PanelState from '../../components/PanelState.vue'
import { completeTodo, deleteRecord, errorLabel, getRecord, readPhoto, saveRecord, toast } from '../../lib/api'
import { localClock, toUtc } from '../../lib/date'
import { intensityLabels, kinds, labels, mealLabels, nutrientLabels, priorityLabels, repeatLabels, type DietItem, type Kind, type LifeRecord, type Nutrient, type Nutrition, type RecordInput, type WorkoutExercise } from '../../lib/models'
import { useLife } from '../../lib/store'

const life = useLife()
const type = ref<Kind>('memo')
const record = ref<LifeRecord>()
const id = ref('')
const title = ref('')
const content = ref('')
const eventDate = ref('')
const note = ref('')
const review = ref(false)
const tags = ref('')
const meal = ref<keyof typeof mealLabels>('unknown')
const duration = ref('')
const muscles = ref('')
const intensity = ref<keyof typeof intensityLabels | ''>('')
const repeat = ref<keyof typeof repeatLabels>('none')
const priority = ref<keyof typeof priorityLabels>('normal')
const photo = ref('')
const photoError = ref('')
let unloaded = false
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const saveError = ref('')
const meals = Object.keys(mealLabels) as (keyof typeof mealLabels)[]
const priorities = Object.keys(priorityLabels) as (keyof typeof priorityLabels)[]
const repeats = Object.keys(repeatLabels) as (keyof typeof repeatLabels)[]
const intensities = Object.keys(intensityLabels) as (keyof typeof intensityLabels)[]
const timeFields = [
  { key: 'startAt', label: '开始时间' },
  { key: 'dueAt', label: '截止时间' },
  { key: 'remindAt', label: '提醒时间' },
] as const
type TimeField = typeof timeFields[number]['key']
const dates = ref<Record<TimeField, { date: string; time: string }>>({
  startAt: { date: '', time: '' }, dueAt: { date: '', time: '' }, remindAt: { date: '', time: '' },
})
interface FoodForm {
  name: string; quantity: string; unit: string; grams: string; originalGrams: string; cooking: string; estimated: boolean
  manual: boolean; nutrition: Record<Nutrient, string>; current: Nutrition | null; source: string
}
interface ExerciseForm { name: string; sets: { weight: string; reps: string }[] }
const foods = ref<FoodForm[]>([])
const exercises = ref<ExerciseForm[]>([])
const timezone = computed(() => record.value?.timezone || life.timezone)
const source = computed(() => record.value?.source === 'wechat' ? '微信公众号' : record.value?.source === 'demo' ? '模拟公众号' : '手动记录')
let topInset = 0
// #ifdef MP-WEIXIN
topInset = uni.getWindowInfo().statusBarHeight ?? 0
// #endif

function field(value?: number | null) { return value == null ? '' : String(value) }
function foodRow(item?: DietItem): FoodForm {
  return {
    name: item?.name || '', quantity: field(item?.quantity), unit: item?.unit || '', grams: field(item?.grams), originalGrams: field(item?.grams),
    cooking: item?.cooking || '', estimated: Boolean(item?.estimated), manual: Boolean(item?.manualNutrition),
    nutrition: { kcal: field(item?.nutrition?.kcal), protein: field(item?.nutrition?.protein), carbs: field(item?.nutrition?.carbs), fat: field(item?.nutrition?.fat) },
    current: item?.nutrition || null, source: item?.nutritionSource || '',
  }
}
function exerciseRow(item?: WorkoutExercise): ExerciseForm {
  return { name: item?.name || '', sets: item?.sets.map(set => ({ weight: field(set.weightKg), reps: field(set.reps) })) || [{ weight: '', reps: '' }] }
}
function mapRecord(value: LifeRecord) {
  record.value = value
  title.value = value.title
  content.value = value.content
  eventDate.value = value.eventDate
  note.value = value.note || ''
  review.value = value.status === 'review'
  type.value = value.type
  if (value.type === 'diet') {
    meal.value = value.data.meal
    foods.value = value.data.items.map(foodRow)
  }
  if (value.type === 'workout') {
    duration.value = field(value.data.durationMinutes)
    muscles.value = value.data.muscleGroups.join('、')
    intensity.value = value.data.intensity || ''
    exercises.value = value.data.exercises.map(exerciseRow)
  }
  if (value.type === 'memo') tags.value = value.data.tags.join('、')
  if (value.type === 'todo') {
    priority.value = value.data.priority || 'normal'
    repeat.value = value.data.repeat || 'none'
    for (const entry of timeFields) {
      const time = value.data[entry.key]
      if (time) dates.value[entry.key] = localClock(time, value.timezone)
    }
  }
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    if (id.value) {
      const value = await getRecord(id.value)
      mapRecord(value)
      if (value.imageId) {
        try {
          const path = await readPhoto(value.imageId)
          if (unloaded) releasePhoto(path)
          else photo.value = path
        } catch (err) { photoError.value = errorLabel(err) }
      }
    } else {
      await life.refreshProfile()
      eventDate.value = life.today
    }
  } catch (err) { error.value = errorLabel(err) }
  finally { loading.value = false }
}
onLoad(options => {
  if (options?.id) id.value = options.id
  const initial = options?.type as Kind
  if (kinds.includes(initial)) changeType(initial)
  void refresh()
})
function releasePhoto(path: string) {
  // #ifdef H5
  if (path.startsWith('blob:')) URL.revokeObjectURL(path)
  // #endif
}
onUnload(() => { unloaded = true; releasePhoto(photo.value) })

function changeType(value: Kind) {
  type.value = value
  if (value === 'diet' && !foods.value.length) foods.value.push(foodRow())
  if (value === 'workout' && !exercises.value.length) exercises.value.push(exerciseRow())
}
function back() {
  uni.navigateBack({ fail: () => life.viewRecords() })
}
function number(value: string, label: string, integer = false) {
  if (String(value).trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) throw new Error(label + '格式不正确。')
  return parsed
}
function splitList(value: string) { return [...new Set(value.split(/[,，、\s]+/).map(word => word.trim().replace(/^#/, '')).filter(Boolean))] }
function dietPayload(): DietItem[] {
  return foods.value.filter(item => item.name.trim() || item.grams || item.quantity).map(item => {
    if (!item.name.trim()) throw new Error('请填写食物名称。')
    let nutrition: Nutrition | undefined
    if (item.manual) {
      const kcal = number(item.nutrition.kcal, '热量')
      const protein = number(item.nutrition.protein, '蛋白质')
      const carbs = number(item.nutrition.carbs, '碳水化合物')
      const fat = number(item.nutrition.fat, '脂肪')
      if (kcal === null || protein === null || carbs === null || fat === null) throw new Error('手动营养数据需填写四项数值。')
      nutrition = { kcal, protein, carbs, fat }
    }
    const grams = number(item.grams, '份量')
    if (grams === 0) throw new Error('食物份量应大于 0 克。')
    return {
      name: item.name.trim(), quantity: number(item.quantity, '数量'), unit: item.unit.trim(),
      grams, cooking: item.cooking.trim(), estimated: item.estimated, nutrition, manualNutrition: item.manual,
    }
  })
}
function workoutPayload(): WorkoutExercise[] {
  return exercises.value.filter(entry => entry.name.trim() || entry.sets.some(set => set.weight || set.reps)).map(entry => {
    if (!entry.name.trim()) throw new Error('请填写训练动作名称。')
    return {
      name: entry.name.trim(),
      sets: entry.sets.filter(set => set.weight || set.reps).map(set => ({ weightKg: number(set.weight, '重量'), reps: number(set.reps, '次数', true) })),
    }
  })
}
function utc(key: TimeField) {
  const value = dates.value[key]
  if (!value.date && !value.time) return null
  if (!value.date || !value.time) throw new Error('请同时填写日期和时间，或清除该时间。')
  return toUtc(value.date, value.time, timezone.value)
}
function payload(): RecordInput {
  const body = { title: title.value.trim(), content: content.value.trim(), note: note.value.trim(), eventDate: eventDate.value, status: review.value ? 'review' as const : 'confirmed' as const }
  if (!body.title || !body.eventDate) throw new Error('请填写标题并选择记录日期。')
  switch (type.value) {
    case 'diet': return { ...body, type: 'diet', data: { meal: meal.value, items: dietPayload() } }
    case 'workout': return { ...body, type: 'workout', data: { durationMinutes: number(duration.value, '时长'), muscleGroups: splitList(muscles.value), intensity: intensity.value || null, exercises: workoutPayload() } }
    case 'memo': return { ...body, type: 'memo', data: { tags: splitList(tags.value) } }
    case 'todo': return {
      ...body, type: 'todo',
      data: { startAt: utc('startAt'), dueAt: utc('dueAt'), remindAt: utc('remindAt'), repeat: repeat.value, priority: priority.value, completed: record.value?.type === 'todo' ? record.value.data.completed : false },
    }
  }
}
async function save() {
  if (busy.value) return
  busy.value = true
  saveError.value = ''
  try {
    await saveRecord(payload(), id.value || undefined)
    toast('记录已保存')
    back()
  } catch (err) { saveError.value = errorLabel(err) }
  finally { busy.value = false }
}
async function remove() {
  if (busy.value || !id.value) return
  const confirmed = await new Promise<boolean>(resolve => uni.showModal({
    title: '删除这条记录？', content: '删除后，相关统计会自动更新。', confirmText: '删除', confirmColor: '#a44237',
    success: value => resolve(value.confirm), fail: () => resolve(false),
  }))
  if (!confirmed) return
  busy.value = true
  try { await deleteRecord(id.value); toast('已删除'); back() }
  catch (err) { saveError.value = errorLabel(err) }
  finally { busy.value = false }
}
async function toggleCompletion() {
  if (!record.value || record.value.type !== 'todo' || busy.value) return
  busy.value = true
  try {
    const result = await completeTodo(record.value.id, !record.value.data.completed)
    record.value = result.record
    toast(result.next ? '已生成下次待办' : '任务状态已更新')
  } catch (err) { saveError.value = errorLabel(err) }
  finally { busy.value = false }
}
function previewPhoto() { if (photo.value) uni.previewImage({ urls: [photo.value] }) }
function setTime(key: TimeField, fieldName: 'date' | 'time', event: { detail: { value: string } }) {
  dates.value[key][fieldName] = event.detail.value
}
function switchValue(event: Event) { return (event as CustomEvent<{ value: boolean }>).detail.value }
function setReview(event: Event) { review.value = !switchValue(event) }
function setEstimated(item: FoodForm, event: Event) { item.estimated = switchValue(event) }
function setManual(item: FoodForm, event: Event) { item.manual = switchValue(event) }
</script>

<template>
  <view class="editor">
    <view v-if="topInset" :style="{ height: topInset + 'px' }" />
    <view class="editor-nav"><button class="btn" @tap="back">‹ 返回</button><text class="eyebrow">LIFELOG AI</text></view>
    <view class="title-row">
      <view>
        <text class="eyebrow">RECORD EDITOR</text><text class="hero-title">{{ id ? '编辑记录' : '新建记录' }}</text>
        <text class="subhead">{{ id ? source + ' · ' + timezone : '选择分类，记录具体的生活细节。' }}</text>
      </view>
      <text v-if="record" class="pill" :class="record.type">{{ labels[record.type] }}</text>
    </view>
    <PanelState v-if="error || loading" :error="error" :loading="loading" @retry="refresh" />
    <template v-else>
      <view class="card">
        <view v-if="!id || record?.status === 'review'" class="inline kind-select">
          <button v-for="kind in kinds" :key="kind" class="chip" :class="{ selected: type === kind }" @tap="changeType(kind)">
            <image class="icon small" :src="'/static/' + kind + '.png'" mode="aspectFit" />{{ labels[kind] }}
          </button>
        </view>
        <view class="form-grid">
          <view class="field"><text class="field-label">标题</text><input id="record-title" v-model="title" class="control" maxlength="120" placeholder="为这条记录起个名字" aria-label="标题" /></view>
          <view class="field"><text class="field-label">日期</text><picker mode="date" :value="eventDate" @change="eventDate = $event.detail.value"><view class="control picker-value">{{ eventDate || '选择日期' }}<image class="icon small" src="/static/calendar.png" mode="aspectFit" /></view></picker></view>
        </view>
        <view class="field editor-content"><text class="field-label">内容</text><textarea id="record-content" v-model="content" class="control" auto-height maxlength="4000" placeholder="记录发生的事" aria-label="内容" /></view>
        <view class="field"><text class="field-label">备注</text><input v-model="note" class="control" maxlength="500" placeholder="补充细节（可选）" aria-label="备注" /></view>
        <view v-if="record?.status === 'review'" class="tip warning review-box">
          <view class="row"><text>AI 标记这条记录需要确认。检查信息后可标为已确认。</text><switch :checked="!review" color="#176c55" @change="setReview" /></view>
        </view>
      </view>

      <view v-if="type === 'diet'" class="card">
        <view class="section-head">
          <view><text class="section-title">餐次与食物</text><text class="section-note">修改克数后会重新计算可查到的营养数据。</text></view>
          <button class="btn small" @tap="foods.push(foodRow())">添加食物</button>
        </view>
        <view class="field"><text class="field-label">餐次</text><picker :range="meals.map(key => mealLabels[key])" :value="meals.indexOf(meal)" @change="meal = meals[Number($event.detail.value)]"><view class="control picker-value">{{ mealLabels[meal] }}<text class="muted">▾</text></view></picker></view>
        <view v-for="(item, index) in foods" :key="index" class="editor-block">
          <view class="row editor-block-head"><text class="bold">食物 {{ index + 1 }}</text><button class="btn ghost small" @tap="foods.splice(index, 1)">移除</button></view>
          <view class="form-grid">
            <view class="field"><text class="field-label">食物名称</text><input :id="'food-name-' + index" v-model="item.name" class="control" maxlength="80" placeholder="例如 米饭" aria-label="食物名称" /></view>
            <view class="field"><text class="field-label">份量（克）</text><input :id="'food-grams-' + index" v-model="item.grams" class="control" type="digit" placeholder="例如 150" aria-label="份量（克）" /></view>
            <view class="field"><text class="field-label">数量</text><input v-model="item.quantity" class="control" type="digit" placeholder="可选" aria-label="食物数量" /></view>
            <view class="field"><text class="field-label">数量单位</text><input v-model="item.unit" class="control" maxlength="12" placeholder="例如 个、碗" aria-label="数量单位" /></view>
            <view class="field"><text class="field-label">烹饪方式</text><input v-model="item.cooking" class="control" maxlength="40" placeholder="例如 水煮" aria-label="烹饪方式" /></view>
            <view class="field"><text class="field-label">份量为估计值</text><switch :checked="item.estimated" color="#176c55" @change="setEstimated(item, $event)" /></view>
          </view>
          <view v-if="item.current && !item.manual" class="tip nutrition-tip">
            <text>{{ item.grams === item.originalGrams ? '保存的营养数据' : '当前显示上次保存的数值' }} · {{ item.current.kcal }} kcal · 蛋白质 {{ item.current.protein }}g · 碳水 {{ item.current.carbs }}g · 脂肪 {{ item.current.fat }}g</text>
            <text v-if="item.source" class="section-note wrap">{{ item.source }}</text>
          </view>
          <view class="row manual-switch"><text class="field-label">手动填写营养数据</text><switch :checked="item.manual" color="#176c55" @change="setManual(item, $event)" /></view>
          <view v-if="item.manual" class="form-grid">
            <view v-for="entry in nutrientLabels" :key="entry.key" class="field">
              <text class="field-label">{{ entry.name }}（{{ entry.unit }}）</text><input v-model="item.nutrition[entry.key]" class="control" type="digit" :aria-label="entry.name" />
            </view>
          </view>
        </view>
      </view>

      <view v-if="type === 'workout'" class="card">
        <view class="section-head">
          <view><text class="section-title">训练动作</text><text class="section-note">逐组记录重量和次数，支持不同组使用不同重量。</text></view>
          <button class="btn small" @tap="exercises.push(exerciseRow())">添加动作</button>
        </view>
        <view class="form-grid">
          <view class="field"><text class="field-label">训练部位</text><input v-model="muscles" class="control" maxlength="100" placeholder="例如 胸、肩" aria-label="训练部位" /></view>
          <view class="field"><text class="field-label">时长（分钟）</text><input v-model="duration" class="control" type="digit" placeholder="可选" aria-label="训练时长" /></view>
        </view>
        <view class="inline intensity">
          <text class="field-label">主观强度</text>
          <button class="chip" :class="{ selected: !intensity }" @tap="intensity = ''">未填写</button>
          <button v-for="value in intensities" :key="value" class="chip" :class="{ selected: intensity === value }" @tap="intensity = value">{{ intensityLabels[value] }}</button>
        </view>
        <view v-for="(exercise, index) in exercises" :key="index" class="editor-block">
          <view class="row editor-block-head"><text class="bold">动作 {{ index + 1 }}</text><button class="btn ghost small" @tap="exercises.splice(index, 1)">移除动作</button></view>
          <input v-model="exercise.name" class="control" maxlength="80" placeholder="例如 杠铃卧推" aria-label="动作名称" />
          <view v-for="(set, setIndex) in exercise.sets" :key="setIndex" class="set-row">
            <text class="pill workout">{{ setIndex + 1 }}</text>
            <input v-model="set.weight" class="control" type="digit" placeholder="重量（kg）" aria-label="重量（kg）" />
            <input v-model="set.reps" class="control" type="number" placeholder="次数" aria-label="次数" />
            <button class="btn small" aria-label="移除本组" @tap="exercise.sets.splice(setIndex, 1)">×</button>
          </view>
          <button class="btn small add-set" @tap="exercise.sets.push({ weight: '', reps: '' })">添加一组</button>
        </view>
        <text v-if="record?.type === 'workout' && record.data.estimatedKcal != null" class="section-note">估算消耗 {{ record.data.estimatedKcal }} kcal</text>
        <text v-else class="section-note">热量消耗需提供体重、训练时长和强度，显示为估算值。</text>
      </view>

      <view v-if="type === 'memo'" class="card">
        <view class="section-head"><view><text class="section-title">备忘标签</text><text class="section-note">使用逗号或空格分隔，可在记录页搜索。</text></view><view class="icon-box memo"><image class="icon" src="/static/memo.png" mode="aspectFit" /></view></view>
        <input v-model="tags" class="control" maxlength="200" placeholder="例如 论文、组会" aria-label="备忘标签" />
      </view>

      <view v-if="type === 'todo'" class="card">
        <view class="section-head"><view><text class="section-title">待办与提醒</text><text class="section-note">提醒时间可留空。当前在小程序内查看，也可导出到系统日历。</text></view><view class="icon-box todo"><image class="icon" src="/static/todo.png" mode="aspectFit" /></view></view>
        <view class="form-grid">
          <view class="field"><text class="field-label">优先级</text><picker :range="priorities.map(key => priorityLabels[key])" :value="priorities.indexOf(priority)" @change="priority = priorities[Number($event.detail.value)]"><view class="control picker-value">{{ priorityLabels[priority] }}<text class="muted">▾</text></view></picker></view>
          <view class="field"><text class="field-label">重复规则</text><picker :range="repeats.map(key => repeatLabels[key])" :value="repeats.indexOf(repeat)" @change="repeat = repeats[Number($event.detail.value)]"><view class="control picker-value">{{ repeatLabels[repeat] }}<text class="muted">▾</text></view></picker></view>
        </view>
        <view v-for="entry in timeFields" :key="entry.key" class="field time-field">
          <text class="field-label">{{ entry.label }}</text>
          <view class="time-grid">
            <picker mode="date" :value="dates[entry.key].date || eventDate" @change="setTime(entry.key, 'date', $event)"><view class="control picker-value">{{ dates[entry.key].date || '选择日期' }}</view></picker>
            <picker mode="time" :value="dates[entry.key].time || '09:00'" @change="setTime(entry.key, 'time', $event)"><view class="control picker-value">{{ dates[entry.key].time || '选择时间' }}</view></picker>
            <button v-if="dates[entry.key].date || dates[entry.key].time" class="btn small" @tap="dates[entry.key] = { date: '', time: '' }">清除</button>
          </view>
        </view>
        <button v-if="record?.type === 'todo'" class="btn form-actions" :disabled="busy" @tap="toggleCompletion">{{ record.data.completed ? '取消完成' : '标为完成' }}</button>
      </view>

      <view v-if="record?.rawMessageId" class="card">
        <view class="section-head"><text class="section-title">原始消息</text><text class="pill">{{ source }}</text></view>
        <text v-if="record.originalText" class="wrap muted">{{ record.originalText }}</text>
        <image v-if="photo" class="photo" :src="photo" mode="aspectFit" @tap="previewPhoto" />
        <text v-if="photoError" class="section-note">{{ photoError }}</text>
        <text v-if="record.aiVersion" class="section-note">解析版本 {{ record.aiVersion }}<text v-if="record.confidence != null"> · 置信度 {{ Math.round(record.confidence * 100) }}%</text></text>
      </view>
      <view v-if="saveError" class="tip error action-error">{{ saveError }}</view>
      <view class="end form-actions">
        <button v-if="id" id="record-delete" class="btn danger" :disabled="busy" @tap="remove">删除记录</button>
        <button id="record-save" class="btn primary" :disabled="busy" @tap="save">{{ busy ? '处理中…' : '保存记录' }}</button>
      </view>
    </template>
  </view>
</template>

<style scoped>
.editor { max-width: 790px; min-height: 100vh; margin: 0 auto; padding: 0 18px 36px; }
.editor-nav { min-height: 58px; display: flex; align-items: center; gap: 12px; margin-bottom: 9px; }
.editor-nav .btn { min-height: 33px; }
.editor-content { margin-top: 12px; }
.kind-select { margin-bottom: 15px; }
.review-box, .action-error { margin-top: 13px; }
.editor-block { border-radius: 12px; border: 1px solid #e6eeea; margin-top: 13px; padding: 12px; }
.editor-block-head { margin-bottom: 9px; }
.nutrition-tip, .manual-switch, .intensity { margin-top: 12px; }
.manual-switch .field-label, .intensity .field-label { margin: 0; }
.set-row { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) auto; gap: 7px; align-items: center; margin-top: 8px; }
.add-set { margin-top: 9px; }
.time-field { margin-top: 12px; }
.time-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: center; gap: 7px; }
.photo { display: block; width: 100%; max-width: 460px; height: 225px; margin-top: 10px; background: #f3f7f5; border-radius: 12px; }
@media (min-width: 780px) { .editor { padding-top: 18px; } }
</style>
