export type Kind = 'diet' | 'workout' | 'memo' | 'todo'
export const kinds: Kind[] = ['diet', 'workout', 'memo', 'todo']
export const labels: Record<Kind, string> = { diet: '饮食', workout: '健身', memo: '备忘', todo: '待办' }
export const mealLabels = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐', unknown: '未指定' } as const
export const priorityLabels = { low: '低', normal: '普通', high: '高' } as const
export const repeatLabels = { none: '不重复', daily: '每天', weekly: '每周', monthly: '每月' } as const
export const intensityLabels = { light: '轻度', moderate: '中等', vigorous: '高强度' } as const
export const goalLabels = { cut: '减脂', maintain: '维持', gain: '增肌' } as const

export interface Nutrition { kcal: number; protein: number; carbs: number; fat: number }
export type Nutrient = keyof Nutrition
export interface Goals {
  mode: keyof typeof goalLabels
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}
export interface DietItem {
  name: string
  quantity?: number | null
  unit?: string
  grams?: number | null
  cooking?: string
  estimated?: boolean
  nutrition?: Nutrition | null
  nutritionSource?: string
  manualNutrition?: boolean
}
export interface WorkoutSet { weightKg?: number | null; reps?: number | null }
export interface WorkoutExercise { name: string; sets: WorkoutSet[] }
export interface Payloads {
  diet: { meal: keyof typeof mealLabels; items: DietItem[] }
  workout: { muscleGroups: string[]; durationMinutes?: number | null; intensity?: keyof typeof intensityLabels | null; exercises: WorkoutExercise[]; estimatedKcal?: number | null; volumeKg?: number }
  memo: { tags: string[] }
  todo: { startAt?: string | null; dueAt?: string | null; remindAt?: string | null; repeat?: keyof typeof repeatLabels; priority?: keyof typeof priorityLabels; completed?: boolean }
}
export type RecordInput = {
  [K in Kind]: { type: K; title: string; content: string; eventDate: string; note?: string; status?: 'confirmed' | 'review'; data: Payloads[K] }
}[Kind]
export type LifeRecord = RecordInput & {
  id: string
  timezone: string
  createdAt: string
  updatedAt: string
  confidence: number | null
  source: 'manual' | 'wechat' | 'demo'
  rawMessageId: string | null
  imageId: string | null
  originalText: string | null
  aiVersion: string | null
}
export interface Me {
  id: string; name: string; timezone: string; weightKg: number | null; bound: boolean; goals: Goals
}
export interface Status {
  mode: 'demo' | 'production'; ai: 'local' | 'remote' | 'unconfigured'; wechat: boolean; notifications: 'in-app'; vision: boolean
}
export interface DayStats extends Nutrition {
  date: string; workouts: number; minutes: number; estimatedKcal: number; volumeKg: number; todos: number; completed: number
}
export interface Stats {
  today: string
  timezone: string
  days: DayStats[]
  week: Pick<DayStats, 'workouts' | 'minutes' | 'estimatedKcal' | 'volumeKg'> & { groups: Record<string, number> }
  totals: Pick<DayStats, 'workouts' | 'minutes' | 'estimatedKcal' | 'volumeKg' | 'todos' | 'completed'> & { completionRate: number }
  exerciseTrends: { name: string; points: { date: string; weightKg: number }[] }[]
  nutritionUnknownToday: number
}
export interface Summary { date: string; todoCount: number; dueReminders: number; generatedAt: string | null }
export interface Job { id: string; status: string; attempts: number; error: string | null; source: 'demo' | 'wechat'; createdAt: string; updatedAt: string; rawMessageId: string }
export interface DemoReply { messageId: string; duplicate: boolean; status: string; reply: string; jobId?: string }

export const emptyNutrition: Nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
export const nutrientLabels: { key: Nutrient; name: string; unit: string; color: string }[] = [
  { key: 'kcal', name: '热量', unit: 'kcal', color: '#329b79' },
  { key: 'protein', name: '蛋白质', unit: 'g', color: '#329b79' },
  { key: 'carbs', name: '碳水化合物', unit: 'g', color: '#6984d5' },
  { key: 'fat', name: '脂肪', unit: 'g', color: '#ce8651' },
]