/** קטגוריות למשק בית ישראלי — אייקון + שם. */

export type CategoryDef = {
  name: string
  icon: string
  group: 'home' | 'family' | 'living' | 'business' | 'income' | 'other'
  popular?: boolean
}

export const EXPENSE_CATEGORY_DEFS: readonly CategoryDef[] = [
  { name: 'סופר / מכולת', icon: '🛒', group: 'living', popular: true },
  { name: 'מזון', icon: '🍽️', group: 'living', popular: true },
  { name: 'דירה / מגורים', icon: '🏠', group: 'home', popular: true },
  { name: 'שכירות', icon: '🔑', group: 'home', popular: true },
  { name: 'ועד בית', icon: '🏢', group: 'home', popular: true },
  { name: 'חשמל', icon: '💡', group: 'home', popular: true },
  { name: 'מים', icon: '🚿', group: 'home' },
  { name: 'גז', icon: '🔥', group: 'home' },
  { name: 'ארנונה', icon: '🏛️', group: 'home', popular: true },
  { name: 'תקשורת ואינטרנט', icon: '📶', group: 'home' },
  { name: 'תחבורה ודלק', icon: '⛽', group: 'living', popular: true },
  { name: 'חניה', icon: '🅿️', group: 'living' },
  { name: 'ביטוחים', icon: '🛡️', group: 'family' },
  { name: 'קופת חולים', icon: '🏥', group: 'family', popular: true },
  { name: 'רפואה ובריאות', icon: '💊', group: 'family' },
  { name: 'חינוך וגן', icon: '🎒', group: 'family', popular: true },
  { name: 'חוגים', icon: '🎨', group: 'family', popular: true },
  { name: 'תרבות ופנאי', icon: '🎬', group: 'living' },
  { name: 'ביגוד', icon: '👕', group: 'living' },
  { name: 'טיפוח', icon: '💇', group: 'living' },
  { name: 'מתנות', icon: '🎁', group: 'family' },
  { name: 'צדקה וחסד', icon: '💛', group: 'family' },
  { name: 'בית כנסת', icon: '🕍', group: 'family' },
  { name: 'הלוואה', icon: '🏦', group: 'home' },
  { name: 'קנס/דוח', icon: '📄', group: 'living' },
  { name: 'עסק — כללי', icon: '💼', group: 'business' },
  { name: 'עסק — ציוד, משרד ומחשוב', icon: '🖥️', group: 'business' },
  { name: 'עסק — שיווק ופרסום', icon: '📣', group: 'business' },
  { name: 'עסק — נסיעות ורכב', icon: '🚗', group: 'business' },
  { name: 'עסק — שירותים מקצועיים', icon: '🧾', group: 'business' },
  { name: 'עסק — מנויים, תוכנה ואחסון', icon: '☁️', group: 'business' },
  { name: 'עסק — מסים וביטוח עסקי', icon: '📊', group: 'business' },
  { name: 'אחר', icon: '•••', group: 'other' },
] as const

export const INCOME_CATEGORY_DEFS: readonly CategoryDef[] = [
  { name: 'משכורת', icon: '💵', group: 'income', popular: true },
  { name: 'הכנסה עצמאית', icon: '🧑‍💻', group: 'income', popular: true },
  { name: 'קיצבה / גמלאות', icon: '🧓', group: 'income' },
  { name: 'החזרי מס', icon: '🏛️', group: 'income' },
  { name: 'מתנה / העברה', icon: '🎁', group: 'income' },
  { name: 'הכנסה ממימוש', icon: '📈', group: 'income' },
  { name: 'אחר', icon: '•••', group: 'other' },
] as const

export const EXPENSE_CATEGORIES = EXPENSE_CATEGORY_DEFS.map((c) => c.name)
export const INCOME_CATEGORIES = INCOME_CATEGORY_DEFS.map((c) => c.name)

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number]

const ICON_BY_NAME = new Map<string, string>([
  ...EXPENSE_CATEGORY_DEFS.map((c) => [c.name, c.icon] as const),
  ...INCOME_CATEGORY_DEFS.map((c) => [c.name, c.icon] as const),
])

export function categoryIcon(name: string): string {
  return ICON_BY_NAME.get(name.trim()) ?? '•'
}

export function isOtherCategory(name: string) {
  return name.trim() === 'אחר'
}

export function isBusinessCategory(name: string) {
  return name.trim().startsWith('עסק')
}

export function popularCategories(kind: 'expense' | 'income') {
  const defs = kind === 'expense' ? EXPENSE_CATEGORY_DEFS : INCOME_CATEGORY_DEFS
  const popular = defs.filter((c) => c.popular)
  return popular.length ? popular : defs.slice(0, 8)
}

export function remainingCategories(kind: 'expense' | 'income') {
  const defs = kind === 'expense' ? EXPENSE_CATEGORY_DEFS : INCOME_CATEGORY_DEFS
  return defs.filter((c) => !c.popular)
}

/** לתכנון חודשי — איחוד קטגוריות הכנסה והוצאה (בית לפני עסק) */
export const ALL_PLAN_CATEGORIES = [
  ...EXPENSE_CATEGORIES.filter((c) => !isBusinessCategory(c)),
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES.filter(isBusinessCategory),
]
