<script setup lang="ts">
defineProps<{ error?: string; loading?: boolean; title?: string; description?: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <view class="state" :class="{ error }">
    <image v-if="!error && !loading" class="icon empty-icon" src="/static/inbox.png" mode="aspectFit" />
    <text class="bold">{{ error ? '暂时无法加载' : loading ? '正在同步数据…' : title || '暂无记录' }}</text>
    <text v-if="error || description" class="small-text wrap">{{ error || description }}</text>
    <button v-if="error" class="btn small" @tap="$emit('retry')">重试</button>
    <slot />
  </view>
</template>