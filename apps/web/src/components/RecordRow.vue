<script setup lang="ts">
import { computed } from 'vue'
import { localClock, numberLabel } from '../lib/date'
import { labels, mealLabels, priorityLabels, repeatLabels, type LifeRecord } from '../lib/models'

const props = defineProps<{ record: LifeRecord; compact?: boolean; today?: string }>()
defineEmits<{ open: []; toggle: [] }>()

const details = computed(() => {
  const item = props.record
  switch (item.type) {
    case 'diet': return [mealLabels[item.data.meal], ...item.data.items.map(entry => entry.name + (entry.grams ? ' ' + entry.grams + 'g' : ''))].join(' · ')
    case 'workout': return [...item.data.muscleGroups, ...item.data.exercises.map(exercise => exercise.name), item.data.durationMinutes ? item.data.durationMinutes + ' 分钟' : '', item.data.volumeKg ? numberLabel(item.data.volumeKg) + ' kg 容量' : ''].filter(Boolean).join(' · ')
    case 'memo': return item.data.tags.map(tag => '#' + tag).join(' ')
    case 'todo': {
      const due = item.data.dueAt ? localClock(item.data.dueAt, item.timezone) : null
      const reminder = item.data.remindAt ? localClock(item.data.remindAt, item.timezone) : null
      const repeat = item.data.repeat && item.data.repeat !== 'none' ? repeatLabels[item.data.repeat] : ''
      return [due ? '截止 ' + due.date + ' ' + due.time : '', reminder ? '提醒 ' + reminder.date + ' ' + reminder.time : '', repeat, item.data.priority === 'high' ? priorityLabels.high + '优先级' : ''].filter(Boolean).join(' · ')
    }
  }
})

const overdue = computed(() => props.record.type === 'todo' && !props.record.data.completed
  && (props.record.data.dueAt ? new Date(props.record.data.dueAt).getTime() < Date.now() : !!props.today && props.record.eventDate < props.today))
</script>

<template>
  <view class="record-row" :class="{ compact }">
    <button v-if="record.type === 'todo'" class="check-button" :class="{ checked: record.data.completed }" :aria-label="record.data.completed ? '取消完成' : '标为完成'" @tap.stop="$emit('toggle')">
      <image v-if="record.data.completed" class="icon small" src="/static/check.png" mode="aspectFit" />
    </button>
    <view v-else class="icon-box" :class="record.type"><image class="icon" :src="'/static/' + record.type + '.png'" mode="aspectFit" /></view>
    <button class="record-button" @tap="$emit('open')">
      <view class="row">
        <text class="record-name" :class="{ done: record.type === 'todo' && record.data.completed }">{{ record.title }}</text>
        <text v-if="record.status === 'review'" class="pill review">待确认</text>
        <text v-else-if="overdue" class="pill review">已逾期</text>
        <text v-else-if="!compact" class="pill" :class="record.type">{{ labels[record.type] }}</text>
      </view>
      <text v-if="record.content && record.content !== record.title" class="record-content">{{ record.content }}</text>
      <text v-if="details || record.imageId" class="record-details">{{ details }}{{ record.imageId ? (details ? ' · ' : '') + '含图片' : '' }}</text>
    </button>
    <image class="icon small record-arrow" src="/static/arrow.png" mode="aspectFit" />
  </view>
</template>

<style scoped>
.record-row { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-bottom: 1px solid var(--line); }
.record-row:last-child { border-bottom: 0; }
.record-row.compact { padding: 8px 0; }
.record-button { flex: 1; background: transparent; text-align: left; min-width: 0; color: var(--ink); line-height: 1.35; font-weight: 400; }
.record-name { display: block; font-size: 14px; font-weight: 720; overflow-wrap: anywhere; }
.record-name.done { text-decoration: line-through; color: var(--muted); }
.record-content { display: block; font-size: 12px; color: var(--muted); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.record-details { display: block; font-size: 11px; color: var(--faint); margin-top: 3px; overflow-wrap: anywhere; }
.record-arrow { opacity: .75; }
.check-button { width: 27px; height: 27px; border-radius: 8px; border: 1px solid #dedfd7; background: #fffdfa; display: flex; align-items: center; justify-content: center; flex: none; }
.check-button.checked { background: #e1f3e6; border-color: #c5dfcf; }
</style>
