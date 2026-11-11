export const defaultZone = 'Asia/Shanghai'
export function zonedParts(value: string | Date, timezone = defaultZone) {
  const date = new Date(value)
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }
  const formatter = new Intl.DateTimeFormat('en-GB', options)
  const fields = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
  return { date: fields.year + '-' + fields.month + '-' + fields.day, time: fields.hour + ':' + fields.minute }
}

export function localToday(timezone = defaultZone) {
  try { return zonedParts(new Date(), timezone).date } catch { return new Date().toISOString().slice(0, 10) }
}

export function shiftDay(date: string, amount: number) {
  const value = new Date(date + 'T00:00:00Z')
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

export function monthDay(date: string) {
  const fields = date.split('-')
  return Number(fields[1]) + '月' + Number(fields[2]) + '日'
}

export function dateHeading(date: string) {
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(date + 'T00:00:00Z').getUTCDay()]
  return monthDay(date) + ' · 星期' + week
}

export function localClock(value: string, timezone = defaultZone) {
  try { return zonedParts(value, timezone) } catch { return { date: value.slice(0, 10), time: value.slice(11, 16) } }
}

// 日期控件返回的是用户所选时区的墙上时间，需要转换为 UTC 时间戳。
export function toUtc(date: string, time: string, timezone: string) {
  const wanted = new Date(date + 'T' + time + ':00Z').getTime()
  let current = wanted
  for (let tries = 0; tries < 3; tries++) {
    const parts = zonedParts(new Date(current), timezone)
    const actual = new Date(parts.date + 'T' + parts.time + ':00Z').getTime()
    if (wanted === actual) return new Date(current).toISOString()
    current += wanted - actual
  }
  throw new Error('该时间在所选时区内不存在，请选择其他时间。')
}

export function numberLabel(value: number, digits = 1) {
  return Number.isFinite(value) ? String(Math.round(value * 10 ** digits) / 10 ** digits) : '—'
}