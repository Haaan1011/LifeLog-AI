import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import test from 'node:test'
import { downloadWechatMedia, MediaError, transcribeWechatVoice, validateImage } from '../src/intake/media.js'
import { createAIProvider } from '../src/intake/provider.js'
import { normalizeRecord, RecordInputSchema } from '../src/intake/records.js'
import { makeWechatReply, readWechatCallback, verifyHandshake, type WechatConfig } from '../src/intake/wechat.js'

const now = { receivedAt: '2026-11-10T18:30:00Z', timezone: 'Asia/Shanghai' }
const parser = createAIProvider({ LIFELOG_MODE: 'demo' })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iMc8AAAAASUVORK5CYII=', 'base64')

test('本地饮食提取、USDA 营养换算与修改份量后重算', async () => {
  const [parsed] = await parser.parse({ ...now, text: '今天早餐吃了两个鸡蛋、一杯250ml牛奶和两片面包。' })
  assert.equal(parsed.type, 'diet')
  assert.equal(parsed.eventDate, '2026-11-11')
  assert.equal(parsed.status, 'review')
  assert.deepEqual(parsed.data.items.map(item => [item.name, item.grams]), [['鸡蛋', 100], ['牛奶', 257.83], ['面包', 58]])
  const normalized = normalizeRecord(parsed)
  assert.equal(normalized.type, 'diet')
  assert.equal(normalized.data.items[0].nutrition?.kcal, 155)
  assert.match(normalized.data.items[0].nutritionSource!, /173424/)
  normalized.data.items[0].grams = 60
  const edited = normalizeRecord(normalized)
  assert.equal(edited.type, 'diet')
  assert.equal(edited.data.items[0].nutrition?.kcal, 93)
  assert.equal(edited.data.items[0].nutrition?.protein, 7.55)
  edited.data.items[0].manualNutrition = true
  const override = normalizeRecord(edited)
  assert.equal(override.type, 'diet')
  assert.equal(override.data.items[0].nutritionSource, '用户填写')
})

test('训练动作和不同重量训练组，体重及时长缺失时没有热量估算', async () => {
  const [parsed] = await parser.parse({ ...now, text: '今天练胸，杠铃卧推60kg，4组，每组10次；哑铃飞鸟12kg，3组12次。' })
  assert.equal(parsed.type, 'workout')
  assert.equal(parsed.data.exercises[0].sets.length, 4)
  assert.deepEqual(parsed.data.exercises[1].sets[2], { weightKg: 12, reps: 12 })
  const calculated = normalizeRecord(parsed, 70)
  assert.equal(calculated.type, 'workout')
  assert.equal(calculated.data.volumeKg, 2832)
  assert.equal(calculated.data.estimatedKcal, null)
  const [session] = await parser.parse({ ...now, text: '今天练背，硬拉80kg做了4组，每组8次，高位下拉50kg做了3组，每组12次，训练大概60分钟。' })
  const estimate = normalizeRecord(session, 70)
  assert.equal(estimate.type, 'workout')
  assert.equal(estimate.data.estimatedKcal, 257)
  const [alternate] = await parser.parse({ ...now, text: '今天高位下拉做了3组，每组12次，50kg。' })
  assert.equal(alternate.type, 'workout')
  assert.deepEqual(alternate.data.exercises[0].sets, Array.from({ length: 3 }, () => ({ weightKg: 50, reps: 12 })))
})

test('混合事件按真实接收日期和用户时区拆分', async () => {
  const records = await parser.parse({ ...now, text: '今天下午做了实验，晚上练了腿，明天上午十点交报告。' })
  assert.deepEqual(records.map(record => record.type), ['memo', 'workout', 'todo'])
  const [memo, workout, todo] = records
  assert.equal(memo.eventDate, '2026-11-11')
  assert.equal(workout.status, 'review')
  assert.equal(todo.type, 'todo')
  assert.equal(todo.eventDate, '2026-11-12')
  assert.equal(todo.data.dueAt, '2026-11-12T02:00:00Z')
  assert.equal(todo.data.remindAt, null)
})

test('自然语言日期、每日重复、未给时刻和模糊时刻', async () => {
  const [tomorrow, week, daily, uncertain] = await parser.parse({ ...now, text: '明天早上九点开组会。下周五之前把论文发给导师。每天晚上十点记得睡觉。明天九点提醒我开会。' })
  assert.equal(tomorrow.type, 'todo')
  assert.equal(tomorrow.data.startAt, '2026-11-12T01:00:00Z')
  assert.equal(week.type, 'todo')
  assert.equal(week.eventDate, '2026-11-20')
  assert.equal(week.data.dueAt, null)
  assert.equal(daily.type, 'todo')
  assert.equal(daily.data.repeat, 'daily')
  assert.equal(daily.data.remindAt, '2026-11-11T14:00:00Z')
  assert.equal(uncertain.type, 'todo')
  assert.equal(uncertain.status, 'review')
  assert.equal(uncertain.data.remindAt, null)
})

test('本地零点跨日及上周五解析，生活时间线保留完整叙事', async () => {
  const beforeMidnight = { ...now, receivedAt: '2026-11-10T15:59:59Z' }
  const afterMidnight = { ...now, receivedAt: '2026-11-10T16:00:00Z' }
  const text = '明天早上9点提醒我把论文发给导师。'
  const [before] = await parser.parse({ ...beforeMidnight, text })
  const [after] = await parser.parse({ ...afterMidnight, text })
  assert.equal(before.type, 'todo')
  assert.equal(after.type, 'todo')
  assert.equal(before.data.remindAt, '2026-11-11T01:00:00Z')
  assert.equal(after.data.remindAt, '2026-11-12T01:00:00Z')
  const [previous] = await parser.parse({ ...now, text: '上周五吃了150g米饭' })
  assert.equal(previous.eventDate, '2026-11-06')
  const narrative = await parser.parse({ ...now, text: '今天上午完成了论文图2修改，下午开组会，晚上去跑步。' })
  assert.deepEqual(narrative.map(record => record.type), ['memo'])
  assert.match(narrative[0].content, /晚上去跑步/)
  const skipped = await parser.parse({ ...now, text: '今天没吃两个鸡蛋，晚上没练腿。' })
  assert.deepEqual(skipped.map(record => record.type), ['memo'])
})

test('缺失食物重量和本地图片保留人工确认状态', async () => {
  const [food] = await parser.parse({ ...now, text: '午餐吃了米饭和鱼肉。' })
  assert.equal(food.type, 'diet')
  assert.equal(food.status, 'review')
  assert.deepEqual(food.data.items.map(item => item.grams), [null, null])
  const image = validateImage(png, 'image/png')
  const [photo] = await parser.parse({ ...now, text: '', image })
  assert.equal(photo.type, 'diet')
  assert.equal(photo.status, 'review')
  assert.deepEqual(photo.data.items, [])
  assert.match(photo.note!, /未执行视觉识别/)
  const withCaption = await parser.parse({ ...now, text: '组会白板照片，记录实验思路。', image })
  assert.deepEqual(withCaption.map(record => record.type), ['memo'])
  assert.match(withCaption[0].note!, /保留图片附件/)
  assert.throws(() => validateImage(Buffer.from('<script>alert(1)</script>'), 'image/png'), /真实/)
  assert.throws(() => validateImage(png, 'image/jpeg'), /真实/)
})

test('日历日期和跨时区时刻经过结构校验', () => {
  const common = { type: 'todo', title: '开会', content: '', eventDate: '2026-11-12' }
  assert.equal(RecordInputSchema.safeParse({ ...common, eventDate: '2026-02-29', data: {} }).success, false)
  assert.equal(RecordInputSchema.safeParse({ ...common, data: { startAt: '2026-11-12T11:00:00+08:00', dueAt: '2026-11-12T02:00:00Z' } }).success, false)
  const parsed = RecordInputSchema.parse({ ...common, data: { remindAt: '2026-11-12T11:00:00+08:00' } })
  const normalized = normalizeRecord(parsed)
  assert.equal(normalized.type, 'todo')
  assert.equal(normalized.data.remindAt, '2026-11-12T03:00:00.000Z')
})

const token = 'wx-test-token'
const timestamp = '1794336000'
const nonce = '12345'
const signature = (...items: string[]) => createHash('sha1').update(items.sort().join('')).digest('hex')
const query = { timestamp, nonce, signature: signature(token, timestamp, nonce) }
const plain = { token, mode: 'plain' } as const
const textXml = '<xml><ToUserName>gh_account</ToUserName><FromUserName>sender-01</FromUserName><CreateTime>1794336000</CreateTime><MsgType>text</MsgType><Content><![CDATA[早餐吃了鸡蛋]]></Content><MsgId>9223372036854775807</MsgId></xml>'

test('微信 GET 验证、回调字段、被动回复和不合法签名', () => {
  assert.equal(verifyHandshake({ ...query, echostr: '000weixin' }, plain), '000weixin')
  assert.throws(() => verifyHandshake({ ...query, signature: '0'.repeat(40), echostr: 'x' }, plain), /签名/)
  const message = readWechatCallback(textXml, query, plain)!
  assert.equal(message.id, '9223372036854775807')
  assert.equal(message.text, '早餐吃了鸡蛋')
  assert.match(makeWechatReply(message, '已接收，正在整理记录。', plain), /已接收，正在整理记录。/)
  assert.throws(() => readWechatCallback(textXml, { ...query, signature: '0'.repeat(40) }, plain), /签名/)
  assert.throws(() => readWechatCallback(`<!DOCTYPE xml [<!ENTITY x SYSTEM 'file:///unsafe'>]>${textXml}`, query, plain), /DTD/)
  assert.throws(() => readWechatCallback(textXml.replace('</xml>', '<MsgId>123</MsgId></xml>'), query, plain), /字段/)
})

test('微信图片、语音回调保留元数据，未提供转写时保持为空', () => {
  const image = textXml.replace('<MsgType>text</MsgType>', '<MsgType>image</MsgType>').replace(/<Content>.*?<\/Content>/, '<MediaId>photo-1</MediaId><PicUrl>https://mmbiz.qpic.cn/signed</PicUrl>')
  const voice = image.replace('<MsgType>image</MsgType>', '<MsgType>voice</MsgType>').replace('<MediaId>photo-1</MediaId>', '<MediaId>voice-8k</MediaId><MediaId16K>voice-16k</MediaId16K><Format>amr</Format>')
  assert.equal(readWechatCallback(image, query, plain)?.mediaId, 'photo-1')
  assert.equal(readWechatCallback(voice, query, plain)?.mediaId16k, 'voice-16k')
  assert.equal(readWechatCallback(voice, query, plain)?.text, '')
  assert.equal(readWechatCallback(voice.replace('</xml>', '<Recognition>训练结束</Recognition></xml>'), query, plain)?.text, '训练结束')
})

test('安全模式 AES 协议校验、拒绝降级、加密被动回复', () => {
  const key = Buffer.alloc(32, 42)
  const config: WechatConfig = { token, mode: 'safe', appId: 'wxfixture', aesKey: key.toString('base64').slice(0, -1) }
  assert.equal(verifyHandshake({ ...query, echostr: 'safe-echo' }, config), 'safe-echo')
  const data = Buffer.concat([Buffer.alloc(20), Buffer.from(textXml), Buffer.from(config.appId!)])
  data.writeUInt32BE(Buffer.byteLength(textXml), 16)
  const pad = 32 - data.length % 32
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)).setAutoPadding(false)
  const encrypt = Buffer.concat([cipher.update(Buffer.concat([data, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
  const envelope = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`
  const aesQuery = { timestamp, nonce, encrypt_type: 'aes', msg_signature: signature(token, timestamp, nonce, encrypt) }
  const message = readWechatCallback(envelope, aesQuery, config)!
  assert.equal(message.text, '早餐吃了鸡蛋')
  assert.throws(() => readWechatCallback(textXml, query, config), /安全模式/)
  assert.throws(() => readWechatCallback(envelope, { ...aesQuery, msg_signature: '0'.repeat(40) }, config), /签名/)
  assert.throws(() => readWechatCallback(envelope, aesQuery, { ...config, appId: 'wxother' }), /AppID/)
  const reply = makeWechatReply(message, '已接收', config)
  assert.doesNotMatch(reply, /已接收/)
  const replyValue = reply.match(/<Encrypt><!\[CDATA\[(.*?)\]\]>/)![1]
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16)).setAutoPadding(false)
  const plaintext = Buffer.concat([decipher.update(Buffer.from(replyValue, 'base64')), decipher.final()])
  const replyXml = plaintext.subarray(20, 20 + plaintext.readUInt32BE(16)).toString('utf8')
  assert.match(replyXml, /已接收/)
})

test('AI 错误 JSON 及结构不合规会失败，重试后仍保留明确错误', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    const content = calls === 1 ? '<html>' : JSON.stringify({ records: [{ type: 'diet', calories: 12345 }] })
    return Response.json({ choices: [{ message: { content } }] })
  })
  const provider = createAIProvider({ LIFELOG_MODE: 'production', AI_MODEL: 'fixture', AI_API_KEY: 'test-key' })
  await assert.rejects(provider.parse({ ...now, text: '吃了米饭' }), /结构化校验/)
  assert.equal(calls, 2)
})

test('AI 图片走视觉模型，未知份量保留缺失且强制标记待确认', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    assert.equal(body.model, 'vision-fixture')
    assert.match(body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/)
    return Response.json({ choices: [{ message: { content: JSON.stringify({ records: [{
      type: 'diet', title: '食物照片', content: '', eventDate: '2026-11-11', confidence: 0.95,
      status: 'confirmed', data: { meal: 'unknown', items: [{ name: '米饭', grams: null }] },
    }] }) } }] })
  })
  const provider = createAIProvider({ LIFELOG_MODE: 'production', AI_MODEL: 'text-fixture', AI_VISION_MODEL: 'vision-fixture', AI_API_KEY: 'test-key' })
  const [record] = await provider.parse({ ...now, text: '', image: validateImage(png) })
  assert.equal(record.type, 'diet')
  assert.equal(record.status, 'review')
  assert.equal(record.data.items[0].grams, null)
  assert.equal(record.data.items[0].estimated, true)
})

test('微信临时素材只使用官方主机，复用稳定版凭据，关闭权限时报错', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (input: URL | string) => {
    calls++
    const url = new URL(input)
    assert.equal(url.host, 'api.weixin.qq.com')
    if (url.pathname.endsWith('/stable_token')) return Response.json({ access_token: 'mock-access', expires_in: 7200 })
    assert.equal(url.searchParams.get('media_id'), 'picture-fixture')
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
  })
  const env = { WECHAT_OA_APP_ID: 'wxfixture', WECHAT_OA_APP_SECRET: 'mock-secret', WECHAT_MEDIA_DOWNLOAD: 'true' }
  assert.equal((await downloadWechatMedia('picture-fixture', 'image', env)).mime, 'image/png')
  await downloadWechatMedia('picture-fixture', 'image', env)
  assert.equal(calls, 3)
  await assert.rejects(downloadWechatMedia('picture-fixture', 'image', {}), /未启用/)
  await assert.rejects(transcribeWechatVoice(Buffer.alloc(20), 'amr', 8000, {}), /未启用/)
})

test('过期素材不会重复下载，权限与白名单错误保留明确原因', async t => {
  const env = { WECHAT_OA_APP_ID: 'wx-expired', WECHAT_OA_APP_SECRET: 'mock-secret', WECHAT_MEDIA_DOWNLOAD: 'true' }
  let mediaCalls = 0
  const provider = t.mock.method(globalThis, 'fetch', async (input: URL | string) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/stable_token')) return Response.json({ access_token: 'mock-access', expires_in: 7200 })
    mediaCalls++
    return Response.json({ errcode: 40007 })
  })
  await assert.rejects(downloadWechatMedia('expired', 'image', env), (error: unknown) =>
    error instanceof MediaError && error.statusCode === 410 && !error.retryable && /重新发送/.test(error.message))
  assert.equal(mediaCalls, 1)
  provider.mock.mockImplementation(async () => Response.json({ errcode: 40164 }))
  await assert.rejects(downloadWechatMedia('new', 'image', { ...env, WECHAT_OA_APP_ID: 'wx-whitelist' }), (error: unknown) =>
    error instanceof MediaError && error.statusCode === 403 && !error.retryable && /白名单/.test(error.message))
})
