<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppFrame from '../../components/AppFrame.vue'
import PanelState from '../../components/PanelState.vue'
import TrendBars from '../../components/TrendBars.vue'
import { errorLabel, getStats } from '../../lib/api'
import { monthDay, numberLabel } from '../../lib/date'
import { nutrientLabels, type Nutrient, type Stats } from '../../lib/models'
import { useLife } from '../../lib/store'

const life = useLife()
const days = ref<7 | 30>(7)
const data = ref<Stats>()
const loading = ref(false)
const error = ref('')
const nutrient = ref<Nutrient>('kcal')
const exercise = ref(0)
const descriptor = computed(() => nutrientLabels.find(item => item.key === nutrient.value) || nutrientLabels[0])
const foodPoints = computed(() => data.value?.days.map(day => ({ date: day.date, value: day[nutrient.value] })) || [])
const workouts = computed(() => data.value?.days.map(day => ({ date: day.date, value: day.workouts })) || [])
const completed = computed(() => data.value?.days.map(day => ({ date: day.date, value: day.completed })) || [])
const exercises = computed(() => data.value?.exerciseTrends || [])
const weights = computed(() => exercises.value[exercise.value]?.points.map(point => ({ date: point.date, value: point.weightKg })) || [])
const nutritionTotal = computed(() => foodPoints.value.reduce((sum, point) => sum + point.value, 0))
const groups = computed(() => Object.entries(data.value?.week.groups || {}).sort((a, b) => b[1] - a[1]))
const completion = computed(() => data.value?.totals.todos ? Math.round(data.value.totals.completed / data.value.totals.todos * 100) : null)
const rangeLabel = computed(() => {
  const values = data.value?.days || []
  return values.length ? monthDay(values[0].date) + ' — ' + monthDay(values[values.length - 1].date) : ''
})
let sequence = 0

async function refresh() {
  const current = ++sequence
  loading.value = true
  error.value = ''
  try {
    const [, result] = await Promise.all([life.refreshStatus(), getStats(days.value)])
    if (current !== sequence) return
    data.value = result
    exercise.value = 0
  } catch (err) { if (current === sequence) error.value = errorLabel(err) }
  finally { if (current === sequence) loading.value = false }
}
function range(value: 7 | 30) { if (value !== days.value) { days.value = value; void refresh() } }
function pickExercise(event: { detail: { value: string | number } }) { exercise.value = Number(event.detail.value) }
onShow(refresh)
</script>

<template>
  <AppFrame active="stats">
    <view class="title-row">
      <view><text class="eyebrow">INSIGHTS</text><text class="hero-title">统计趋势</text><text class="subhead">饮食、训练和待办的变化。</text></view>
      <view class="header-actions">
        <button class="chip" :class="{ selected: days === 7 }" @tap="range(7)">最近 7 天</button>
        <button class="chip" :class="{ selected: days === 30 }" @tap="range(30)">最近 30 天</button>
      </view>
    </view>
    <PanelState v-if="error || loading" :error="error" :loading="loading" @retry="refresh" />
    <template v-else-if="data">
      <view class="range-band"><image class="icon small" src="/static/calendar.png" mode="aspectFit" /><text>{{ rangeLabel }}</text><text class="range-zone">{{ data.timezone }}</text></view>
      <view class="grid grid-four stats-metrics">
        <view class="card"><text class="metric">{{ data.week.workouts }}</text><text class="metric-label">本周训练次数</text></view>
        <view class="card"><text class="metric">{{ numberLabel(data.totals.minutes) }} <text class="metric-unit">min</text></text><text class="metric-label">累计训练时长</text></view>
        <view class="card"><text class="metric">{{ numberLabel(data.totals.volumeKg) }} <text class="metric-unit">kg</text></text><text class="metric-label">已知训练总容量</text></view>
        <view class="card"><text class="metric">{{ completion === null ? '—' : completion + '%' }}</text><text class="metric-label">待办完成率</text></view>
      </view>
      <view class="grid grid-main">
        <view class="stack">
          <view class="card">
            <view class="section-head">
              <view><text class="section-title">营养摄入趋势</text><text class="section-note">期间累计 {{ numberLabel(nutritionTotal) }} {{ descriptor.unit }}</text></view>
              <view class="icon-box diet"><image class="icon" src="/static/diet.png" mode="aspectFit" /></view>
            </view>
            <view class="inline">
              <button v-for="item in nutrientLabels" :key="item.key" class="chip" :class="{ selected: nutrient === item.key }" @tap="nutrient = item.key">{{ item.name }}</button>
            </view>
            <TrendBars :points="foodPoints" :color="descriptor.color" :unit="descriptor.unit" />
            <text class="section-note">仅合计有营养数据的食物。点击柱形查看当日数值。</text>
          </view>
          <view class="card">
            <view class="section-head"><text class="section-title">训练频率</text><view class="icon-box workout"><image class="icon" src="/static/workout.png" mode="aspectFit" /></view></view>
            <TrendBars :points="workouts" color="#657ed0" unit="次" />
            <text class="section-note">期间训练 {{ data.totals.workouts }} 次<text v-if="data.totals.estimatedKcal > 0"> · 已知估算消耗 {{ numberLabel(data.totals.estimatedKcal) }} kcal</text><text v-else> · 暂无可汇总的热量估算</text></text>
          </view>
          <view class="card">
            <view class="section-head"><text class="section-title">待办完成趋势</text><view class="icon-box todo"><image class="icon" src="/static/todo.png" mode="aspectFit" /></view></view>
            <TrendBars :points="completed" color="#cc8855" unit="项" />
            <text class="section-note">已完成 {{ data.totals.completed }} / {{ data.totals.todos }} 项</text>
          </view>
        </view>
        <view class="stack">
          <view class="card">
            <view class="section-head"><view><text class="section-title">本周训练部位</text><text class="section-note">按已记录的肌群计次</text></view></view>
            <PanelState v-if="!groups.length" title="暂无肌群数据" description="记录训练部位后即可查看。" />
            <view v-for="[name, count] in groups" :key="name" class="group-row row"><text>{{ name }}</text><text class="pill workout">{{ count }} 次</text></view>
          </view>
          <view class="card">
            <view class="section-head"><view><text class="section-title">动作重量变化</text><text class="section-note">每个训练日的已知最高组重量</text></view></view>
            <PanelState v-if="!exercises.length" title="暂无动作重量数据" />
            <template v-else>
              <picker :range="exercises" range-key="name" :value="exercise" @change="pickExercise">
                <view class="control picker-value">{{ exercises[exercise]?.name || '选择动作' }}<text class="muted">▾</text></view>
              </picker>
              <TrendBars :points="weights" color="#657ed0" unit="kg" />
            </template>
          </view>
          <view class="card">
            <view class="section-head"><text class="section-title">训练历史日历</text></view>
            <view class="activity-grid">
              <view v-for="day in data.days" :key="day.date" class="activity-day" :class="{ active: day.workouts > 0 }" :aria-label="monthDay(day.date) + '训练' + day.workouts + '次'">
                <text>{{ day.date.slice(8) }}</text>
              </view>
            </view>
            <text class="section-note">色块标记有训练记录的日期。</text>
          </view>
        </view>
      </view>
    </template>
  </AppFrame>
</template>

<style scoped>
.range-band { display: flex; gap: 7px; align-items: center; color: var(--muted); font-size: 12px; margin-bottom: 12px; }
.range-zone { margin-left: auto; }
.stats-metrics { margin-bottom: 14px; }
.metric-unit { font-size: 12px; letter-spacing: 0; }
.group-row { padding: 9px 0; border-bottom: 1px solid var(--line); }
.group-row:last-child { border-bottom: 0; }
.activity-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
.activity-day { text-align: center; border-radius: 6px; background: #f0f4f2; color: var(--muted); padding: 4px 0; font-size: 11px; }
.activity-day.active { color: #314b95; background: #dce5fc; font-weight: 700; }
@media (max-width: 550px) { .title-row { align-items: flex-start; flex-direction: column; } }
</style>