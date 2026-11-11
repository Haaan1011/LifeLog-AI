<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppFrame from '../../components/AppFrame.vue'
import MonthCalendar from '../../components/MonthCalendar.vue'
import PanelState from '../../components/PanelState.vue'
import RecordRow from '../../components/RecordRow.vue'
import { completeTodo, errorLabel, getRecords, summarizeMemo, toast } from '../../lib/api'
import { dateHeading, shiftDay } from '../../lib/date'
import { kinds, labels, type Kind, type LifeRecord } from '../../lib/models'
import { useLife } from '../../lib/store'

const life = useLife()
const filters: { id: Kind | 'all'; label: string }[] = [{ id: 'all', label: '全部' }, ...kinds.map(id => ({ id, label: labels[id] }))]
const scopes = [{ id: 'all', label: '全部' }, { id: 'today', label: '今日' }, { id: 'tomorrow', label: '明日' }, { id: 'week', label: '本周' }, { id: 'done', label: '已完成' }, { id: 'overdue', label: '已逾期' }] as const
const rows = ref<LifeRecord[]>([])
const total = ref(0)
const offset = ref(0)
const loading = ref(false)
const error = ref('')
const search = ref('')
const q = ref('')
const from = ref('')
const to = ref('')
const scope = ref<typeof scopes[number]['id']>('all')
const showCalendar = ref(false)
const month = ref(life.today.slice(0, 7))
const marked = ref<string[]>([])
const memoSummary = ref<{ date: string; text: string; provider: 'local' | 'remote'; count: number }>()
const summaryLoading = ref(false)
let sequence = 0

const groups = computed(() => {
  const result = new Map<string, LifeRecord[]>()
  for (const record of rows.value) {
    if (record.type === 'todo' && scope.value === 'done' && !record.data.completed) continue
    if (record.type === 'todo' && scope.value === 'overdue' && (record.data.completed || !(record.data.dueAt ? new Date(record.data.dueAt).getTime() < Date.now() : record.eventDate < life.today))) continue
    if (!result.has(record.eventDate)) result.set(record.eventDate, [])
    result.get(record.eventDate)!.push(record)
  }
  return [...result.entries()].map(([date, items]) => ({ date, items }))
})
const selectedDate = computed(() => from.value && from.value === to.value ? from.value : '')
const calendarStart = computed(() => month.value + '-01')
const calendarEnd = computed(() => shiftDay(moveMonthValue(1) + '-01', -1))
const type = computed(() => life.filter === 'all' ? undefined : life.filter)

function moveMonthValue(delta: number) {
  const date = new Date(month.value + '-01T00:00:00Z')
  date.setUTCMonth(date.getUTCMonth() + delta)
  return date.toISOString().slice(0, 7)
}

async function refresh(append = false) {
  const current = ++sequence
  loading.value = true
  error.value = ''
  if (!append) { rows.value = []; offset.value = 0; total.value = 0 }
  try {
    if (from.value && to.value && from.value > to.value) throw new Error('起始日期应早于结束日期。')
    const query = { type: type.value, from: from.value, to: to.value, q: q.value.trim(), limit: 60, offset: offset.value }
    const clientTodoFilter = type.value === 'todo' && (scope.value === 'done' || scope.value === 'overdue')
    let response = await getRecords(query)
    if (clientTodoFilter) {
      const items = [...response.items]
      while (items.length < response.total && current === sequence && response.items.length) {
        response = await getRecords({ ...query, limit: 200, offset: items.length })
        items.push(...response.items)
      }
      response = { items, total: items.length }
    }
    if (current !== sequence) return
    total.value = response.total
    rows.value = append ? [...rows.value, ...response.items] : response.items
    offset.value = rows.value.length
  } catch (err) { if (current === sequence) error.value = errorLabel(err) }
  finally { if (current === sequence) loading.value = false }
}

async function refreshCalendar() {
  if (!showCalendar.value) return
  const requested = month.value
  const requestedType = type.value
  try {
    const query = { type: requestedType, from: calendarStart.value, to: calendarEnd.value, limit: 200 }
    const page = await getRecords(query)
    const dates = new Set(page.items.map(item => item.eventDate))
    for (let next = page.items.length; next < page.total && month.value === requested && type.value === requestedType;) {
      const batch = await getRecords({ ...query, offset: next })
      if (!batch.items.length) break
      for (const item of batch.items) dates.add(item.eventDate)
      next += batch.items.length
    }
    if (month.value === requested && type.value === requestedType) marked.value = [...dates]
  } catch (err) { toast(errorLabel(err), false) }
}

function changeFilter(value: Kind | 'all') {
  if (life.filter === value) return
  life.filter = value
}
watch(() => life.filter, () => {
  if (scope.value !== 'all') { from.value = ''; to.value = '' }
  scope.value = 'all'
  memoSummary.value = undefined
  void refresh()
  void refreshCalendar()
})

onShow(async () => {
  try { await Promise.all([life.refreshProfile(), life.refreshStatus()]) } catch { /* 列表加载独立显示错误 */ }
  await refresh()
  await refreshCalendar()
})

function applySearch() { q.value = search.value; void refresh() }
function pickDate(event: { detail: { value: string } }, which: 'from' | 'to') {
  if (which === 'from') from.value = event.detail.value
  else to.value = event.detail.value
  scope.value = 'all'
  memoSummary.value = undefined
  void refresh()
}
function clearDates() {
  from.value = ''
  to.value = ''
  scope.value = 'all'
  memoSummary.value = undefined
  void refresh()
}
function changeScope(value: typeof scopes[number]['id']) {
  scope.value = value
  const today = life.today
  if (value === 'today') { from.value = today; to.value = today }
  else if (value === 'tomorrow') { from.value = shiftDay(today, 1); to.value = from.value }
  else if (value === 'week') {
    const day = new Date(today + 'T00:00:00Z').getUTCDay()
    from.value = shiftDay(today, -((day + 6) % 7))
    to.value = shiftDay(from.value, 6)
  } else { from.value = ''; to.value = '' }
  void refresh()
}
function toggleCalendar() {
  showCalendar.value = !showCalendar.value
  if (showCalendar.value) {
    month.value = (from.value || life.today).slice(0, 7)
    void refreshCalendar()
  }
}
function moveMonth(delta: number) { month.value = moveMonthValue(delta); marked.value = []; void refreshCalendar() }
function selectDay(value: string) {
  from.value = value
  to.value = value
  scope.value = 'all'
  memoSummary.value = undefined
  const nextMonth = value.slice(0, 7)
  if (month.value !== nextMonth) { month.value = nextMonth; void refreshCalendar() }
  void refresh()
}
async function dailySummary() {
  summaryLoading.value = true
  try { memoSummary.value = await summarizeMemo(selectedDate.value || life.today) }
  catch (err) { toast(errorLabel(err), false) }
  finally { summaryLoading.value = false }
}
async function toggle(row: LifeRecord) {
  if (row.type !== 'todo') return
  try {
    await completeTodo(row.id, !row.data.completed)
    await refresh()
    await refreshCalendar()
  } catch (err) { toast(errorLabel(err), false) }
}
</script>

<template>
  <AppFrame active="records">
    <view class="title-row">
      <view><text class="eyebrow">JOURNAL</text><text class="hero-title">生活记录</text><text class="subhead">按分类或日期找回每一笔记录。</text></view>
      <button class="btn primary" @tap="life.edit(type)"><image class="icon small" src="/static/plus.png" mode="aspectFit" />新建记录</button>
    </view>

    <view class="card filters-card">
      <view class="inline">
        <button v-for="item in filters" :key="item.id" class="chip" :class="{ selected: life.filter === item.id }" @tap="changeFilter(item.id)">{{ item.label }}</button>
      </view>
      <view class="filter-search">
        <input id="records-search" v-model="search" class="control" confirm-type="search" maxlength="160" placeholder="搜索标题、正文或标签" aria-label="搜索记录" @confirm="applySearch" />
        <button class="btn" @tap="applySearch"><image class="icon small" src="/static/search.png" mode="aspectFit" />搜索</button>
      </view>
      <view v-if="life.filter === 'todo'" class="inline task-scopes">
        <button v-for="item in scopes" :key="item.id" class="chip" :class="{ selected: scope === item.id }" @tap="changeScope(item.id)">{{ item.label }}</button>
      </view>
      <view class="dates">
        <picker mode="date" :value="from || life.today" @change="pickDate($event, 'from')"><view class="control picker-value">{{ from || '起始日期' }}</view></picker>
        <text class="muted">至</text>
        <picker mode="date" :value="to || life.today" @change="pickDate($event, 'to')"><view class="control picker-value">{{ to || '结束日期' }}</view></picker>
        <button class="btn" @tap="toggleCalendar"><image class="icon small" src="/static/calendar.png" mode="aspectFit" />{{ showCalendar ? '收起' : '日历' }}</button>
        <button v-if="from || to" class="btn ghost small" @tap="clearDates">清除日期</button>
      </view>
      <view v-if="showCalendar" class="calendar"><MonthCalendar :month="month" :selected="selectedDate" :marked="marked" :today="life.today" @move="moveMonth" @select="selectDay" /></view>
    </view>

    <view v-if="life.filter === 'memo'" class="card">
      <view class="section-head">
        <view><text class="section-title">每日生活总结</text><text class="section-note">{{ selectedDate ? dateHeading(selectedDate) : '今天' }} · 基于当天的备忘记录</text></view>
        <button class="btn" :disabled="summaryLoading" @tap="dailySummary">{{ summaryLoading ? '整理中…' : '生成总结' }}</button>
      </view>
      <view v-if="memoSummary" class="tip wrap">{{ memoSummary.text }}<text class="section-note">{{ memoSummary.count }} 条备忘 · {{ memoSummary.provider === 'local' ? '本地归纳' : '在线 AI' }}</text></view>
    </view>

    <view class="list-area">
      <PanelState v-if="error || (loading && !groups.length)" :error="error" :loading="loading" @retry="refresh()" />
      <PanelState v-else-if="!groups.length" title="这里还没有记录" description="试试其他筛选条件，或添加一条新记录。"><button class="btn small" @tap="life.edit(type)">添加记录</button></PanelState>
      <view v-for="group in groups" :key="group.date" class="card record-group">
        <view class="section-head group-heading"><text class="section-title">{{ dateHeading(group.date) }}</text><text class="pill">{{ group.items.length }} 条</text></view>
        <RecordRow v-for="row in group.items" :key="row.id" :record="row" :today="life.today" @open="life.edit(row.type, row.id)" @toggle="toggle(row)" />
      </view>
      <button v-if="offset < total && !error" class="btn wide more" :disabled="loading" @tap="refresh(true)">{{ loading ? '加载中…' : '加载更多' }}</button>
    </view>
  </AppFrame>
</template>

<style scoped>
.filters-card { margin-bottom: 12px; }
.filter-search { display: flex; gap: 8px; margin-top: 12px; }
.filter-search input { flex: 1; }
.task-scopes { margin-top: 12px; }
.dates { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
.dates .control { font-size: 12px; min-width: 98px; }
.calendar { max-width: 480px; margin: 14px auto 0; }
.list-area { margin-top: 14px; }
.group-heading { margin-bottom: 4px; }
.record-group { padding-top: 14px; padding-bottom: 9px; }
.more { margin-top: 12px; }
@media (max-width: 430px) { .title-row { align-items: flex-start; flex-direction: column; } }
</style>