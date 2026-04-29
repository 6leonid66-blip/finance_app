import type { FinanceEntry, RecurringTemplate } from '../types'

export type CompactLedger = {
  household_id: string
  current_month: string
  scope: 'personal' | 'shared'
  monthly_totals: { income: number; expense: number; balance: number }
  prev_3_months: { month: string; income: number; expense: number }[]
  expense_by_category: { category: string; amount: number }[]
  recent_transactions: {
    id: string
    occurred_on: string
    type: 'income' | 'expense'
    amount: number
    category: string
    note: string | null
    owner_name: string | null
  }[]
  recurring: {
    id: string
    direction: 'income' | 'expense'
    category: string
    label: string | null
    monthly_amount: number | null
    period: string
    active: boolean
  }[]
}

function describePeriod(row: RecurringTemplate, currentMonth: string): string {
  if (row.end_rule === 'unlimited') return 'ללא הגבלה'
  if (row.end_rule === 'until_month') {
    const endMonth = row.end_month?.slice(0, 7)
    return endMonth ? `עד ${endMonth}` : 'עד חודש שייקבע'
  }
  const total = row.max_installments ?? 0
  if (!total) return 'תשלומים'
  const start = row.template_start_month?.slice(0, 7)
  if (!start) return `תשלומים: ${total}`
  const [sy, sm] = start.split('-').map(Number)
  const [cy, cm] = currentMonth.split('-').map(Number)
  if (!sy || !sm || !cy || !cm) return `תשלומים: ${total}`
  const diff = (cy - sy) * 12 + (cm - sm) + 1
  const current = Math.min(Math.max(diff, 1), total)
  return `תשלום ${current} מתוך ${total}`
}

function monthKeyFromDate(value: string): string {
  return value.slice(0, 7)
}

function shiftMonth(monthValue: string, delta: number): string {
  const [y, m] = monthValue.split('-').map(Number)
  if (!y || !m) return monthValue
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type HistoryEntryLite = {
  occurred_on: string
  type: 'income' | 'expense'
  amount: number
  planned: boolean
}

export function buildCompactLedger(params: {
  householdId: string
  currentMonth: string
  scope: 'personal' | 'shared'
  monthlyEntries: FinanceEntry[]
  historyEntries: HistoryEntryLite[]
  recurring: RecurringTemplate[]
}): CompactLedger {
  const { householdId, currentMonth, scope, monthlyEntries, historyEntries, recurring } = params

  const actualMonthly = monthlyEntries.filter((e) => !e.planned)
  const income = actualMonthly.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0)
  const expense = actualMonthly.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0)

  const prevMonths: { month: string; income: number; expense: number }[] = []
  for (let i = 1; i <= 3; i++) {
    const key = shiftMonth(currentMonth, -i)
    const slice = historyEntries.filter((e) => !e.planned && monthKeyFromDate(e.occurred_on) === key)
    prevMonths.push({
      month: key,
      income: slice.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0),
      expense: slice.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0),
    })
  }

  const byCategory = new Map<string, number>()
  for (const e of actualMonthly.filter((x) => x.type === 'expense')) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount)
  }
  const expenseByCategory = Array.from(byCategory.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)

  const recentSorted = [...actualMonthly]
    .sort((a, b) => {
      if (a.occurred_on === b.occurred_on) return b.created_at.localeCompare(a.created_at)
      return b.occurred_on.localeCompare(a.occurred_on)
    })
    .slice(0, 30)
    .map((e) => ({
      id: e.id,
      occurred_on: e.occurred_on,
      type: e.type,
      amount: e.amount,
      category: e.category,
      note: e.note,
      owner_name: e.owner_name ?? null,
    }))

  const recurringCompact = recurring.map((row) => ({
    id: row.id,
    direction: row.direction,
    category: row.category,
    label: row.label ?? null,
    monthly_amount: row.mode === 'fixed_amount' ? Number(row.default_amount) : null,
    period: describePeriod(row, currentMonth),
    active: Boolean(row.active),
  }))

  return {
    household_id: householdId,
    current_month: currentMonth,
    scope,
    monthly_totals: { income, expense, balance: income - expense },
    prev_3_months: prevMonths,
    expense_by_category: expenseByCategory,
    recent_transactions: recentSorted,
    recurring: recurringCompact,
  }
}
