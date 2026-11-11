import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'
import { nutritionFor, portionGrams } from './nutrition.js'

export const LocalDateSchema = z.iso.date().refine(date => {
  try { return Temporal.PlainDate.from(date).year >= 1900 && Temporal.PlainDate.from(date).year <= 2200 } catch { return false }
}, '日期超出支持范围')

const instant = z.iso.datetime({ offset: true }).refine(value => {
  try { return Number.isFinite(Temporal.Instant.from(value).epochMilliseconds) } catch { return false }
}, '时间格式无效').nullable().optional()
const maybeNumber = (max: number) => z.number().finite().min(0).max(max).nullable().optional()
const label = z.string().trim().min(1).max(100)
const nutrient = z.object({
  kcal: z.number().finite().min(0).max(100000), protein: z.number().finite().min(0).max(10000),
  carbs: z.number().finite().min(0).max(10000), fat: z.number().finite().min(0).max(10000),
}).strict()
const meal = z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'unknown'])
const dietItem = z.object({
  name: label, quantity: maybeNumber(100000), unit: z.string().trim().max(24).optional(),
  grams: maybeNumber(100000), cooking: z.string().trim().max(80).optional(), estimated: z.boolean().optional(),
  nutrition: nutrient.nullable().optional(), nutritionSource: z.string().max(160).optional(), manualNutrition: z.boolean().optional(),
}).strict()
const set = z.object({ weightKg: maybeNumber(5000), reps: z.number().int().min(0).max(1000).nullable().optional() }).strict()
const exercise = z.object({ name: label, sets: z.array(set).max(100) }).strict()
const intensity = z.enum(['light', 'moderate', 'vigorous']).nullable().optional()
const workout = z.object({
  muscleGroups: z.array(label).max(20), durationMinutes: maybeNumber(1440), intensity,
  exercises: z.array(exercise).max(30), estimatedKcal: maybeNumber(100000), volumeKg: z.number().min(0).max(10000000000).optional(),
}).strict()
const memo = z.object({ tags: z.array(z.string().trim().min(1).max(40)).max(30) }).strict()
const todoFields = z.object({
  startAt: instant, dueAt: instant, remindAt: instant, repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(), completed: z.boolean().optional(),
}).strict()
function validTodoTimes(data: { startAt?: string | null; dueAt?: string | null }) {
  if (!data.startAt || !data.dueAt) return true
  try { return Temporal.Instant.compare(data.startAt, data.dueAt) <= 0 } catch { return false }
}
const todoTimeError = { path: ['dueAt'], message: '截止时间不能早于开始时间' }
const todo = todoFields.refine(validTodoTimes, todoTimeError)

const base = {
  title: z.string().trim().min(1).max(140), content: z.string().max(8000), eventDate: LocalDateSchema,
  note: z.string().max(1500).optional(), status: z.enum(['confirmed', 'review']).optional(),
}
const diet = z.object({ meal, items: z.array(dietItem).max(80) }).strict()
const recordObjects = [
  z.object({ ...base, type: z.literal('diet'), data: diet }).strict(),
  z.object({ ...base, type: z.literal('workout'), data: workout }).strict(),
  z.object({ ...base, type: z.literal('memo'), data: memo }).strict(),
  z.object({ ...base, type: z.literal('todo'), data: todo }).strict(),
] as const

export const RecordInputSchema = z.discriminatedUnion('type', recordObjects)
export type RecordInput = z.infer<typeof RecordInputSchema>
export type ParsedRecord = RecordInput & { confidence: number }

const aiDietItem = dietItem.omit({ nutrition: true, nutritionSource: true, manualNutrition: true })
const extractionMeta = { confidence: z.number().min(0).max(1) }
export const ParseResultSchema = z.object({ records: z.array(z.discriminatedUnion('type', [
  recordObjects[0].extend({ ...extractionMeta, data: diet.extend({ items: z.array(aiDietItem).max(80) }) }),
  recordObjects[1].extend({ ...extractionMeta, data: workout.omit({ estimatedKcal: true, volumeKg: true }) }),
  recordObjects[2].extend(extractionMeta),
  recordObjects[3].extend({ ...extractionMeta, data: todoFields.omit({ completed: true }).refine(validTodoTimes, todoTimeError) }),
])).min(1).max(16) }).strict()

export function normalizeRecord(record: RecordInput, weightKg?: number | null): RecordInput {
  if (record.type === 'diet') {
    const items = record.data.items.map(item => {
      const portion = item.grams == null ? portionGrams(item.name, item.quantity, item.unit) : null
      const grams = item.grams ?? portion?.grams ?? null
      const estimated = Boolean(item.estimated || portion?.estimated)
      if (item.manualNutrition && item.nutrition) {
        return { ...item, grams, estimated, nutritionSource: '用户填写', manualNutrition: true }
      }
      const calculated = nutritionFor(item.name, grams, item.cooking)
      return { ...item, grams, estimated: estimated || Boolean(calculated), nutrition: calculated?.nutrition ?? null,
        nutritionSource: calculated?.nutritionSource, manualNutrition: false }
    })
    return { ...record, data: { ...record.data, items } }
  }
  if (record.type === 'workout') {
    const { durationMinutes, intensity: effort, exercises } = record.data
    const volumeKg = exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) =>
      sum + (set.weightKg ?? 0) * (set.reps ?? 0), 0), 0)
    const context = [record.title, ...exercises.map(exercise => exercise.name)].join(' ')
    const resistance = /力量|硬拉|卧推|练[胸背臀腿肩手臂核心]|深蹲|推举|下拉|飞鸟|弯举|俯卧撑|划船/.test(context)
    const met = /跑步|慢跑/.test(context) ? (effort === 'vigorous' ? 9.3 : 7.5)
      : /步行|散步|健走/.test(context) ? (effort === 'vigorous' ? 4.8 : 3.5)
      : resistance ? (effort === 'vigorous' ? 6 : effort === 'light' ? 3 : 3.5)
      : null
    const estimatedKcal = weightKg && durationMinutes && met ? Math.round(met * 3.5 * weightKg / 200 * durationMinutes) : null
    return { ...record, data: { ...record.data, volumeKg, estimatedKcal } }
  }
  if (record.type === 'todo') {
    const { startAt, dueAt, remindAt } = record.data
    const iso = (value?: string | null) => value ? new Date(value).toISOString() : null
    return { ...record, data: { ...record.data, startAt: iso(startAt), dueAt: iso(dueAt), remindAt: iso(remindAt) } }
  }
  return { ...record, data: { tags: [...new Set(record.data.tags)] } }
}
