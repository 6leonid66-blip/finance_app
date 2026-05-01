/** קטגוריות ברירת מחדל — ניתן לעדכן לפי הגיליון שלך.
 * סיכומים ופילוחים משתמשים בשורות שכבר סוננו לפי חשבון ומצב אישי/משותף ב-App. */
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
  'עסק — כללי',
  'עסק — ציוד, משרד ומחשוב',
  'עסק — שיווק ופרסום',
  'עסק — נסיעות ורכב',
  'עסק — שירותים מקצועיים',
  'עסק — מנויים, תוכנה ואחסון',
  'עסק — מסים וביטוח עסקי',
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
