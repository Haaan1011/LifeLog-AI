<script setup lang="ts">
import { computed } from 'vue'
import { numberLabel } from '../lib/date'

const props = defineProps<{ label: string; value: number; target: number | null; unit: string; color: string }>()
const percent = computed(() => props.target && props.target > 0 ? Math.round(props.value / props.target * 100) : null)
const width = computed(() => Math.min(100, Math.max(0, percent.value || 0)) + '%')
</script>

<template>
  <view class="progress-row">
    <view class="row">
      <text class="bold small-text">{{ label }}</text>
      <text class="muted small-text numeric">{{ numberLabel(value) }}{{ unit }}<text v-if="target"> / {{ target }}{{ unit }}</text></text>
    </view>
    <view class="progress-track"><view class="progress-fill" :style="{ width, background: color }" /></view>
    <text v-if="percent !== null" class="micro">{{ percent }}%{{ percent > 100 ? ' · 已超过目标' : '' }}</text>
    <text v-else class="micro">目标未设置</text>
  </view>
</template>

<style scoped>
.progress-row { min-width: 0; }
.progress-track { height: 6px; border-radius: 99px; overflow: hidden; background: #edf2ef; margin: 7px 0 3px; }
.progress-fill { height: 100%; border-radius: 99px; }
@media (max-width: 350px) {
  .progress-row .row { align-items: flex-start; flex-direction: column; gap: 2px; }
}
</style>
