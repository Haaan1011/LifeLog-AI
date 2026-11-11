import type { DemoReply, Goals, Job, LifeRecord, Me, RecordInput, Stats, Status, Summary } from './models'

const base = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
const prefix = base + '/api'
const sessionKey = 'lifelog.session'
const deviceKey = 'lifelog.device'
let login: Promise<string> | undefined
declare const wx: {
  env: { USER_DATA_PATH: string }
  getRandomValues?: (options: { length: number; success: (result: { randomValues: ArrayBuffer }) => void; fail: () => void }) => void
  shareFileMessage?: (options: { filePath: string; fileName: string; success: () => void; fail: (error: unknown) => void }) => void
}

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export function clearSession() {
  uni.removeStorageSync(sessionKey)
  uni.removeStorageSync(deviceKey)
}

function randomId() {
  // #ifdef H5
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  // #endif
  // #ifndef H5
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  // #endif
}

export function newMessageId() { return 'demo-' + randomId() }

function parseResult<T>(data: unknown, code: number) {
  if (code >= 200 && code < 300) return data as T
  const body = data as { error?: string } | null
  throw new ApiError(body?.error || '请求失败（' + code + '）', code)
}

function request<T>(path: string, method: UniApp.RequestOptions['method'] = 'GET', data?: UniApp.RequestOptions['data'], header: Record<string, string> = {}, dataType = 'json') {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: prefix + path, method, data, header, dataType, timeout: 16000,
      success: res => {
        try { resolve(parseResult<T>(res.data, res.statusCode)) } catch (error) { reject(error) }
      },
      fail: () => reject(new Error('无法连接 LifeLog 服务。请检查网络或本地服务后重试。')),
    })
  })
}

export const getStatus = () => request<Status>('/status')

async function demoDevice() {
  const existing: string | undefined = uni.getStorageSync(deviceKey)
  if (existing) return existing
  let id = ''
  // #ifdef H5
  id = randomId()
  // #endif
  // #ifdef MP-WEIXIN
  if (!wx.getRandomValues) throw new Error('当前微信版本无法安全创建演示会话。')
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => wx.getRandomValues?.({
    length: 24, success: result => resolve(result.randomValues), fail: () => reject(new Error('无法创建演示会话。')),
  }))
  id = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
  // #endif
  if (!id) throw new Error('此平台不支持安全演示登录。')
  uni.setStorageSync(deviceKey, id)
  return id
}

async function createSession() {
  const status = await getStatus()
  let result: { token: string }
  if (status.mode === 'demo') {
    result = await request('/auth/demo', 'POST', { deviceId: await demoDevice() })
  } else {
    let code = ''
    // #ifdef MP-WEIXIN
    code = await new Promise<string>((resolve, reject) => uni.login({
      provider: 'weixin',
      success: res => res.code ? resolve(res.code) : reject(new Error('微信登录凭证为空。')),
      fail: () => reject(new Error('微信登录失败，请重试。')),
    }))
    // #endif
    if (!code) throw new Error('正式模式请在微信小程序中登录。')
    result = await request('/auth/wechat', 'POST', { code })
  }
  uni.setStorageSync(sessionKey, result.token)
  return result.token
}

async function token(): Promise<string> {
  const saved = uni.getStorageSync(sessionKey)
  if (saved) return saved
  login ??= createSession().finally(() => { login = undefined })
  return login
}

async function auth<T>(fn: (header: Record<string, string>) => Promise<T>) {
  const current = await token()
  try { return await fn({ Authorization: 'Bearer ' + current }) } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    if (uni.getStorageSync(sessionKey) === current) uni.removeStorageSync(sessionKey)
    return fn({ Authorization: 'Bearer ' + await token() })
  }
}

function api<T>(path: string, method: UniApp.RequestOptions['method'] = 'GET', data?: UniApp.RequestOptions['data'], type = 'json') {
  return auth(header => request<T>(path, method, data, header, type))
}

export const getMe = () => api<Me>('/me')
export const updateMe = (input: Partial<Pick<Me, 'name' | 'timezone' | 'weightKg'>>) => api<Me>('/me', 'PUT', input)
export const updateGoals = (input: Goals) => api<Me>('/goals', 'PUT', { ...input })
export const makeBindCode = () => api<{ code: string; expiresAt: string }>('/binding/code', 'POST')
export const getRecords = (query: Record<string, string | number | undefined> = {}) => {
  const params = Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => key + '=' + encodeURIComponent(String(value))).join('&')
  return api<{ items: LifeRecord[]; total: number }>('/records' + (params ? '?' + params : ''))
}
export const getRecord = (id: string) => api<LifeRecord>('/records/' + encodeURIComponent(id))
export const saveRecord = (input: RecordInput, id?: string) => api<LifeRecord>(id ? '/records/' + encodeURIComponent(id) : '/records', id ? 'PUT' : 'POST', input)
export const deleteRecord = (id: string) => api<{ ok: boolean }>('/records/' + encodeURIComponent(id), 'DELETE')
export const completeTodo = (id: string, completed: boolean) => api<{ record: LifeRecord; next: LifeRecord | null }>('/records/' + encodeURIComponent(id) + '/complete', 'POST', { completed })
export const getStats = (days: 7 | 30 = 7) => api<Stats>('/stats?days=' + days)
export const getSummary = () => api<Summary>('/summary/today')
export const summarizeMemo = (date: string) => api<{ date: string; text: string; provider: 'local' | 'remote'; count: number }>('/summary/memo', 'POST', { date })
export const getJobs = () => api<{ items: Job[] }>('/jobs')
export const getJob = (id: string) => api<Job>('/jobs/' + encodeURIComponent(id))
export const retryJob = (id: string) => api<{ ok: boolean }>('/jobs/' + encodeURIComponent(id) + '/retry', 'POST')
export const exportData = () => api<Record<string, unknown>>('/export')
export const exportCalendar = () => api<string>('/calendar', 'GET', undefined, 'text')
export const removeAccount = () => api<{ ok: boolean }>('/me', 'DELETE', { confirm: 'DELETE' })

export function readPhoto(id: string) {
  return auth(header => new Promise<string>((resolve, reject) => uni.downloadFile({
    url: prefix + '/media/' + encodeURIComponent(id), header,
    success: res => {
      if (res.statusCode === 200 && res.tempFilePath) resolve(res.tempFilePath)
      else reject(new ApiError('图片已过期或无法访问。', res.statusCode))
    },
    fail: () => reject(new Error('无法下载图片。')),
  })))
}

export interface DemoInput { sender: string; messageId: string; text?: string; image?: string }
export async function demoSender() { return 'sim-' + (await demoDevice()).slice(0, 32) }

export function sendDemo(input: DemoInput) {
  const formData = { sender: input.sender, messageId: input.messageId, text: input.text ?? '' }
  return auth(header => {
    if (input.image) {
      return new Promise<DemoReply>((resolve, reject) => uni.uploadFile({
        url: prefix + '/demo/messages', filePath: input.image!, name: 'image', formData, header,
        success: res => {
          try { resolve(parseResult(JSON.parse(res.data), res.statusCode)) } catch (error) { reject(error) }
        },
        fail: () => reject(new Error('上传失败，请重新选择图片或检查连接。')),
      }))
    }
    const boundary = 'LifeLog-' + randomId()
    const body = Object.entries(formData).map(([key, value]) => '--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + value + '\r\n').join('') + '--' + boundary + '--\r\n'
    return request<DemoReply>('/demo/messages', 'POST', body, { ...header, 'Content-Type': 'multipart/form-data; boundary=' + boundary })
  })
}

export function errorLabel(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

export function toast(title: string, success = true) { uni.showToast({ title, icon: success ? 'success' : 'none' }) }

export async function saveExport(name: string, data: string, mime: string) {
  // #ifdef H5
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  // #endif
  // #ifdef MP-WEIXIN
  if (!wx.shareFileMessage) throw new Error('当前微信版本无法导出文件，请升级微信后重试。')
  const path = wx.env.USER_DATA_PATH + '/' + name
  const fs = uni.getFileSystemManager()
  await new Promise<void>((resolve, reject) => fs.writeFile({ filePath: path, data, encoding: 'utf8', success: () => resolve(), fail: reject }))
  try { await new Promise<void>((resolve, reject) => wx.shareFileMessage?.({ filePath: path, fileName: name, success: resolve, fail: reject })) }
  finally { fs.unlink({ filePath: path }) }
  // #endif
}
