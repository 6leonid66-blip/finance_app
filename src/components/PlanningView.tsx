import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { ALL_PLAN_CATEGORIES, isOtherCategory } from '../constants/categories'
import { monthValueToFirstDay } from '../lib/month'
import type {
  MonthlyPlan,
  RecurringDirection,
  RecurringEndRule,
  RecurringMode,
  RecurringTemplate,
} from '../types'

type PlanningViewProps = {
  plans: MonthlyPlan[]
  householdId: string
  selectedMonth: string
  loading: boolean
  onRefresh: () => void
}

export function PlanningView({ plans, householdId, selectedMonth, loading, onRefresh }: PlanningViewProps) {
  const [recurringList, setRecurringList] = useState<RecurringTemplate[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [category, setCategory] = useState(ALL_PLAN_CATEGORIES[0])
  const [customCategory, setCustomCategory] = useState('')
  const [plannedIncome, setPlannedIncome] = useState('')
  const [plannedExpense, setPlannedExpense] = useState('')
  const [applyRecurring, setApplyRecurring] = useState(false)
  const [recurringTemplateId, setRecurringTemplateId] = useState<string | null>(null)
  const [direction, setDirection] = useState<RecurringDirection>('expense')
  const [mode, setMode] = useState<RecurringMode>('fixed_amount')
  const [label, setLabel] = useState('')
  const [defaultAmount, setDefaultAmount] = useState('')
  const [startMonth, setStartMonth] = useState(selectedMonth)
  const [endRule, setEndRule] = useState<RecurringEndRule>('unlimited')
  const [endMonth, setEndMonth] = useState(selectedMonth)
  const [maxInstallments, setMaxInstallments] = useState('')
  const [autoPostAsActual, setAutoPostAsActual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const resolvedCategory = isOtherCategory(category) ? customCategory.trim() || 'אחר' : category

  const loadRecurring = async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('recurring_templates')
      .select(
        'id,household_id,direction,category,label,mode,default_amount,template_start_month,end_rule,end_month,max_installments,auto_post_as_actual,active,created_at,updated_at',
      )
      .eq('household_id', householdId)
    if (!error) {
      setRecurringList((data ?? []) as RecurringTemplate[])
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRecurring()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId])

  const startEdit = (plan: MonthlyPlan) => {
    setEditingId(plan.id)
    setShowCreate(true)
    if ((ALL_PLAN_CATEGORIES as readonly string[]).includes(plan.category)) {
      setCategory(plan.category)
      setCustomCategory('')
    } else {
      setCategory('אחר')
      setCustomCategory(plan.category)
    }
    setPlannedIncome(String(plan.planned_income))
    setPlannedExpense(String(plan.planned_expense))
    const preferredDirection: RecurringDirection = plan.planned_expense >= plan.planned_income ? 'expense' : 'income'
    const matched = recurringList.find((row) => row.category === plan.category && row.direction === preferredDirection)
    if (matched) {
      setApplyRecurring(true)
      setRecurringTemplateId(matched.id)
      setDirection(matched.direction)
      setMode(matched.mode)
      setLabel(matched.label ?? '')
      setDefaultAmount(String(matched.default_amount ?? 0))
      setStartMonth(matched.template_start_month?.slice(0, 7) ?? selectedMonth)
      setEndRule(matched.end_rule)
      setEndMonth(matched.end_month?.slice(0, 7) ?? selectedMonth)
      setMaxInstallments(matched.max_installments ? String(matched.max_installments) : '')
      setAutoPostAsActual(Boolean(matched.auto_post_as_actual))
    } else {
      setApplyRecurring(false)
      setRecurringTemplateId(null)
      setDirection(preferredDirection)
      setMode('fixed_amount')
      setLabel('')
      setDefaultAmount(
        preferredDirection === 'expense' ? String(plan.planned_expense || 0) : String(plan.planned_income || 0),
      )
      setStartMonth(selectedMonth)
      setEndRule('unlimited')
      setEndMonth(selectedMonth)
      setMaxInstallments('')
      setAutoPostAsActual(false)
    }
    setStatus(null)
  }

  const resetForm = () => {
    setEditingId(null)
    setShowCreate(false)
    setCategory(ALL_PLAN_CATEGORIES[0])
    setCustomCategory('')
    setPlannedIncome('')
    setPlannedExpense('')
    setApplyRecurring(false)
    setRecurringTemplateId(null)
    setDirection('expense')
    setMode('fixed_amount')
    setLabel('')
    setDefaultAmount('')
    setStartMonth(selectedMonth)
    setEndRule('unlimited')
    setEndMonth(selectedMonth)
    setMaxInstallments('')
    setAutoPostAsActual(false)
  }

  const savePlan = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    const monthDate = monthValueToFirstDay(selectedMonth)
    const pi = Number(plannedIncome || 0)
    const pe = Number(plannedExpense || 0)
    const recurringAmount = Number(defaultAmount || 0)
    if (applyRecurring && mode === 'fixed_amount' && recurringAmount <= 0) {
      setStatus('כדי לשמור קבוע עם סכום קבוע יש להזין סכום חיובי.')
      return
    }
    if (applyRecurring && endRule === 'fixed_installments' && Number(maxInstallments || 0) <= 0) {
      setStatus('מספר תשלומים לא תקין.')
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const payload = {
        household_id: householdId,
        month_date: monthDate,
        category: resolvedCategory,
        planned_income: pi,
        planned_expense: pe,
      }
      const { error } = editingId
        ? await supabase.from('monthly_plans').update(payload).eq('id', editingId)
        : await supabase.from('monthly_plans').upsert(payload, { onConflict: 'household_id,month_date,category' })
      if (error) throw error
      if (applyRecurring) {
        const recurringPayload = {
          household_id: householdId,
          direction,
          category: resolvedCategory,
          label: label.trim() || null,
          mode,
          default_amount: mode === 'fixed_amount' ? recurringAmount : 0,
          template_start_month: monthValueToFirstDay(startMonth),
          end_rule: endRule,
          end_month: endRule === 'until_month' ? monthValueToFirstDay(endMonth) : null,
          max_installments: endRule === 'fixed_installments' ? Number(maxInstallments) : null,
          auto_post_as_actual: autoPostAsActual,
          active: true,
        }
        if (recurringTemplateId) {
          const { error: recurringError } = await supabase
            .from('recurring_templates')
            .update(recurringPayload)
            .eq('id', recurringTemplateId)
          if (recurringError) throw recurringError
        } else {
          const { error: recurringError } = await supabase.from('recurring_templates').insert(recurringPayload)
          if (recurringError) throw recurringError
        }
      } else if (recurringTemplateId) {
        const { error: disableErr } = await supabase
          .from('recurring_templates')
          .update({ active: false })
          .eq('id', recurringTemplateId)
        if (disableErr) throw disableErr
      }
      await loadRecurring()
      resetForm()
      setStatus(editingId ? 'השורה עודכנה' : 'נשמר')
      onRefresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  const removePlan = async (id: string) => {
    if (!supabase) return
    setSaving(true)
    setStatus(null)
    try {
      const { error } = await supabase.from('monthly_plans').delete().eq('id', id)
      if (error) throw error
      if (editingId === id) resetForm()
      setStatus('השורה נמחקה')
      onRefresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'מחיקה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen-pad">
      <h2 className="screen-title">תכנון חודשי</h2>
      <p className="panel-intro">תכנון שוטף עם אפשרות להחיל גם הגדרת קבועים מאותו טופס.</p>
      {loading ? <p className="muted">טוען…</p> : null}

      <article className="card card-form toolbar-card recurring-toolbar">
        <div className="toolbar-actions">
          <strong>רשימת תכנון לחודש</strong>
          <button type="button" className="btn-secondary btn-xs" onClick={() => setShowCreate(true)}>
            הוסף חדש
          </button>
        </div>
      </article>

      <article className="card card-form">
        <h3 className="card-heading">שורות תכנון קיימות</h3>
        <div className="bank-table-wrap compact-table-wrap">
          <table className="bank-table compact-table">
            <thead>
              <tr>
                <th>קטגוריה</th>
                <th>הכנסה</th>
                <th>הוצאה</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td data-label="קטגוריה">{plan.category}</td>
                  <td data-label="הכנסה" className="amount-income">
                    {plan.planned_income.toLocaleString()} ₪
                  </td>
                  <td data-label="הוצאה" className="amount-expense">
                    {plan.planned_expense.toLocaleString()} ₪
                  </td>
                  <td data-label="פעולות">
                    <div className="row-actions row-actions-compact">
                      <button type="button" className="btn-secondary btn-xs" onClick={() => startEdit(plan)}>
                        ערוך
                      </button>
                      <button type="button" className="btn-danger btn-xs" onClick={() => void removePlan(plan.id)}>
                        מחק
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!plans.length ? (
                <tr>
                  <td colSpan={4} className="empty">
                    אין שורות תכנון לחודש זה.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {showCreate || editingId ? (
        <div className="modal-backdrop" onClick={resetForm}>
          <article className="card card-form modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-heading">{editingId ? 'עריכת שורת תכנון' : 'הוספת / עדכון קטגוריה'}</h3>
            <form onSubmit={savePlan} className="stack tight">
            <label>
              קטגוריה
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {ALL_PLAN_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            {isOtherCategory(category) ? (
              <label>
                פירוט
                <input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} required />
              </label>
            ) : null}
            <label>
              הכנסה מתוכננת
              <input
                type="number"
                min={0}
                step="0.01"
                value={plannedIncome}
                onChange={(e) => setPlannedIncome(e.target.value)}
              />
            </label>
            <label>
              הוצאה מתוכננת
              <input
                type="number"
                min={0}
                step="0.01"
                value={plannedExpense}
                onChange={(e) => setPlannedExpense(e.target.value)}
              />
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={applyRecurring}
                onChange={(e) => setApplyRecurring(e.target.checked)}
              />
              הגדר/עדכן גם כקבוע
            </label>

            {applyRecurring ? (
              <>
                <div className="segmented">
                  <button
                    type="button"
                    className={direction === 'expense' ? 'seg active' : 'seg'}
                    onClick={() => setDirection('expense')}
                  >
                    הוצאה
                  </button>
                  <button
                    type="button"
                    className={direction === 'income' ? 'seg active' : 'seg'}
                    onClick={() => setDirection('income')}
                  >
                    הכנסה
                  </button>
                </div>
                <div className="segmented">
                  <button
                    type="button"
                    className={mode === 'fixed_amount' ? 'seg active' : 'seg'}
                    onClick={() => setMode('fixed_amount')}
                  >
                    סכום קבוע
                  </button>
                  <button
                    type="button"
                    className={mode === 'variable_budget' ? 'seg active' : 'seg'}
                    onClick={() => setMode('variable_budget')}
                  >
                    תקציב משתנה
                  </button>
                </div>
                <label>
                  תיאור (אופציונלי)
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="למשל: הלוואה רכב" />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={autoPostAsActual}
                    onChange={(e) => setAutoPostAsActual(e.target.checked)}
                  />
                  הכנס אוטומטית גם לפועל
                </label>
                {mode === 'fixed_amount' ? (
                  <label>
                    סכום קבוע (₪)
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={defaultAmount}
                      onChange={(e) => setDefaultAmount(e.target.value)}
                      required
                    />
                  </label>
                ) : null}
                <label>
                  מתחיל מחודש
                  <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} required />
                </label>
                <div className="segmented">
                  <button
                    type="button"
                    className={endRule === 'unlimited' ? 'seg active' : 'seg'}
                    onClick={() => setEndRule('unlimited')}
                  >
                    ללא הגבלה
                  </button>
                  <button
                    type="button"
                    className={endRule === 'until_month' ? 'seg active' : 'seg'}
                    onClick={() => setEndRule('until_month')}
                  >
                    עד חודש
                  </button>
                  <button
                    type="button"
                    className={endRule === 'fixed_installments' ? 'seg active' : 'seg'}
                    onClick={() => setEndRule('fixed_installments')}
                  >
                    מספר תשלומים
                  </button>
                </div>
                {endRule === 'until_month' ? (
                  <label>
                    חודש סיום
                    <input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} required />
                  </label>
                ) : null}
                {endRule === 'fixed_installments' ? (
                  <label>
                    כמות תשלומים
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={maxInstallments}
                      onChange={(e) => setMaxInstallments(e.target.value)}
                      required
                    />
                  </label>
                ) : null}
              </>
            ) : null}

              <div className="edit-actions">
                <button type="button" className="btn-secondary" onClick={resetForm}>
                  ביטול
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'שומר…' : editingId ? 'שמור עדכון' : 'שמור תכנון'}
                </button>
              </div>
            </form>
            {status ? <p className="inline-status">{status}</p> : null}
          </article>
        </div>
      ) : null}
    </div>
  )
}
