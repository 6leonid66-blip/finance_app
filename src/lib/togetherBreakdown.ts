import type { FinanceEntry, FinancialAccount, HouseholdMemberBrief } from '../types'
import { memberFirstName } from './memberColor'

export type PersonMonthTotals = {
  id: string
  name: string
  income: number
  expense: number
  remaining: number
  topExpenses: Array<{ category: string; amount: number }>
}

export type TogetherBreakdown = {
  people: PersonMonthTotals[]
  shared: PersonMonthTotals
  household: PersonMonthTotals
}

function emptyTotals(id: string, name: string): PersonMonthTotals {
  return { id, name, income: 0, expense: 0, remaining: 0, topExpenses: [] }
}

function addAmount(bucket: PersonMonthTotals, entry: Pick<FinanceEntry, 'type' | 'amount' | 'category'>) {
  const amount = Number(entry.amount)
  if (!Number.isFinite(amount) || amount <= 0) return
  if (entry.type === 'income') bucket.income += amount
  else bucket.expense += amount
}

function finalize(bucket: PersonMonthTotals, expenseByCategory: Map<string, number>) {
  bucket.remaining = bucket.income - bucket.expense
  bucket.topExpenses = Array.from(expenseByCategory.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
}

/** שייך תנועה לאדם לפי חשבון אישי, אחרת לבעלים, אחרת למשותף. */
export function entryAssigneeId(
  entry: Pick<FinanceEntry, 'account_id' | 'owner_id'>,
  accounts: FinancialAccount[],
): 'shared' | string {
  const account = accounts.find((a) => a.id === entry.account_id)
  if (account?.is_shared) return 'shared'
  if (account?.owner_user_id) return account.owner_user_id
  return entry.owner_id || 'shared'
}

export function computeTogetherBreakdown(
  entries: FinanceEntry[],
  accounts: FinancialAccount[],
  members: HouseholdMemberBrief[],
  currentUserId: string,
): TogetherBreakdown {
  const actual = entries.filter((e) => !e.planned)
  const people = members
    .slice()
    .sort((a, b) => {
      if (a.userId === currentUserId) return -1
      if (b.userId === currentUserId) return 1
      return 0
    })
    .map((m) => emptyTotals(m.userId, memberFirstName(m.displayName)))
  const shared = emptyTotals('shared', 'משותף')
  const household = emptyTotals('household', 'כל הבית')
  const cats = new Map<string, Map<string, number>>()

  const bumpCat = (id: string, category: string, amount: number) => {
    if (!cats.has(id)) cats.set(id, new Map())
    const map = cats.get(id)!
    map.set(category, (map.get(category) ?? 0) + amount)
  }

  for (const entry of actual) {
    addAmount(household, entry)
    if (entry.type === 'expense') {
      bumpCat('household', (entry.category ?? '').trim() || 'אחר', Number(entry.amount) || 0)
    }
    const assignee = entryAssigneeId(entry, accounts)
    const target = assignee === 'shared' ? shared : people.find((p) => p.id === assignee)
    if (!target) {
      addAmount(shared, entry)
      if (entry.type === 'expense') {
        bumpCat('shared', (entry.category ?? '').trim() || 'אחר', Number(entry.amount) || 0)
      }
      continue
    }
    addAmount(target, entry)
    if (entry.type === 'expense') {
      bumpCat(target.id, (entry.category ?? '').trim() || 'אחר', Number(entry.amount) || 0)
    }
  }

  for (const person of people) finalize(person, cats.get(person.id) ?? new Map())
  finalize(shared, cats.get('shared') ?? new Map())
  finalize(household, cats.get('household') ?? new Map())
  return { people, shared, household }
}

export function monthLabelHe(monthKey: string): string {
  const [y, m] = monthKey.slice(0, 7).split('-').map(Number)
  if (!y || !m) return monthKey
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
}

/** סיכום יועץ קצר מהמספרים — משמש גם כגיבוי אם אין Gemini. */
export function localAdvisorSummary(monthKey: string, breakdown: TogetherBreakdown): string {
  const month = monthLabelHe(monthKey)
  const lines: string[] = [`סיכום משק הבית · ${month}`, '']
  lines.push(
    `כל הבית: הכנסות ${Math.round(breakdown.household.income)} ₪, הוצאות ${Math.round(breakdown.household.expense)} ₪, נשאר ${Math.round(breakdown.household.remaining)} ₪.`,
  )
  for (const person of breakdown.people) {
    const tone =
      person.remaining < 0
        ? 'ההוצאות גבוהות מההכנסות החודש.'
        : person.remaining === 0
          ? 'האיזון מאופס.'
          : 'יש עודף שאפשר לחסוך או להעביר לחודש הבא.'
    const top = person.topExpenses[0]
    lines.push(
      `${person.name}: הכנסות ${Math.round(person.income)} ₪, הוצאות ${Math.round(person.expense)} ₪, נשאר ${Math.round(person.remaining)} ₪. ${tone}${
        top ? ` הקטגוריה הכבדה: ${top.category} (${Math.round(top.amount)} ₪).` : ''
      }`,
    )
  }
  if (breakdown.shared.expense > 0 || breakdown.shared.income > 0) {
    lines.push(
      `משותף: הכנסות ${Math.round(breakdown.shared.income)} ₪, הוצאות ${Math.round(breakdown.shared.expense)} ₪, נשאר ${Math.round(breakdown.shared.remaining)} ₪.`,
    )
  }
  lines.push('')
  if (breakdown.household.remaining < 0) {
    lines.push('מסקנה: החודש בגרעון. כדאי לקבע תקרה לקטגוריה הכבדה ביותר ולהעביר הוצאות משתנות לשבוע הבא.')
  } else {
    lines.push('מסקנה: יש יתרה חיובית. מומלץ לייעד חלק לחסכון קבוע לפני שההוצאות המשתנות גדלות.')
  }
  return lines.join('\n')
}
