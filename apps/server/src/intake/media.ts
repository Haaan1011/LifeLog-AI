import { asr } from 'tencentcloud-sdk-nodejs-asr'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VOICE_BYTES = 2_250_000 // Tencent limits the base64-encoded input to 3 MB.

export class MediaError extends Error {
  constructor(message: string, public statusCode = 400, public retryable = statusCode >= 500) { super(message) }
}

export function validateImage(buffer: Buffer, claimedMime?: string) {
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new MediaError('图片大小超出限制', 413)
  const mime = buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && buffer.toString('ascii', 12, 16) === 'IHDR' ? 'image/png'
    : buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? 'image/jpeg'
    : buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
    : null
  const claimed = claimedMime?.toLowerCase().split(';')[0].trim().replace(/^image\/jpg$/, 'image/jpeg')
  if (!mime || (claimed && claimed !== 'application/octet-stream' && claimed !== mime)) throw new MediaError('仅支持真实的 JPEG、PNG 或 WebP 图片', 415)
  if (mime === 'image/png') {
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    if (!width || !height || width * height > 60_000_000) throw new MediaError('图片像素尺寸超出限制', 415)
  }
  return { buffer, mime }
}

const enabled = (value?: string) => value === 'true' || value === '1'
const tokenCache = new Map<string, { token: string; expiresAt: number }>()
const pendingTokens = new Map<string, Promise<string>>()

function wechatError(code: number, action: 'token' | 'media') {
  if (action === 'media' && code === 40007) return new MediaError('微信素材 ID 无效或素材已过期，请重新发送原文件', 410)
  if (action === 'media' && code === 40004) return new MediaError('微信素材类型无效，请重新发送图片或语音', 415)
  if (code === 40164) return new MediaError('公众号接口拒绝当前出口 IP，请核对公众号 IP 白名单', 403)
  if (code === 89503) return new MediaError('公众号接口需要管理员确认，请完成确认后手动重试', 403)
  if ([48001, 50001].includes(code)) return new MediaError('当前公众号未开通该素材接口，请核对账号接口权限', 403)
  if ([40001, 40013, 40014, 40125, 42001].includes(code)) return new MediaError('公众号接口凭据无效，请核对账号和服务端配置', 403)
  return new MediaError(`微信${action === 'token' ? '接口凭据' : '临时素材'}暂不可用（错误码 ${Number.isSafeInteger(code) ? code : '未知'}）`, 502)
}

async function accessToken(appId: string, secret: string): Promise<string> {
  const cached = tokenCache.get(appId)
  if (cached && cached.expiresAt > Date.now()) return cached.token
  const pending = pendingTokens.get(appId)
  if (pending) return pending
  const request = (async () => {
    try {
      const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'error',
        body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret, force_refresh: false }),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new MediaError(`公众号接口凭据请求失败（HTTP ${response.status}）`, 502, response.status === 429 || response.status >= 500)
      }
      const data = await response.json() as { access_token?: string; expires_in?: number; errcode?: number }
      if (typeof data.access_token !== 'string' || !data.access_token || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)) {
        throw wechatError(Number(data.errcode), 'token')
      }
      tokenCache.set(appId, { token: data.access_token, expiresAt: Date.now() + Math.max(0, data.expires_in - 120) * 1000 })
      return data.access_token
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw new MediaError('公众号接口凭据请求超时或网络错误', 502)
    }
  })()
  pendingTokens.set(appId, request)
  try { return await request } finally { pendingTokens.delete(appId) }
}

export async function downloadWechatMedia(mediaId: string, kind: 'image' | 'voice', env = process.env) {
  if (!enabled(env.WECHAT_MEDIA_DOWNLOAD)) throw new MediaError('公众号临时素材下载未启用', 503, false)
  const appId = env.WECHAT_OA_APP_ID
  const secret = env.WECHAT_OA_APP_SECRET
  if (!appId || !secret) throw new MediaError('公众号临时素材下载需要 AppID 和 AppSecret', 503, false)
  if (!/^[\w+/=-]{1,256}$/.test(mediaId)) throw new MediaError('微信素材 ID 无效')
  const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VOICE_BYTES
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(appId, secret)
    const url = new URL('https://api.weixin.qq.com/cgi-bin/media/get')
    url.search = new URLSearchParams({ access_token: token, media_id: mediaId }).toString()
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        if (response.status === 404 || response.status === 410) throw new MediaError('微信素材已失效，请重新发送原文件', 410)
        throw new MediaError(`公众号素材下载失败（HTTP ${response.status}）`, 502, response.status === 429 || response.status >= 500)
      }
      if (Number(response.headers.get('content-length')) > max) {
        await response.body.cancel()
        throw new MediaError('公众号素材超过大小限制', 413)
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > max) {
          await reader.cancel()
          throw new MediaError('公众号素材超过大小限制', 413)
        }
        chunks.push(chunk.value)
      }
      const buffer = Buffer.concat(chunks)
      const mime = response.headers.get('content-type')?.toLowerCase().split(';')[0] || 'application/octet-stream'
      if (mime.includes('json') || buffer.subarray(0, 32).toString('utf8').trimStart().startsWith('{')) {
        const code = Number((JSON.parse(buffer.toString('utf8')) as { errcode?: number }).errcode)
        if (attempt === 0 && [40001, 40014, 42001].includes(code)) { tokenCache.delete(appId); continue }
        throw wechatError(code, 'media')
      }
      if (kind === 'image') return validateImage(buffer, mime)
      if (!buffer.length || !/^(audio\/|application\/(?:octet-stream|ogg))/.test(mime)) throw new MediaError('微信语音素材格式无效', 415)
      return { buffer, mime }
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw new MediaError('公众号素材下载超时或响应格式错误', 502)
    }
  }
  throw new MediaError('公众号素材下载失败', 502)
}

export async function transcribeWechatVoice(buffer: Buffer, format: string | undefined, sampleRate: 8000 | 16000, env = process.env) {
  const secretId = env.TENCENTCLOUD_SECRET_ID
  const secretKey = env.TENCENTCLOUD_SECRET_KEY
  if (!enabled(env.WECHAT_VOICE_ASR) || !secretId || !secretKey) throw new MediaError('此语音没有微信转写结果，腾讯云语音识别未启用或缺少凭据', 503, false)
  if (!buffer.length || buffer.length > MAX_VOICE_BYTES) throw new MediaError('语音大小不符合转写要求', 413)
  const header = buffer.toString('ascii', 0, 9)
  const voiceFormat = header.startsWith('#!AMR') ? 'amr' : format?.toLowerCase()
  if (!voiceFormat || !/^(wav|pcm|ogg-opus|speex|silk|mp3|m4a|aac|amr)$/.test(voiceFormat)) throw new MediaError('微信语音编码不受转写服务支持', 415)
  const client = new asr.v20190614.Client({
    credential: { secretId, secretKey, token: env.TENCENTCLOUD_SESSION_TOKEN }, region: env.TENCENTCLOUD_ASR_REGION || 'ap-guangzhou',
    profile: { httpProfile: { reqTimeout: 20 } },
  })
  try {
    const result = await client.SentenceRecognition({ EngSerViceType: sampleRate === 16000 ? '16k_zh' : '8k_zh',
      SourceType: 1, VoiceFormat: voiceFormat, Data: buffer.toString('base64'), DataLen: buffer.length })
    const text = result.Result?.trim()
    if (!text || text.length > 8000) throw new MediaError('腾讯云语音识别没有返回可用文字', 422)
    return text
  } catch (error) {
    if (error instanceof MediaError) throw error
    const code = (error as { code?: string })?.code
    if (typeof code === 'string' && /^(AuthFailure|UnauthorizedOperation|FailedOperation\.(?:ServiceIsolate|NoPermission))/.test(code)) {
      throw new MediaError('腾讯云语音识别鉴权失败，请确认 CAM 权限和已开通的 ASR 服务', 403)
    }
    if (typeof code === 'string' && /^(InvalidParameter|FailedOperation\.(?:ErrorRecognize|Audio))/.test(code)) {
      throw new MediaError('腾讯云语音识别无法处理该音频，请发送可用语音或改用文字', 422)
    }
    throw new MediaError('腾讯云语音识别失败，请核对接口授权、音频格式及服务状态', 502)
  }
}
