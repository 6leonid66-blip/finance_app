import type { FinanceEntry, RecurringTemplate } from '../types'
import { inclusiveMonthSpan, installmentIndex } from './recurringProgress'

export function templateAppliesToMonth(row: RecurringTemplate, monthKey: string): boolean {
  if (!row.active) return false
  const start = row.template_start_month?.slice(0, 7)
  if (!start || monthKey < start) return false
  if (row.end_rule === 'until_month') {
    const end = row.end_month?.slice(0, 7)
    if (end && monthKey > end) return false
  }
  if (row.end_rule === 'fixed_installments' && row.max_installments) {
    const idx = installmentIndex(row.template_start_month, monthKey, row.max_installments)
    const span = inclusiveMonthSpan(start, monthKey)
    if (span > row.max_installments || idx > row.max_installments) return false
  }
  return true
}

export function templateAmount(row: RecurringTemplate): number {
  if (row.mode !== 'fixed_amount') return 0
  const n = Number(row.default_amount)
  return Number.isFinite(n) ? Math.abs(n) : 0
}

export function computeMonthForecast(params: {
  monthKey: string
  entries: FinanceEntry[]
  templates: RecurringTemplate[]
  skippedTemplateIds?: Set<string>
}) {
  const { monthKey, entries, templates, skippedTemplateIds } = params
  const actual = entries.filter((e) => !e.planned && e.occurred_on.slice(0, 7) === monthKey)
  const actualIncome = actual.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0)
  const actualExpense = actual.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0)

  let recurringIncome = 0
  let recurringExpense = 0
  let pendingRecurringExpense = 0
  let pendingRecurringIncome = 0
  let pendingCount = 0

  for (const row of templates) {
    if (!templateAppliesToMonth(row, monthKey)) continue
    if (skippedTemplateIds?.has(row.id) || row.skippedThisMonth) continue
    const amt = templateAmount(row)
    if (amt <= 0) continue
    const posted = actual.some((e) => e.auto_post_template_id === row.id)
    if (row.direction === 'income') {
      recurringIncome += amt
      if (!posted) {
        pendingRecurringIncome += amt
        pendingCount += 1
      }
    } else {
      recurringExpense += amt
      if (!posted) {
        pendingRecurringExpense += amt
        pendingCount += 1
      }
    }
  }

  const expectedIncome = Math.max(actualIncome, recurringIncome)
  const expectedExpense = Math.max(actualExpense, recurringExpense)
  const remainingToSpend = expectedIncome - actualExpense - pendingRecurringExpense
  const expectedBalance = expectedIncome - expectedExpense

  const [y, m] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const dayOfMonth = todayKey === monthKey ? today.getDate() : daysInMonth
  const postedRecurringExpense = actual
    .filter((e) => e.type === 'expense' && e.auto_post_template_id)
    .reduce((s, e) => s + e.amount, 0)
  const variableSpend = Math.max(0, actualExpense - postedRecurringExpense)
  const dailyRate = dayOfMonth > 0 ? variableSpend / dayOfMonth : 0
  const projectedVariable = dailyRate * daysInMonth
  const endOfMonthForecast = expectedIncome - recurringExpense - projectedVariable

  return {
    actualIncome,
    actualExpense,
    recurringIncome,
    recurringExpense,
    pendingRecurringExpense,
    pendingRecurringIncome,
    pendingCount,
    expectedIncome,
    expectedExpense,
    remainingToSpend,
    expectedBalance,
    endOfMonthForecast,
    balanceActual: actualIncome - actualExpense,
  }
}
