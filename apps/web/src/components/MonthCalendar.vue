<script setup lang="ts">
import { computed } from 'vue'
import { shiftDay } from '../lib/date'

const props = defineProps<{ month: string; selected: string; today: string; marked: string[] }>()
defineEmits<{ move: [delta: number]; select: [date: string] }>()
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const monthLabel = computed(() => props.month.slice(0, 4) + '年' + Number(props.month.slice(5)) + '月')
const cells = computed(() => {
  const start = props.month + '-01'
  const day = new Date(start + 'T00:00:00Z').getUTCDay()
  const first = shiftDay(start, -(day + 6) % 7)
  return Array.from({ length: 42 }, (_, index) => shiftDay(first, index))
})
</script>

<template>
  <view>
    <view class="row calendar-head">
      <button class="btn small" aria-label="上一月" @tap="$emit('move', -1)">‹</button>
      <text class="bold">{{ monthLabel }}</text>
      <button class="btn small" aria-label="下一月" @tap="$emit('move', 1)">›</button>
    </view>
    <view class="calendar-grid">
      <text v-for="day in weekdays" :key="day" class="weekday">{{ day }}</text>
      <button v-for="day in cells" :key="day" class="day" :class="{ outside: !day.startsWith(month), selected: day === selected, today: day === today }" :aria-label="day" @tap="$emit('select', day)">
        {{ Number(day.slice(8)) }}<view v-if="marked.includes(day)" class="mark" />
      </button>
    </view>
  </view>
</template>

<style scoped>
.calendar-head { margin-bottom: 12px; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
.weekday { text-align: center; color: var(--muted); font-size: 12px; }
.day { position: relative; min-height: 34px; border-radius: 7px; color: var(--ink); background: #f5f8f6; font-size: 13px; }
.day.outside { opacity: .45; }
.day.today { box-shadow: inset 0 0 0 1px #8db7a8; }
.day.selected { background: var(--accent); color: #fff; }
.mark { position: absolute; bottom: 3px; left: calc(50% - 2px); width: 4px; height: 4px; background: #2d9c75; border-radius: 100%; }
.day.selected .mark { background: #bfedda; }
</style>