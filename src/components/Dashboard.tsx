import { useEffect, useMemo, useState } from 'react'
import type { FinanceEntry, MonthlyPlan, RecurringTemplate } from '../types'
import { colorForCategory } from '../lib/categoryColors'
import { supabase } from '../supabase'
import { formatIls, formatSignedIls } from '../lib/money'
import { computeMonthForecast } from '../lib/forecast'
import { EXPENSE_CATEGORIES, categoryIcon } from '../constants/categories'
import { monthValueToFirstDay, shiftMonthValue } from '../lib/month'

type DashboardProps = {
  selectedMonth: string
  entries: FinanceEntry[]
  historyEntries: Array<{ type: 'income' | 'expense'; amount: number; occurred_on: string; planned: boolean }>
  templates: RecurringTemplate[]
  householdId: string
  loading: boolean
}

function pct(actual: number, planned: number) {
  if (planned <= 0) return 0
  return Math.min(100, Math.round((actual / planned) * 100))
}

function monthShort(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'short' })
}

export function Dashboard({
  selectedMonth,
  entries,
  historyEntries,
  templates,
  householdId,
  loading,
}: DashboardProps) {
  const [plans, setPlans] = useState<MonthlyPlan[]>([])
  const [budgetCategory, setBudgetCategory] = useState(EXPENSE_CATEGORIES[0] ?? 'מזון')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetSaving, setBudgetSaving] = useState(false)

  const forecast = useMemo(
    () => computeMonthForecast({ monthKey: selectedMonth, entries, templates }),
    [selectedMonth, entries, templates],
  )

  const [y, m] = selectedMonth.split('-').map(Number)
  const prevDate = new Date(y, m - 2, 1)
  const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
  const prevRows = historyEntries.filter((entry) => !entry.planned && entry.occurred_on.startsWith(prevKey))
  const prevExpense = prevRows.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0)
  const expenseDelta = prevExpense > 0 ? ((forecast.actualExpense - prevExpense) / prevExpense) * 100 : null

  useEffect(() => {
    if (!supabase) return
    const monthDate = monthValueToFirstDay(selectedMonth)
    void supabase
      .from('monthly_plans')
      .select('id,category,planned_income,planned_expense')
      .eq('household_id', householdId)
      .eq('month_date', monthDate)
      .then(({ data }) => setPlans((data ?? []) as MonthlyPlan[]))
  }, [householdId, selectedMonth])

  const expenseDistribution = useMemo(() => {
    const expenses = entries.filter((entry) => entry.type === 'expense' && !entry.planned)
    const byCategory = new Map<string, number>()
    expenses.forEach((entry) => {
      const amount = Number(entry.amount)
      if (!Number.isFinite(amount) || amount <= 0) return
      const key = (entry.category ?? '').trim() || 'אחר'
      byCategory.set(key, (byCategory.get(key) ?? 0) + amount)
    })
    const total = Array.from(byCategory.values()).reduce((sum, value) => sum + value, 0)
    return Array.from(byCategory.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        color: colorForCategory(category),
        pctExpense: total > 0 ? (amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [entries])

  const pieGradient = useMemo(() => {
    if (!expenseDistribution.length) return 'conic-gradient(var(--track) 0deg 360deg)'
    const total = expenseDistribution.reduce((s, r) => s + r.amount, 0)
    let start = 0
    const parts = expenseDistribution.map((row) => {
      const span = (row.amount / total) * 360
      const end = start + span
      const part = `${row.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`
      start = end
      return part
    })
    return `conic-gradient(${parts.join(', ')})`
  }, [expenseDistribution])

  const sixMonths = useMemo(() => {
    const keys = Array.from({ length: 6 }, (_, i) => shiftMonthValue(selectedMonth, i - 5))
    const grouped = new Map(keys.map((key) => [key, { income: 0, expense: 0 }]))
    historyEntries.forEach((entry) => {
      if (entry.planned) return
      const key = entry.occurred_on.slice(0, 7)
      const row = grouped.get(key)
      if (!row) return
      if (entry.type === 'income') row.income += entry.amount
      if (entry.type === 'expense') row.expense += entry.amount
    })
    const max = Math.max(1, ...keys.map((k) => Math.max(grouped.get(k)?.income ?? 0, grouped.get(k)?.expense ?? 0)))
    return keys.map((key) => {
      const row = grouped.get(key) ?? { income: 0, expense: 0 }
      return {
        key,
        label: monthShort(key),
        income: row.income,
        expense: row.expense,
        incomeH: Math.max(4, (row.income / max) * 100),
        expenseH: Math.max(4, (row.expense / max) * 100),
      }
    })
  }, [historyEntries, selectedMonth])

  const budgetRows = useMemo(() => {
    return plans
      .filter((p) => p.planned_expense > 0)
      .map((p) => {
        const spent = entries
          .filter((e) => e.type === 'expense' && !e.planned && e.category === p.category)
          .reduce((s, e) => s + e.amount, 0)
        const ratio = p.planned_expense > 0 ? spent / p.planned_expense : 0
        const tone = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok'
        return { ...p, spent, ratio, tone }
      })
      .sort((a, b) => b.ratio - a.ratio)
  }, [plans, entries])

  const saveBudget = async () => {
    if (!supabase) return
    const amt = Number(budgetAmount)
    if (!amt || amt <= 0) return
    setBudgetSaving(true)
    const monthDate = monthValueToFirstDay(selectedMonth)
    const { error } = await supabase.from('monthly_plans').upsert(
      {
        household_id: householdId,
        month_date: monthDate,
        category: budgetCategory,
        planned_expense: amt,
        planned_income: 0,
      },
      { onConflict: 'household_id,month_date,category' },
    )
    if (!error) {
      const { data } = await supabase
        .from('monthly_plans')
        .select('id,category,planned_income,planned_expense')
        .eq('household_id', householdId)
        .eq('month_date', monthDate)
      setPlans((data ?? []) as MonthlyPlan[])
      setBudgetAmount('')
    }
    setBudgetSaving(false)
  }

  return (
    <div className="dashboard">
      {loading && !entries.length ? (
        <div className="skeleton-list">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : null}

      <article className="hero-remain card">
        <span className="kpi-label">נשאר להוציא החודש</span>
        <strong className={`hero-remain-value ${forecast.remainingToSpend >= 0 ? 'amount-income' : 'amount-expense'}`}>
          {formatIls(forecast.remainingToSpend, { whole: true })}
        </strong>
        <p className="muted small">
          הכנסות צפויות {formatIls(forecast.expectedIncome, { whole: true })}
          {forecast.pendingRecurringExpense > 0
            ? ` · עוד ${formatIls(forecast.pendingRecurringExpense, { whole: true })} קבועים שטרם ירדו`
            : ''}
        </p>
      </article>

      <div className="kpi-grid">
        <article className="kpi-card kpi-income">
          <span className="kpi-label">הכנסות בפועל</span>
          <strong className="kpi-value tabular">{formatIls(forecast.actualIncome, { whole: true })}</strong>
          <span className="kpi-meta">צפוי מקבועים: {formatIls(forecast.recurringIncome, { whole: true })}</span>
        </article>
        <article className="kpi-card kpi-expense">
          <span className="kpi-label">הוצאות בפועל</span>
          <strong className="kpi-value tabular">{formatIls(forecast.actualExpense, { whole: true })}</strong>
          <span className="kpi-meta">קבועים: {formatIls(forecast.recurringExpense, { whole: true })}</span>
        </article>
      </div>

      <div className="balance-cards">
        <div className="balance-card">
          <span>יתרה בפועל</span>
          <strong className="tabular">{formatIls(forecast.balanceActual, { whole: true })}</strong>
        </div>
        <div className="balance-card">
          <span>צפי סוף חודש</span>
          <strong className={`tabular ${forecast.endOfMonthForecast >= 0 ? 'amount-income' : 'amount-expense'}`}>
            {formatIls(forecast.endOfMonthForecast, { whole: true })}
          </strong>
        </div>
      </div>

      {expenseDelta != null ? (
        <p className="muted small dash-insight">
          הוצאות מול חודש קודם: {formatSignedIls(forecast.actualExpense - prevExpense, { whole: true })} (
          {expenseDelta >= 0 ? '+' : ''}
          {expenseDelta.toFixed(0)}%)
        </p>
      ) : null}

      <section className="card">
        <h2 className="card-heading">6 חודשים</h2>
        <div className="six-legend">
          <span className="six-legend-income">הכנסות</span>
          <span className="six-legend-expense">הוצאות</span>
        </div>
        <div className="six-chart" role="img" aria-label="הכנסות והוצאות ב-6 חודשים">
          {sixMonths.map((row) => (
            <div key={row.key} className="six-col">
              <div className="six-bars">
                <div className="six-bar six-bar-income" style={{ height: `${row.incomeH}%` }} title={formatIls(row.income)} />
                <div className="six-bar six-bar-expense" style={{ height: `${row.expenseH}%` }} title={formatIls(row.expense)} />
              </div>
              <span className="six-label">{row.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card-heading">תקציב לפי קטגוריה</h2>
        {budgetRows.length ? (
          <ul className="budget-list">
            {budgetRows.map((row) => (
              <li key={row.id} className="budget-row">
                <div className="budget-row-top">
                  <span>
                    {categoryIcon(row.category)} {row.category}
                  </span>
                  <strong className="tabular">
                    {formatIls(row.spent, { whole: true })} / {formatIls(row.planned_expense, { whole: true })}
                  </strong>
                </div>
                <div className="progress-track">
                  <div
                    className={`progress-fill budget-${row.tone}`}
                    style={{ width: `${Math.min(100, pct(row.spent, row.planned_expense))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">הגדירו תקרה לקטגוריה — תראו כמה נוצל.</p>
        )}
        <div className="budget-add">
          <select value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.filter((c) => !c.startsWith('עסק')).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="תקרה ₪"
            value={budgetAmount}
            onChange={(e) => setBudgetAmount(e.target.value)}
          />
          <button type="button" className="btn-secondary" disabled={budgetSaving} onClick={() => void saveBudget()}>
            שמור
          </button>
        </div>
      </section>

      <section className="card expense-distribution">
        <h2 className="card-heading">חלוקת הוצאות</h2>
        <div className="expense-pie-wrap">
          <div className="expense-pie" style={{ background: pieGradient }} aria-label="חלוקת הוצאות" />
          <div className="expense-legend" role="list">
            {expenseDistribution.slice(0, 8).map((row) => (
              <div key={row.category} className="expense-legend-row" role="listitem">
                <span className="expense-legend-swatch" style={{ background: row.color }} aria-hidden />
                <div className="expense-legend-text">
                  <strong>
                    {categoryIcon(row.category)} {row.category}
                  </strong>
                  <span className="tabular">{formatIls(row.amount)}</span>
                </div>
              </div>
            ))}
            {!expenseDistribution.length ? <p className="muted">אין הוצאות לחודש זה.</p> : null}
          </div>
        </div>
      </section>
    </div>
  )
}
