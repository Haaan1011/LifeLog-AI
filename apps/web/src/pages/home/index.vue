<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppFrame from '../../components/AppFrame.vue'
import PanelState from '../../components/PanelState.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import RecordRow from '../../components/RecordRow.vue'
import { completeTodo, errorLabel, getRecords, getStats, getSummary, toast } from '../../lib/api'
import { dateHeading, localClock, numberLabel } from '../../lib/date'
import { emptyNutrition, nutrientLabels, type Kind, type LifeRecord, type Stats, type Summary } from '../../lib/models'
import { useLife } from '../../lib/store'

const life = useLife()
const stats = ref<Stats>()
const summary = ref<Summary>()
const items = ref<LifeRecord[]>([])
const todayItems = ref<LifeRecord[]>([])
const loading = ref(false)
const error = ref('')
const today = computed(() => stats.value?.today || life.today)
const nutrition = computed(() => stats.value?.days.find(day => day.date === today.value) || emptyNutrition)
const target = computed(() => life.me?.goals.kcal ?? null)
const percent = computed(() => target.value ? Math.round(nutrition.value.kcal / target.value * 100) : null)
const difference = computed(() => target.value === null ? null : target.value - nutrition.value.kcal)
const macros = nutrientLabels.slice(1)
const todo = computed(() => todayItems.value.filter(row => row.type === 'todo').slice(0, 5))
const workout = computed(() => todayItems.value.filter(row => row.type === 'workout').slice(0, 5))
const memo = computed(() => items.value.filter(row => row.type === 'memo').slice(0, 3))
const mealRows = computed(() => todayItems.value.filter(row => row.type === 'diet').slice(0, 5))
const greeting = computed(() => {
  const hour = Number(localClock(new Date().toISOString(), life.timezone).time.slice(0, 2))
  if (hour >= 5 && hour < 11) return '早上好'
  if (hour >= 11 && hour < 18) return '下午好'
  return '晚上好'
})
const modules: { type: Kind; title: string; subtitle: string }[] = [
  { type: 'diet', title: '饮食', subtitle: '摄入与营养' },
  { type: 'workout', title: '健身', subtitle: '动作与训练' },
  { type: 'memo', title: '备忘', subtitle: '生活时间线' },
  { type: 'todo', title: '待办', subtitle: '日程与提醒' },
]

async function refresh() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [, , data, daySummary] = await Promise.all([life.refreshProfile(), life.refreshStatus(), getStats(), getSummary()])
    const [daily, latest] = await Promise.all([
      getRecords({ from: data.today, to: data.today, limit: 200 }),
      getRecords({ type: 'memo', limit: 3 }),
    ])
    stats.value = data
    summary.value = daySummary
    todayItems.value = daily.items
    items.value = latest.items
  } catch (err) { error.value = errorLabel(err) }
  finally { loading.value = false }
}
onShow(refresh)

async function toggle(row: LifeRecord) {
  if (row.type !== 'todo') return
  try { await completeTodo(row.id, !row.data.completed); await refresh() }
  catch (err) { toast(errorLabel(err), false) }
}

function goProfile() { uni.switchTab({ url: '/pages/profile/index' }) }
function goDemo() {
  uni.setStorageSync('lifelog.openDemo', true)
  goProfile()
}
</script>

<template>
  <AppFrame active="home">
    <view class="title-row">
      <view>
        <text class="eyebrow">{{ dateHeading(today) }}</text>
        <text class="hero-title">{{ greeting }}<text v-if="life.me?.name">，{{ life.me.name }}</text></text>
        <text class="subhead">这是你的今日生活概览。</text>
      </view>
      <view class="header-actions">
        <button v-if="life.status?.mode === 'demo'" class="btn demo-action" @tap="goDemo">演示入口</button>
        <button class="btn primary" @tap="life.edit()"><image class="icon small" src="/static/plus.png" mode="aspectFit" />新建记录</button>
      </view>
    </view>

    <PanelState v-if="error || (loading && !stats)" :error="error" :loading="loading" @retry="refresh" />
    <template v-else-if="stats">
      <view class="hero">
        <view class="hero-inner">
          <view class="hero-info">
            <view class="inline"><text class="live-dot" /><text class="hero-kicker">今日热量 · NUTRITION</text></view>
            <view class="calories"><text class="calorie-number">{{ numberLabel(nutrition.kcal, 0) }}</text><text class="calorie-unit">kcal</text></view>
            <text v-if="difference !== null" class="hero-meta">{{ difference >= 0 ? '距目标还剩 ' : '已超过目标 ' }}{{ numberLabel(Math.abs(difference), 0) }} kcal</text>
            <text v-else class="hero-meta">设置每日目标后可查看剩余热量</text>
            <text v-if="target !== null" class="hero-target">每日目标 {{ target }} kcal</text>
            <button v-if="target === null" class="hero-link" @tap="goProfile">设置目标 →</button>
          </view>
          <view class="hero-orbit">
            <view class="orbit-halo outer" /><view class="orbit-halo middle" />
            <view class="orbit-meter" :style="percent !== null ? { background: 'conic-gradient(#9fdec0 ' + Math.min(100, Math.max(0, percent)) + '%, #387667 0)' } : {}">
              <view class="orbit-center"><text class="orbit-number">{{ percent === null ? '—' : percent + '%' }}</text><text class="orbit-caption">目标进度</text></view>
            </view>
          </view>
        </view>
      </view>

      <view class="card macros">
        <ProgressBar v-for="entry in macros" :key="entry.key" :label="entry.name" :value="nutrition[entry.key]" :target="life.me?.goals[entry.key] ?? null" :unit="entry.unit" :color="entry.color" />
        <text v-if="stats.nutritionUnknownToday" class="macro-warning">今日有 {{ stats.nutritionUnknownToday }} 项食物缺少营养数据，合计仅含已知数值。</text>
      </view>

      <view class="grid grid-four modules">
        <button v-for="entry in modules" :key="entry.type" class="card module" @tap="life.viewRecords(entry.type)">
          <view class="icon-box" :class="entry.type"><image class="icon" :src="'/static/' + entry.type + '.png'" mode="aspectFit" /></view>
          <view class="module-copy"><text class="section-title">{{ entry.title }}</text><text class="module-desc">{{ entry.subtitle }}</text></view>
          <image class="icon small module-arrow" src="/static/arrow.png" mode="aspectFit" />
        </button>
      </view>

      <view class="grid grid-main">
        <view class="stack">
          <view class="card">
            <view class="section-head">
              <view>
                <text class="section-title">今日待办</text>
                <text class="section-note">今天有 {{ summary?.todoCount ?? 0 }} 项任务需要完成。</text>
                <text v-if="summary?.dueReminders" class="pill todo reminder-badge">{{ summary.dueReminders }} 项提醒已到时间</text>
              </view>
              <button class="btn ghost small" @tap="life.viewRecords('todo')">全部待办 →</button>
            </view>
            <RecordRow v-for="row in todo" :key="row.id" :record="row" :today="today" compact @open="life.edit(row.type, row.id)" @toggle="toggle(row)" />
            <PanelState v-if="!todo.length" title="今天还没有待办" description="添加想完成的事项，在这里更新进度。"><button class="btn small" @tap="life.edit('todo')">新建待办</button></PanelState>
          </view>
          <view class="card">
            <view class="section-head"><text class="section-title">最近备忘</text><button class="btn ghost small" @tap="life.viewRecords('memo')">生活时间线 →</button></view>
            <RecordRow v-for="row in memo" :key="row.id" :record="row" compact @open="life.edit(row.type, row.id)" />
            <PanelState v-if="!memo.length" title="留下今天的第一条记录" description="一句想法、一次会议，或者一张照片。" />
          </view>
        </view>
        <view class="stack">
          <view class="card">
            <view class="section-head"><text class="section-title">今日训练</text><button class="btn ghost small" @tap="life.viewRecords('workout')">训练记录 →</button></view>
            <RecordRow v-for="row in workout" :key="row.id" :record="row" compact @open="life.edit(row.type, row.id)" />
            <PanelState v-if="!workout.length" title="今天还没有训练记录"><button class="btn small" @tap="life.edit('workout')">添加训练</button></PanelState>
          </view>
          <view class="card">
            <view class="section-head"><text class="section-title">今日饮食</text><button class="btn ghost small" @tap="life.viewRecords('diet')">饮食记录 →</button></view>
            <RecordRow v-for="row in mealRows" :key="row.id" :record="row" compact @open="life.edit(row.type, row.id)" />
            <PanelState v-if="!mealRows.length" title="今天还没有饮食记录"><button class="btn small" @tap="life.edit('diet')">添加饮食</button></PanelState>
          </view>
        </view>
      </view>
    </template>
  </AppFrame>
</template>

<style scoped>
.hero { overflow: hidden; border-radius: 21px; background: #174c41; background: linear-gradient(118deg, #123b35, #1a604f); color: #f3fcf7; margin-bottom: 12px; }
.hero-inner { position: relative; display: flex; justify-content: space-between; align-items: center; min-height: 183px; padding: 21px 18px; }
.hero-info { z-index: 2; min-width: 0; }
.hero-info .inline { flex-wrap: nowrap; gap: 6px; }
.live-dot { width: 7px; height: 7px; border-radius: 99px; background: #a2dfbd; }
.hero-kicker { font-size: 10px; letter-spacing: .12em; color: #c3e7d4; font-weight: 700; }
.calories { display: flex; align-items: baseline; gap: 8px; margin: 6px 0; }
.calorie-number { color: #f3fcf7; font-weight: 680; font-size: 43px; line-height: 1.08; letter-spacing: -.06em; font-variant-numeric: tabular-nums; }
.calorie-unit { color: #c5ead8; font-size: 14px; }
.hero-meta { color: #e0f3eb; font-size: 11px; display: block; }
.hero-target { color: #c0e8d6; font-size: 11px; display: block; margin-top: 5px; }
.hero-link { color: #d9f4e5; font-size: 12px; font-weight: 700; background: #ffffff1a; border-radius: 7px; padding: 4px 8px; margin-top: 9px; display: inline-flex; }
.hero-orbit { position: relative; flex: none; display: flex; align-items: center; justify-content: center; width: 105px; height: 105px; margin: 0 6px; }
.orbit-meter { z-index: 1; width: 94px; height: 94px; display: flex; align-items: center; justify-content: center; border-radius: 99px; background: #3e7669; }
.orbit-center { width: 79px; height: 79px; display: flex; align-items: center; justify-content: center; flex-direction: column; border-radius: 99px; background: #215b4c; }
.orbit-number { color: #f3fcf7; font-size: 22px; line-height: 1.1; font-weight: 730; letter-spacing: -.05em; }
.orbit-caption { color: #c0e8d6; font-size: 10px; margin-top: 4px; }
.orbit-halo { position: absolute; border: 1px solid #b1f2d124; width: 155px; height: 155px; border-radius: 50%; }
.orbit-halo.outer { width: 201px; height: 201px; }
.macros { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 12px; }
.macro-warning { grid-column: 1 / -1; font-size: 11px; color: #805c34; }
.modules { margin: 12px 0; }
.module { display: flex; align-items: center; gap: 8px; text-align: left; padding: 11px; }
.module .section-title { font-size: 14px; }
.module-desc { display: block; color: var(--muted); font-size: 10px; font-weight: 400; white-space: nowrap; }
.module-arrow { display: none; margin-left: auto; }
.reminder-badge { margin-top: 6px; }
@media (max-width: 430px) {
  .title-row { align-items: flex-start; flex-direction: column; }
  .header-actions { width: 100%; justify-content: flex-start; }
}
@media (max-width: 350px) {
  .hero-orbit { width: 83px; margin: 0 3px; }
  .orbit-meter { width: 80px; height: 80px; }
  .orbit-center { width: 66px; height: 66px; }
  .hero-kicker { letter-spacing: .07em; }
}
@media (min-width: 550px) {
  .hero-inner { padding: 24px 28px; }
  .calorie-number { font-size: 54px; }
  .hero-orbit { margin-right: 25px; }
  .macros { padding: 16px; gap: 22px; }
  .module { padding: 12px; }
}
@media (min-width: 1000px) {
  .hero { margin-bottom: 14px; }
  .hero-inner { min-height: 188px; padding: 23px 30px; }
  .hero-meta { font-size: 12px; }
  .hero-orbit { margin-right: 57px; }
  .orbit-meter { width: 110px; height: 110px; }
  .orbit-center { width: 92px; height: 92px; }
  .orbit-halo { width: 166px; height: 166px; }
  .orbit-halo.outer { width: 232px; height: 232px; }
  .macros { padding: 16px 20px; }
  .modules { margin: 16px 0; }
  .module { padding: 13px; }
  .module-arrow { display: block; }
}
</style>
