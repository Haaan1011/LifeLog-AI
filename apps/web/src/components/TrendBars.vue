<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { monthDay, numberLabel } from '../lib/date'

const props = defineProps<{ points: { date: string; value: number }[]; color: string; unit: string }>()
const selected = ref(-1)
const peak = computed(() => Math.max(1, ...props.points.map(point => point.value)))
const summary = computed(() => selected.value >= 0 ? props.points[selected.value] : props.points.at(-1))
watch(() => props.points, () => { selected.value = -1 })
const shouldLabel = (index: number) => props.points.length <= 7 || index === props.points.length - 1 || (index % 7 === 0 && index < props.points.length - 4)
</script>

<template>
  <view v-if="points.length" class="trend">
    <view class="row trend-top">
      <text class="muted small-text">{{ summary ? monthDay(summary.date) : '' }}</text>
      <text class="bold numeric">{{ summary ? numberLabel(summary.value) : '—' }} {{ unit }}</text>
    </view>
    <view class="trend-plot">
      <view class="trend-guides"><view /><view /><view /></view>
      <button v-for="(point, index) in points" :key="point.date" class="trend-column" :aria-label="monthDay(point.date) + ' ' + numberLabel(point.value) + ' ' + unit" @tap="selected = index">
        <view class="trend-bar" :style="{ height: Math.max(2, point.value / peak * 100) + '%', backgroundColor: point.value ? color : '#dbe7e2', opacity: selected < 0 || index === selected ? 1 : .58 }" />
      </button>
    </view>
    <view class="trend-ticks">
      <view v-for="(point, index) in points" :key="point.date" class="trend-tick">
        <text v-if="shouldLabel(index)" class="micro">{{ point.date.slice(5).replace('-', '/') }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.trend-top { margin: 12px 0 6px; }
.trend-plot, .trend-ticks { display: flex; gap: 2px; position: relative; }
.trend-plot { height: 118px; border-bottom: 1px solid #dce8e2; align-items: flex-end; }
.trend-guides { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-evenly; pointer-events: none; }
.trend-guides > view { border-top: 1px dashed #e6eeea; }
.trend-column { flex: 1; display: flex; align-items: flex-end; justify-content: center; height: 100%; background: transparent; min-width: 0; z-index: 1; }
.trend-bar { width: 67%; max-width: 34px; border-radius: 4px 4px 0 0; }
.trend-tick { flex: 1; text-align: center; white-space: nowrap; min-width: 0; }
.trend-tick:last-child { display: flex; justify-content: flex-end; }
</style>
