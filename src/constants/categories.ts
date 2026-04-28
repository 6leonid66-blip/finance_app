/** קטגוריות ברירת מחדל — ניתן לעדכן לפי הגיליון שלך */
export const EXPENSE_CATEGORIES = [
  'מזון',
  'תרבות ופנאי',
  'רפואה ובריאות',
  'מתנות',
  'דירה / מגורים',
  'שכירות',
  'חשמל',
  'מים',
  'גז',
  'ארנונה',
  'ביטוחים',
  'הלוואה',
  'קנס/דוח',
  'תקשורת ואינטרנט',
  'תחבורה ודלק',
  'ביגוד',
  'חינוך וגן',
  'טיפוח',
  'צדקה וחסד',
  'בית כנסת',
  'אחר',
] as const

export const INCOME_CATEGORIES = [
  'משכורת',
  'הכנסה עצמאית',
  'קיצבה / גמלאות',
  'החזרי מס',
  'מתנה / העברה',
  'הכנסה ממימוש',
  'אחר',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number]

export function isOtherCategory(name: string) {
  return name.trim() === 'אחר'
}

/** לתכנון חודשי — איחוד קטגוריות הכנסה והוצאה */
export const ALL_PLAN_CATEGORIES = Array.from(
  new Set<string>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]),
).sort((a, b) => a.localeCompare(b, 'he'))
