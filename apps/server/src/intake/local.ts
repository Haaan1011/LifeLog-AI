import { Temporal } from '@js-temporal/polyfill'
import { foodAliases, portionGrams } from './nutrition.js'
import { type ParsedRecord } from './records.js'

export type ParseInput = {
  text: string; receivedAt: string; timezone: string
  image?: { buffer: Buffer; mime: string }; imageMissing?: boolean
}

const numeral = '[0-9零〇一二两三四五六七八九十百千]+(?:[.点][0-9零〇一二两三四五六七八九]+)?'
const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
function numberFrom(text: string | undefined): number | null {
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const [whole, fractional] = text.split(/[.点]/)
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  let result = 0
  let digit: number | null = null
  for (const char of whole) {
    if (char in units) { result += (digit ?? 1) * units[char]; digit = null }
    else if (char in digits || /^\d$/.test(char)) digit = (digit ?? 0) * 10 + (digits[char] ?? Number(char))
    else return null
  }
  const fraction = fractional ? Number(`0.${[...fractional].map(char => digits[char] ?? char).join('')}`) : 0
  return Number.isFinite(fraction) ? result + (digit ?? 0) + fraction : null
}

type DateContext = { date: Temporal.PlainDate; uncertain: boolean; explicit: boolean }
function dayFor(text: string, today: Temporal.PlainDate, fallback: DateContext): DateContext {
  const full = text.match(/(?<!\d)(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?!\d)/)
  const partial = full ? null : text.match(/(?<![\d年])(\d{1,2})月(\d{1,2})[日号]/)
  if (full || partial) {
    const [year, month, day] = full ? full.slice(1).map(Number) : [today.year, Number(partial![1]), Number(partial![2])]
    try {
      if (year < 1900 || year > 2200) throw new Error()
      return { date: Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' }), uncertain: !full, explicit: true }
    } catch { return { date: fallback.date, uncertain: true, explicit: true } }
  }
  const relative = text.match(/大前天|大后天|前天|昨天|昨日|今早|今晚|今天|今日|明早|明晚|明天|明日|后天/)
  if (relative) {
    const days: Record<string, number> = { 大前天: -3, 前天: -2, 昨天: -1, 昨日: -1, 今早: 0, 今晚: 0, 今天: 0, 今日: 0,
      明早: 1, 明晚: 1, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 }
    return { date: today.add({ days: days[relative[0]] }), uncertain: false, explicit: true }
  }
  const everyWeek = text.match(/每(?:周|星期|礼拜)([一二三四五六日天])/)
  if (everyWeek) {
    const target = everyWeek[1] === '日' || everyWeek[1] === '天' ? 7 : digits[everyWeek[1]]
    return { date: today.add({ days: (target - today.dayOfWeek + 7) % 7 }), uncertain: false, explicit: true }
  }
  const everyMonth = text.match(new RegExp(`每月(${numeral})[日号]`))
  if (everyMonth) {
    const target = numberFrom(everyMonth[1])!
    if (!Number.isInteger(target) || target < 1 || target > 31) return { date: today, uncertain: true, explicit: true }
    const first = today.with({ day: 1 })
    for (let offset = 0; offset <= 2; offset++) {
      const month = first.add({ months: offset })
      if (target <= month.daysInMonth && (offset > 0 || target >= today.day)) return { date: month.with({ day: target }), uncertain: false, explicit: true }
    }
  }
  if (/每天|每日/.test(text)) return { date: today, uncertain: false, explicit: true }
  if (/每周|每星期|每月/.test(text)) return { date: today, uncertain: true, explicit: true }
  const week = text.match(/(上上|下下|上|本|这|下)?(?:周|星期|礼拜)([一二三四五六日天])/)
  if (week) {
    const offset: Record<string, number> = { 上上: -2, 上: -1, 本: 0, 这: 0, 下: 1, 下下: 2 }
    const target = week[2] === '日' || week[2] === '天' ? 7 : digits[week[2]]
    return { date: today.add({ days: (offset[week[1]] ?? 0) * 7 + target - today.dayOfWeek }), uncertain: !week[1], explicit: true }
  }
  return { ...fallback, uncertain: fallback.uncertain || /下周|周末|下个月|月底|以后|过几天|改天|稍后|晚些|明早|今晚/.test(text), explicit: false }
}

function clockFor(text: string, date: Temporal.PlainDate, timezone: string) {
  const digital = text.match(/(?<!\d)(\d{1,2})[:：](\d{2})(?!\d)/)
  const spoken = digital ? null : text.match(new RegExp(`(${numeral})(?:点|时)(半|一刻|三刻|(?:${numeral})分?)?`))
  if (!digital && !spoken) return { at: null, uncertain: false }
  let hour = digital ? Number(digital[1]) : numberFrom(spoken?.[1])!
  const minuteText = spoken?.[2]
  const minute = digital ? Number(digital[2]) : minuteText === '半' ? 30 : minuteText === '一刻' ? 15 : minuteText === '三刻' ? 45 : numberFrom(minuteText?.replace(/分$/, '')) ?? 0
  const prefix = text.slice(0, (digital ?? spoken)!.index)
  const period = [...prefix.matchAll(/凌晨|早上|上午|中午|下午|傍晚|晚上|夜里|晚间|早|晚/g)].at(-1)?.[0]
  const uncertain = !digital && !period && hour >= 1 && hour <= 12
  if (period && /中午|下午|傍晚|晚上|夜里|晚间|晚/.test(period) && hour < 12) hour += 12
  if (period === '凌晨' && hour === 12) hour = 0
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59 || uncertain) return { at: null, uncertain: true }
  try {
    return { at: date.toPlainDateTime({ hour, minute }).toZonedDateTime(timezone, { disambiguation: 'reject' }).toInstant().toString(), uncertain: false }
  } catch { return { at: null, uncertain: true } }
}

const workoutActions = ['杠铃卧推', '哑铃卧推', '高位下拉', '坐姿划船', '杠铃划船', '哑铃飞鸟', '哑铃弯举', '俯身飞鸟', '罗马尼亚硬拉', '保加利亚分腿蹲', '引体向上', '俯卧撑', '仰卧起坐', '平板支撑', '硬拉', '深蹲', '卧推', '飞鸟', '划船', '弯举', '推举', '臀桥', '腿举', '跑步', '慢跑', '跳绳', '骑行', '游泳', '健走', '步行', '瑜伽']
const actionsPattern = workoutActions.sort((a, b) => b.length - a.length).join('|')
const workoutCue = new RegExp(`${actionsPattern}|力量训练|训练(?:了|大概|时长)|练(?:了)?[胸背臀腿肩手臂核心]`)
const dietCue = /吃了|喝了|早餐|午餐|晚餐|早饭|午饭|晚饭|加餐|夜宵|摄入|进食/
const todoCue = /提醒我|提醒|记得|待办|截止|之前|交报告|交作业|开组会|开会|提交|预约|取快递|要把|需要完成/
const historical = /完成了|开了|已经|交了|交完|提交了|提交完|做完|发了|发完|结束了/

function isTask(text: string, today: Temporal.PlainDate, context: DateContext) {
  if (/不用提醒|不要提醒|不必提醒|别提醒/.test(text)) return false
  if (historical.test(text) && !/提醒|记得|截止/.test(text)) return false
  if (/提醒|记得|待办|截止|之前|必须|别忘/.test(text)) return true
  const relative = Temporal.PlainDate.compare(context.date, today)
  const futureAction = /(?:明天|明早|明晚|后天|下周|每天|每周).*(?:交|发给|会|睡觉|见面|去|预约|买|写|练|完成)/.test(text)
  return relative >= 0 && (todoCue.test(text) || futureAction) && (relative > 0 || futureAction || /[点:：]|要|将|需要/.test(text))
}

function foodItems(text: string) {
  const matches = [...text.matchAll(new RegExp(foodAliases.join('|'), 'g'))]
  const result = []
  const quantityPattern = new RegExp(`(${numeral})\\s*(千克|公克|公斤|毫升|kg|ml|克|g|斤|个|枚|片|碗|根|杯|份|瓶)?\\s*$`, 'i')
  const afterQuantityPattern = new RegExp(`^\\s*[（(]?(?:约)?\\s*(${numeral})\\s*(千克|公克|公斤|毫升|kg|ml|克|g|斤|个|枚|片|碗|根|杯|份|瓶)`, 'i')
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const previous = matches[i - 1]
    const before = text.slice(previous ? previous.index + previous[0].length : 0, match.index)
    const after = text.slice(match.index + match[0].length)
    const cooking = before.match(/(清蒸|水煮|油煎|煎|炒|油炸|炸|红烧|烤|生食)$/)?.[1]
    const count = before.replace(/(?:清蒸|水煮|油煎|煎|炒|油炸|炸|红烧|烤|生食)$/, '').match(quantityPattern) ?? after.match(afterQuantityPattern)
    const quantity = numberFrom(count?.[1])
    const unit = count?.[2] ?? ''
    const portion = portionGrams(match[0], quantity, unit)
    result.push({ name: match[0], quantity, unit, grams: portion?.grams ?? null, cooking, estimated: portion?.estimated ?? false })
  }
  return result
}

function setsFor(text: string) {
  const weightPattern = `(${numeral})\\s*(kg|公斤|千克|lb|磅|斤)`
  const weights = [...text.matchAll(new RegExp(weightPattern, 'gi'))]
  const repsPattern = new RegExp(`(${numeral})\\s*(?:次|个|下)`)
  const groupPattern = new RegExp(`(${numeral})\\s*组`)
  function piece(part: string, weightKg: number | null) {
    const reps = numberFrom(part.match(repsPattern)?.[1])
    const count = numberFrom(part.match(groupPattern)?.[1])
    if (reps == null && count == null && weightKg == null) return []
    // 无组数时只保留明确出现的这一组信息。
    return Array.from({ length: Math.max(1, Math.min(100, count ?? 1)) }, () => ({ weightKg, reps }))
  }
  if (!weights.length) return piece(text, null)
  return weights.flatMap((weight, index) => {
    const amount = numberFrom(weight[1])!
    const unit = weight[2].toLowerCase()
    const kg = /lb|磅/.test(unit) ? Math.round(amount * 45.359237) / 100 : unit === '斤' ? amount / 2 : amount
    const next = weights[index + 1]
    return piece(weights.length === 1 ? text : text.slice(weight.index, next?.index), kg)
  })
}

function workoutData(text: string) {
  const actions = [...text.matchAll(new RegExp(actionsPattern, 'g'))]
  const exercises = actions.map((action, index) => ({ name: action[0], sets: setsFor(text.slice(action.index + action[0].length, actions[index + 1]?.index)) }))
  const groups: Record<string, string> = { 胸: '胸', 背: '背', 腿: '腿', 肩: '肩', 臀: '臀', 手臂: '手臂', 核心: '核心' }
  const muscleGroups = [...new Set([...text.matchAll(/练(?:了)?(胸|背|腿|肩|臀|手臂|核心)/g)].map(match => groups[match[1]]))]
  const minutes = numberFrom(text.match(new RegExp(`(${numeral})\\s*分钟`))?.[1])
  const hours = numberFrom(text.match(new RegExp(`(${numeral})\\s*(?:小时|钟头)`))?.[1])
  const durationMinutes = hours !== null || minutes !== null ? (hours ?? 0) * 60 + (minutes ?? 0) : null
  const intensity = /高强度|大强度|剧烈|很累/.test(text) ? 'vigorous' as const
    : /低强度|轻松|轻量/.test(text) ? 'light' as const
    : /中等强度|适中/.test(text) ? 'moderate' as const : null
  return { muscleGroups, exercises, durationMinutes, intensity }
}

export function localRecords(input: ParseInput): ParsedRecord[] {
  const today = Temporal.Instant.from(input.receivedAt).toZonedDateTimeISO(input.timezone).toPlainDate()
  const pieces: { type: ParsedRecord['type']; content: string; context: DateContext }[] = []
  let date: DateContext = { date: today, uncertain: false, explicit: false }
  const parts = input.text.normalize('NFKC').split(/[,，;；。！!？?\n]+|(?:然后|接着|另外)(?=今天|明天|后天|晚上|下午|上午|还|提醒|记得|练|吃)/).map(text => text.trim()).filter(Boolean)
  for (const content of parts) {
    const context = dayFor(content, today, date)
    if (context.explicit) date = context
    const last = pieces.at(-1)
    const task = isTask(content, today, context)
    const casualActivity = last?.type === 'memo' && /去(?:跑步|游泳|骑行|散步|瑜伽)/.test(content) && !/分钟|小时|公里|强度|训练/.test(content)
    const plannedOrSkippedWorkout = /(?:没(?:有)?|未|不|打算|计划)(?:去)?(?:练|训练|健身|跑步|游泳|骑行)/.test(content)
    const isWorkout = !casualActivity && !plannedOrSkippedWorkout && workoutCue.test(content)
    const hasFood = foodItems(content)
    const plannedOrSkippedMeal = /(?:没(?:有)?|未|不|打算|计划|想)(?:去)?(?:吃|喝|进食)/.test(content)
    const isDiet = !plannedOrSkippedMeal && (dietCue.test(content) || (hasFood.length > 0 && (last?.type === 'diet' || hasFood.some(item => item.quantity != null))))
    const continuation = !context.explicit && last?.type === 'workout' && new RegExp(`^每组|^${numeral}\\s*(?:组|次|kg|公斤)|时长|强度`).test(content)
    const type = task ? 'todo' : isWorkout || continuation ? 'workout' : isDiet ? 'diet' : 'memo'
    const sameEvent = last?.type === type && last.context.date.equals(context.date) && type !== 'todo' && !context.explicit
    if (sameEvent) last.content += `，${content}`
    else pieces.push({ type, content, context })
  }

  const records: ParsedRecord[] = pieces.slice(0, 15).map(({ type, content, context }) => {
    const eventDate = context.date.toString()
    const base = { content, eventDate, note: context.uncertain ? '日期或时间有歧义，请确认。' : '', status: context.uncertain ? 'review' as const : 'confirmed' as const }
    if (type === 'diet') {
      const items = foodItems(content)
      const meal = /早餐|早饭/.test(content) ? 'breakfast' : /午餐|午饭/.test(content) ? 'lunch' : /晚餐|晚饭/.test(content) ? 'dinner' : /加餐|夜宵/.test(content) ? 'snack' : 'unknown'
      const uncertain = context.uncertain || !items.length || items.some(item => item.grams == null || item.estimated)
      return { ...base, type, title: ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐', unknown: '饮食记录' })[meal],
        status: uncertain ? 'review' : base.status, confidence: uncertain ? 0.62 : 0.83, data: { meal, items } }
    }
    if (type === 'workout') {
      const data = workoutData(content)
      const uncertain = context.uncertain || !data.exercises.length || data.exercises.some(exercise =>
        (!exercise.sets.length && !/跑步|慢跑|跳绳|骑行|游泳|健走|步行|瑜伽/.test(exercise.name)) || exercise.sets.some(set => set.reps == null))
      return { ...base, type, title: data.muscleGroups.length ? `${data.muscleGroups.join('、')}部训练` : (data.exercises[0]?.name ?? '训练记录'),
        status: uncertain ? 'review' : base.status, confidence: uncertain ? 0.65 : 0.85, data }
    }
    if (type === 'todo') {
      const clock = clockFor(content, context.date, input.timezone)
      const at = context.uncertain ? null : clock.at
      const deadline = /截止|之前|交报告|交作业|提交/.test(content)
      const reminder = /提醒|记得|别忘/.test(content)
      const repeat = /每天|每日/.test(content) ? 'daily' : /每周|每星期/.test(content) ? 'weekly' : /每月/.test(content) ? 'monthly' : 'none'
      const priority = /紧急|优先/.test(content) ? 'high' : 'normal'
      const uncertain = context.uncertain || clock.uncertain
      return { ...base, type, title: content.replace(/^.*?(?:提醒我|记得|别忘了?)/, '').slice(0, 100) || '待办事项',
        note: uncertain ? '日期或时间有歧义，请确认。' : deadline && !at ? '原文仅指定日期。' : '',
        status: uncertain ? 'review' : base.status, confidence: uncertain ? 0.6 : 0.86,
        data: { startAt: deadline || reminder ? null : at, dueAt: deadline ? at : null, remindAt: reminder ? at : null, repeat, priority } }
    }
    return { ...base, type, title: content.slice(0, 32), confidence: 0.77, data: { tags: [...content.matchAll(/#([\p{L}\p{N}_-]{1,40})/gu)].slice(0, 30).map(match => match[1]) } }
  })

  if (pieces.length > 15) {
    records.push({ type: 'memo', title: '其余消息内容待确认', content: pieces.slice(15).map(piece => piece.content).join('，'),
      eventDate: today.toString(), status: 'review', confidence: 0, note: '同一条消息包含较多事项，请查看原文。', data: { tags: [] } })
  }
  const imageNote = input.imageMissing ? '公众号素材暂不可下载，未执行视觉识别。' : '本地演示模式未执行视觉识别，请填写食物与份量。'
  const imageRecord = records.find(record => record.type === 'diet') ?? records[0]
  if ((input.image || input.imageMissing) && imageRecord) {
    imageRecord.status = 'review'
    const note = input.image && !input.imageMissing && imageRecord.type !== 'diet' ? '本地演示模式保留图片附件，文字解析未使用图像内容。' : imageNote
    imageRecord.note = [imageRecord.note, note].filter(Boolean).join(' ')
  } else if (input.image || input.imageMissing) {
    records.push({ type: 'diet', title: '图片待确认', content: input.text || '收到一张图片', eventDate: today.toString(), status: 'review', confidence: 0,
      note: imageNote, data: { meal: 'unknown', items: [] } })
  }
  return records.length ? records : [{ type: 'memo', title: '原文待确认', content: input.text,
    eventDate: today.toString(), status: 'review', confidence: 0, data: { tags: [] } }]
}
