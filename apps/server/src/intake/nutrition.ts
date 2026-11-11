// USDA FoodData Central SR Legacy (2018-04), kcal and grams per 100 g edible portion, CC0.
// The FDC IDs preserve the exact reference behind each generic food mapping.
type Food = { name: string; aliases: string[]; fdc: number; values: [number, number, number, number] }
export const foods: Food[] = [
  { name: '米饭', aliases: ['白米饭', '熟米饭', '白饭', '米饭'], fdc: 169757, values: [130, 2.69, 28.17, 0.28] },
  { name: '糙米饭', aliases: ['糙米饭'], fdc: 169704, values: [123, 2.74, 25.58, 0.97] },
  { name: '面条', aliases: ['煮面条', '鸡蛋面', '面条', '挂面'], fdc: 169762, values: [138, 4.54, 25.16, 2.07] },
  { name: '鸡蛋', aliases: ['水煮鸡蛋', '水煮蛋', '煮鸡蛋', '白煮蛋', '鸡蛋'], fdc: 173424, values: [155, 12.58, 1.12, 10.61] },
  { name: '全脂牛奶', aliases: ['全脂牛奶', '纯牛奶', '鲜牛奶', '牛奶'], fdc: 172217, values: [61, 3.15, 4.78, 3.27] },
  { name: '鸡胸肉', aliases: ['烤鸡胸肉', '鸡胸肉', '鸡胸'], fdc: 171477, values: [165, 31.02, 0, 3.57] },
  { name: '牛肉', aliases: ['瘦牛肉', '烤牛肉', '牛肉'], fdc: 174031, values: [217, 26.11, 0, 11.75] },
  { name: '瘦猪肉', aliases: ['猪里脊', '瘦猪肉', '猪瘦肉', '猪肉'], fdc: 168250, values: [143, 26.17, 0, 3.51] },
  { name: '鲤鱼', aliases: ['鲤鱼'], fdc: 174185, values: [162, 22.86, 0, 7.17] },
  { name: '三文鱼', aliases: ['三文鱼', '鲑鱼'], fdc: 175168, values: [206, 22.1, 0, 12.35] },
  { name: '罗非鱼', aliases: ['罗非鱼'], fdc: 175177, values: [128, 26.15, 0, 2.65] },
  { name: '大白菜', aliases: ['大白菜', '白菜'], fdc: 169980, values: [14, 1.5, 2.41, 0.17] },
  { name: '小白菜', aliases: ['小白菜', '青菜', '小油菜'], fdc: 170391, values: [12, 1.56, 1.78, 0.16] },
  { name: '菠菜', aliases: ['菠菜'], fdc: 168463, values: [23, 2.97, 3.75, 0.26] },
  { name: '西兰花', aliases: ['西兰花', '青花菜'], fdc: 169967, values: [35, 2.38, 7.18, 0.41] },
  { name: '苹果', aliases: ['苹果'], fdc: 171688, values: [52, 0.26, 13.81, 0.17] },
  { name: '香蕉', aliases: ['香蕉'], fdc: 173944, values: [89, 1.09, 22.84, 0.33] },
  { name: '橙子', aliases: ['橙子', '甜橙'], fdc: 169097, values: [47, 0.94, 11.75, 0.12] },
  { name: '白面包', aliases: ['白面包', '白吐司', '吐司', '面包'], fdc: 174924, values: [266, 8.85, 49.42, 3.33] },
  { name: '豆腐', aliases: ['普通豆腐', '豆腐'], fdc: 172476, values: [76, 8.08, 1.87, 4.78] },
  { name: '豆浆', aliases: ['豆浆', '豆奶'], fdc: 172446, values: [54, 3.27, 6.28, 1.75] },
  { name: '红薯', aliases: ['水煮红薯', '红薯', '地瓜'], fdc: 168484, values: [76, 1.37, 17.72, 0.14] },
  { name: '甜玉米', aliases: ['甜玉米', '玉米'], fdc: 169999, values: [96, 3.41, 20.98, 1.5] },
  { name: '原味酸奶', aliases: ['原味酸奶', '酸奶'], fdc: 171284, values: [61, 3.47, 4.66, 3.25] },
  { name: '黄瓜', aliases: ['黄瓜'], fdc: 168409, values: [15, 0.65, 3.63, 0.11] },
  { name: '番茄', aliases: ['西红柿', '番茄'], fdc: 170457, values: [18, 0.88, 3.89, 0.2] },
  { name: '土豆', aliases: ['水煮土豆', '马铃薯', '土豆'], fdc: 170438, values: [87, 1.87, 20.13, 0.1] },
  { name: '大豆油', aliases: ['大豆油', '豆油'], fdc: 171411, values: [884, 0, 0, 100] },
]

const byAlias = new Map(foods.flatMap(food => [...new Set([food.name, ...food.aliases])].map(alias => [alias, food] as const)))
export const foodAliases = [...byAlias.keys(), '鱼肉', '水果', '蔬菜'].sort((a, b) => b.length - a.length)

const round = (value: number) => Math.round(value * 100) / 100

export function nutritionFor(name: string, grams: number | null | undefined, cooking = '') {
  // 烹饪差异可能显著改变油脂与水分，无法匹配时保留缺失。
  const food = /煎|炒|炸|红烧|生食|裹粉|卤制/.test(cooking) ? undefined : byAlias.get(name.trim())
  if (!food || grams == null) return null
  const [kcal, protein, carbs, fat] = food.values.map(value => round(value * grams / 100))
  return { nutrition: { kcal, protein, carbs, fat }, nutritionSource: `USDA FoodData Central SR Legacy · FDC ${food.fdc}` }
}

export function portionGrams(name: string, quantity: number | null | undefined, unit = '') {
  if (quantity == null) return null
  const normalized = unit.trim().toLowerCase()
  if (['克', 'g', '公克'].includes(normalized)) return { grams: quantity, estimated: false }
  if (['千克', '公斤', 'kg'].includes(normalized)) return { grams: round(quantity * 1000), estimated: false }
  if (normalized === '斤') return { grams: round(quantity * 500), estimated: false }
  const food = byAlias.get(name.trim())
  if (!food) return null
  const gramsPerUnit = (food.fdc === 173424 && /^(个|枚)$/.test(normalized)) ? 50
    : (food.fdc === 174924 && normalized === '片') ? 29
    : (food.fdc === 171688 && normalized === '个') ? 182
    : (food.fdc === 173944 && /^(个|根)$/.test(normalized)) ? 118
    : (food.fdc === 169097 && normalized === '个') ? 131
    : (food.fdc === 172217 && /^(ml|毫升)$/.test(normalized)) ? 244 / 236.588
    : null
  return gramsPerUnit == null ? null : { grams: round(quantity * gramsPerUnit), estimated: true }
}
