<script setup lang="ts">
import { useLife } from '../lib/store'

const props = defineProps<{ active: 'home' | 'stats' | 'records' | 'profile' }>()
const life = useLife()
const tabs = [
  { id: 'home', label: '首页' }, { id: 'stats', label: '统计' },
  { id: 'records', label: '记录' }, { id: 'profile', label: '我的' },
] as const
let topInset = 0
// #ifdef MP-WEIXIN
topInset = uni.getWindowInfo().statusBarHeight ?? 0
// #endif

function go(page: typeof tabs[number]['id']) {
  if (page === props.active) return
  if (page === 'records') life.filter = 'all'
  uni.switchTab({ url: '/pages/' + page + '/index' })
}
</script>

<template>
  <view class="frame">
    <view class="rail">
      <view class="brand">
        <image class="brand-icon" src="/static/brand.png" mode="aspectFit" />
        <view>
          <text class="brand-title">LifeLog AI</text>
          <text class="brand-sub">个人生活日志</text>
        </view>
      </view>
      <view class="rail-nav">
        <text class="eyebrow rail-label">工作台</text>
        <button v-for="tab in tabs" :key="tab.id" class="rail-item" :class="{ current: active === tab.id }" @tap="go(tab.id)">
          <image class="icon" :src="'/static/' + tab.id + (active === tab.id ? '-active' : '') + '.png'" mode="aspectFit" />
          {{ tab.label }}
        </button>
      </view>
      <view class="rail-foot">
        <view class="rail-state">
          <text class="eyebrow">{{ life.status?.mode === 'demo' ? '演示工作台' : '私有工作台' }}</text>
          <text class="section-note">{{ life.status?.mode === 'demo' ? '数据保存在本地服务' : '仅你可以访问自己的记录' }}</text>
        </view>
      </view>
    </view>
    <view class="main">
      <view v-if="topInset" :style="{ height: topInset + 'px' }" />
      <view class="mobile-brand">
        <view class="mobile-brand-left">
          <image class="brand-icon" src="/static/brand.png" mode="aspectFit" />
          <text class="brand-title">LifeLog AI</text>
        </view>
        <!-- #ifdef H5 -->
        <text v-if="life.status?.mode === 'demo'" class="pill">演示模式</text>
        <!-- #endif -->
      </view>
      <slot />
    </view>
  </view>
</template>