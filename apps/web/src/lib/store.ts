import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getMe, getStatus } from './api'
import { defaultZone, localToday } from './date'
import type { Kind, Me, Status } from './models'

export const useLife = defineStore('life', () => {
  const me = ref<Me>()
  const status = ref<Status>()
  const filter = ref<Kind | 'all'>('all')
  const timezone = computed(() => me.value?.timezone || defaultZone)
  const today = computed(() => localToday(timezone.value))
  async function refreshProfile() { me.value = await getMe(); return me.value }
  async function refreshStatus() { status.value = await getStatus(); return status.value }
  function viewRecords(kind: Kind | 'all' = 'all') {
    filter.value = kind
    uni.switchTab({ url: '/pages/records/index' })
  }
  function edit(kind?: Kind, id?: string) {
    const query = id ? '?id=' + encodeURIComponent(id) : kind ? '?type=' + kind : ''
    uni.navigateTo({ url: '/pages/editor/index' + query })
  }
  return { me, status, filter, timezone, today, refreshProfile, refreshStatus, viewRecords, edit }
})