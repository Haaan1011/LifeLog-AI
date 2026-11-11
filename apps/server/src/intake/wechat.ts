import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { SaxesParser } from 'saxes'

export type WechatConfig = { token: string; mode: 'plain' | 'safe'; appId?: string; aesKey?: string }
export type WechatMessage = {
  id: string; openid: string; toUser: string; kind: 'text' | 'image' | 'voice'; text: string
  sentAt: string; mediaId?: string; mediaId16k?: string; picUrl?: string; format?: string
}

export class WechatError extends Error {
  constructor(message: string, public statusCode = 400) { super(message) }
}

export const MAX_XML_BYTES = 64 * 1024

function parseXml(xml: string) {
  if (!xml || Buffer.byteLength(xml) > MAX_XML_BYTES) throw new WechatError('微信消息大小不合法')
  const fields = new Map<string, string>()
  const parser = new SaxesParser()
  let depth = 0
  let field = ''
  let value = ''
  let nested = false
  parser.on('error', () => { throw new WechatError('微信消息 XML 无效') })
  parser.on('doctype', () => { throw new WechatError('微信消息不允许 DTD') })
  parser.on('processinginstruction', () => { throw new WechatError('微信消息不允许 XML 处理指令') })
  parser.on('opentag', tag => {
    depth++
    if (Object.keys(tag.attributes).length || depth > 8 || (depth === 1 && tag.name !== 'xml')) {
      throw new WechatError('微信消息 XML 结构无效')
    }
    if (depth === 2) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(tag.name) || fields.has(tag.name) || fields.size >= 48) {
        throw new WechatError('微信消息 XML 字段无效')
      }
      field = tag.name
      value = ''
      nested = false
    }
    if (depth > 2) nested = true
  })
  const append = (text: string) => {
    if (depth === 2) value += text
    else if (depth < 2 && text.trim()) throw new WechatError('微信消息 XML 结构无效')
  }
  parser.on('text', append)
  parser.on('cdata', append)
  parser.on('closetag', () => {
    if (depth === 2) fields.set(field, nested ? '' : value)
    depth--
  })
  parser.write(xml).close()
  return fields
}

function signature(...values: string[]) {
  return createHash('sha1').update(values.sort().join('')).digest('hex')
}

function validateSignature(value: unknown, expected: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value) ||
      !timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new WechatError('微信签名校验失败', 403)
  }
}

function queryParts(query: Record<string, unknown>, config: WechatConfig) {
  if (!config.token) throw new WechatError('公众号回调未启用', 503)
  const { timestamp, nonce } = query
  if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp) ||
      typeof nonce !== 'string' || !/^[\w-]{1,128}$/.test(nonce)) {
    throw new WechatError('微信签名参数无效', 403)
  }
  return { timestamp, nonce }
}

export function verifyHandshake(query: Record<string, unknown>, config: WechatConfig) {
  const { timestamp, nonce } = queryParts(query, config)
  validateSignature(query.signature, signature(config.token, timestamp, nonce))
  if (typeof query.echostr !== 'string' || !query.echostr || query.echostr.length > 1024) {
    throw new WechatError('微信回调验证字符串无效')
  }
  return query.echostr
}

function aesKey(config: WechatConfig) {
  if (!config.appId || !config.aesKey || !/^[A-Za-z0-9+/]{43}$/.test(config.aesKey)) {
    throw new WechatError('公众号安全模式缺少 AppID 或 EncodingAESKey', 503)
  }
  return Buffer.from(`${config.aesKey}=`, 'base64')
}

function decrypt(encrypted: string, config: WechatConfig) {
  const key = aesKey(config)
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted) || encrypted.length % 4) throw new Error()
    const ciphertext = Buffer.from(encrypted, 'base64')
    if (!ciphertext.length || ciphertext.length % 32) throw new Error()
    const cipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16)).setAutoPadding(false)
    const padded = Buffer.concat([cipher.update(ciphertext), cipher.final()])
    const pad = padded[padded.length - 1]
    if (pad < 1 || pad > 32 || padded.subarray(-pad).some(byte => byte !== pad)) throw new Error()
    const data = padded.subarray(0, -pad)
    const length = data.readUInt32BE(16)
    if (length < 1 || length > MAX_XML_BYTES || 20 + length >= data.length) throw new Error()
    if (data.subarray(20 + length).toString('utf8') !== config.appId) throw new Error()
    return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(20, 20 + length))
  } catch {
    throw new WechatError('微信消息解密或 AppID 校验失败', 403)
  }
}

function encrypt(xml: string, config: WechatConfig) {
  const key = aesKey(config)
  const message = Buffer.from(xml)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(message.length)
  const data = Buffer.concat([randomBytes(16), size, message, Buffer.from(config.appId!)])
  const pad = 32 - data.length % 32
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)).setAutoPadding(false)
  return Buffer.concat([cipher.update(Buffer.concat([data, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
}

export function readWechatCallback(xml: string, query: Record<string, unknown>, config: WechatConfig): WechatMessage | null {
  const { timestamp, nonce } = queryParts(query, config)
  let fields: Map<string, string>
  if (config.mode === 'safe') {
    if (query.encrypt_type !== 'aes') throw new WechatError('公众号配置为安全模式，需要加密回调', 403)
    const encrypted = parseXml(xml).get('Encrypt')?.trim()
    if (!encrypted) throw new WechatError('微信消息缺少加密包')
    validateSignature(query.msg_signature, signature(config.token, timestamp, nonce, encrypted))
    fields = parseXml(decrypt(encrypted, config))
  } else {
    if (query.encrypt_type === 'aes' || query.msg_signature !== undefined) throw new WechatError('公众号回调模式与服务配置不符', 403)
    validateSignature(query.signature, signature(config.token, timestamp, nonce))
    fields = parseXml(xml)
  }

  const get = (name: string) => fields.get(name)?.trim() || ''
  const kind = get('MsgType')
  if (kind !== 'text' && kind !== 'image' && kind !== 'voice') return null
  const id = get('MsgId')
  const openid = get('FromUserName')
  const toUser = get('ToUserName')
  const createTime = get('CreateTime')
  const text = kind === 'text' ? get('Content') : get('Recognition')
  const mediaId = get('MediaId') || undefined
  const mediaId16k = get('MediaId16K') || undefined
  const picUrl = get('PicUrl') || undefined
  const format = get('Format') || undefined
  if (!/^\d{1,20}$/.test(id) || !/^[\w-]{1,128}$/.test(openid) || !/^[\w@.-]{1,128}$/.test(toUser) ||
      !/^\d{1,12}$/.test(createTime) || text.length > 8_000 || (kind === 'text' && !text) ||
      [mediaId, mediaId16k].some(media => media && !/^[\w+/=-]{1,256}$/.test(media)) ||
      (picUrl && picUrl.length > 2048) || (format && !/^[\w-]{1,24}$/.test(format))) {
    throw new WechatError('微信消息字段无效')
  }
  return { id, openid, toUser, kind, text, sentAt: new Date(Number(createTime) * 1000).toISOString(), mediaId, mediaId16k, picUrl, format }
}

function cdata(value: string) {
  return `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
}

export function makeWechatReply(message: WechatMessage, text: string, config: WechatConfig) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const xml = `<xml><ToUserName>${cdata(message.openid)}</ToUserName><FromUserName>${cdata(message.toUser)}</FromUserName><CreateTime>${timestamp}</CreateTime><MsgType>text</MsgType><Content>${cdata(text)}</Content></xml>`
  if (config.mode === 'plain') return xml
  const nonce = randomBytes(8).toString('hex')
  const encrypted = encrypt(xml, config)
  const digest = signature(config.token, timestamp, nonce, encrypted)
  return `<xml><Encrypt>${cdata(encrypted)}</Encrypt><MsgSignature>${cdata(digest)}</MsgSignature><TimeStamp>${timestamp}</TimeStamp><Nonce>${cdata(nonce)}</Nonce></xml>`
}
