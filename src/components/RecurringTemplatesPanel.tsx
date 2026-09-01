import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { ALL_PLAN_CATEGORIES, categoryIcon, isOtherCategory } from '../constants/categories'
import { MonthValuePicker } from './MonthValuePicker'
import type { HouseholdMemberBrief, RecurringDirection, RecurringEndRule, RecurringMode, RecurringTemplate } from '../types'
import { getLocalMonthValue, monthValueToFirstDay } from '../lib/month'
import { inclusiveMonthSpan, installmentIndex } from '../lib/recurringProgress'
import { formatIls } from '../lib/money'
import { templateAppliesToMonth, templateAmount } from '../lib/forecast'

type RecurringTemplatesPanelProps = {
  householdId: string
  selectedMonth: string
  onTemplatesChanged: () => void
  members: HouseholdMemberBrief[]
  currentUserId: string
}

export function RecurringTemplatesPanel({
  householdId,
  selectedMonth,
  onTemplatesChanged,
  members,
  currentUserId,
}: RecurringTemplatesPanelProps) {
  const [list, setList] = useState<RecurringTemplate[]>([])
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [direction, setDirection] = useState<RecurringDirection>('expense')
  const [mode, setMode] = useState<RecurringMode>('fixed_amount')
  const [category, setCategory] = useState(ALL_PLAN_CATEGORIES[0] ?? 'אחר')
  const [customCategory, setCustomCategory] = useState('')
  const [label, setLabel] = useState('')
  const [defaultAmount, setDefaultAmount] = useState('')
  const [startMonth, setStartMonth] = useState(selectedMonth)
  const [endRule, setEndRule] = useState<RecurringEndRule>('unlimited')
  const [endMonth, setEndMonth] = useState(selectedMonth)
  const [maxInstallments, setMaxInstallments] = useState('')
  const [ownerUserId, setOwnerUserId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const addMonths = (monthValue: string, months: number) => {
    const [y, m] = monthValue.split('-').map(Number)
    if (!y || !m) return monthValue
    const d = new Date(y, m - 1, 1)
    d.setMonth(d.getMonth() + months)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  const resolvedCategory = isOtherCategory(category) ? customCategory.trim() || 'אחר' : category

  const formatMonthLabel = (monthValue: string) => {
    const [y, m] = monthValue.split('-').map(Number)
    if (!y || !m) return monthValue
    return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'short', year: 'numeric' })
  }

  const ownerLabel = (row: RecurringTemplate) => {
    if (!row.owner_user_id) return 'משותף'
    if (row.owner_user_id === currentUserId) return 'שלי'
    return members.find((m) => m.userId === row.owner_user_id)?.displayName ?? 'אישי'
  }

  const describePeriod = (row: RecurringTemplate) => {
    const startMk = row.template_start_month?.slice(0, 7)
    if (!startMk) return '—'
    if (row.end_rule === 'unlimited') return 'כל חודש'
    if (row.end_rule === 'until_month') {
      const endMonthValue = row.end_month?.slice(0, 7)
      if (!endMonthValue) return 'עד חודש שייקבע'
      const total = inclusiveMonthSpan(startMk, endMonthValue)
      if (!total) return `עד ${formatMonthLabel(endMonthValue)}`
      const idx = installmentIndex(row.template_start_month!, selectedMonth.slice(0, 7), total)
      return `תשלום ${idx} מתוך ${total}`
    }
    const total = row.max_installments ?? 0
    if (!total) return 'תשלומים'
    const idx = installmentIndex(row.template_start_month!, selectedMonth.slice(0, 7), total)
    return `תשלום ${idx} מתוך ${total}`
  }

  const monthKey = selectedMonth.slice(0, 7)

  const visible = list

  const activeFixedTotals = useMemo(() => {
    let income = 0
    let expense = 0
    for (const row of list) {
      if (!row.active || skippedIds.has(row.id) || !templateAppliesToMonth(row, monthKey)) continue
      const amt = templateAmount(row)
      if (row.direction === 'income') income += amt
      else expense += amt
    }
    return { income, expense, balance: income - expense }
  }, [list, skippedIds, monthKey])

  const load = async () => {
    if (!supabase) return
    setLoading(true)
    const monthDate = monthValueToFirstDay(selectedMonth)
    const withOwner = await supabase
      .from('recurring_templates')
      .select(
        'id,household_id,direction,category,label,mode,default_amount,template_start_month,end_rule,end_month,max_installments,active,created_at,updated_at,owner_user_id',
      )
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
    let data = withOwner.data
    let qErr = withOwner.error
    if (qErr && (qErr.code === '42703' || qErr.message?.includes('owner_user_id'))) {
      const fb = await supabase
        .from('recurring_templates')
        .select(
          'id,household_id,direction,category,label,mode,default_amount,template_start_month,end_rule,end_month,max_installments,active,created_at,updated_at',
        )
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
      data = (fb.data ?? []).map((row) => ({ ...row, owner_user_id: null }))
      qErr = fb.error
    }
    const skipsRes = await supabase
      .from('recurring_skips')
      .select('template_id')
      .eq('household_id', householdId)
      .eq('skip_month', monthDate)
    setLoading(false)
    if (qErr) {
      setError(qErr.message)
      return
    }
    setList((data ?? []) as RecurringTemplate[])
    setSkippedIds(new Set(((skipsRes.data ?? []) as Array<{ template_id: string }>).map((r) => r.template_id)))
    setError(null)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, selectedMonth])

  const currentRealMonthFirstDay = () => monthValueToFirstDay(getLocalMonthValue())

  const persistTemplate = async (isEdit: boolean) => {
    if (!supabase) return
    const amt = Number(defaultAmount || 0)
    if (mode === 'fixed_amount' && (!amt || amt <= 0)) {
      setError('יש להזין סכום חודשי חיובי')
      return
    }
    if (
      endRule === 'fixed_installments' &&
      (!Number(maxInstallments || inclusiveMonthSpan(startMonth, endMonth)) ||
        Number(maxInstallments || inclusiveMonthSpan(startMonth, endMonth)) <= 0)
    ) {
      setError('מספר התשלומים חייב להיות לפחות 1')
      return
    }
    if (endRule !== 'unlimited' && !endMonth) {
      setError('יש לבחור חודש סיום')
      return
    }
    if (endRule === 'until_month' && endMonth && startMonth && endMonth.slice(0, 7) < startMonth.slice(0, 7)) {
      setError('חודש הסיום חייב להיות אחרי תאריך ההתחלה או מאותה נקודה')
      return
    }
    setSaving(true)
    setError(null)
    const payload: Record<string, unknown> = {
      household_id: householdId,
      direction,
      category: resolvedCategory,
      label: label.trim() || null,
      mode,
      default_amount: mode === 'fixed_amount' ? amt : 0,
      template_start_month: monthValueToFirstDay(startMonth),
      end_rule: endRule,
      end_month: endRule === 'unlimited' ? null : monthValueToFirstDay(endMonth),
      max_installments:
        endRule === 'fixed_installments' ? Number(maxInstallments || inclusiveMonthSpan(startMonth, endMonth)) : null,
      auto_post_as_actual: true,
      owner_user_id: ownerUserId || null,
    }
    try {
      if (isEdit && editingId) {
        const { error: updErr } = await supabase.from('recurring_templates').update(payload).eq('id', editingId)
        if (updErr && (updErr.code === '42703' || updErr.message?.includes('owner_user_id'))) {
          delete payload.owner_user_id
          const retry = await supabase.from('recurring_templates').update(payload).eq('id', editingId)
          if (retry.error) throw retry.error
        } else if (updErr) throw updErr
      } else {
        payload.active = true
        const { error: insErr } = await supabase.from('recurring_templates').insert(payload)
        if (insErr && (insErr.code === '42703' || insErr.message?.includes('owner_user_id'))) {
          delete payload.owner_user_id
          const retry = await supabase.from('recurring_templates').insert(payload)
          if (retry.error) throw retry.error
        } else if (insErr) throw insErr
      }
      setLabel('')
      setDefaultAmount('')
      setMaxInstallments('')
      setEndRule('unlimited')
      setShowCreate(false)
      setEditingId(null)
      await load()
      onTemplatesChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  const addTemplate = async (e: FormEvent) => {
    e.preventDefault()
    await persistTemplate(false)
  }

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    await persistTemplate(true)
  }

  const toggleActive = async (row: RecurringTemplate) => {
    if (!supabase) return
    await supabase.from('recurring_templates').update({ active: !row.active }).eq('id', row.id)
    if (row.active) {
      await supabase
        .from('transactions')
        .delete()
        .eq('household_id', householdId)
        .eq('auto_post_template_id', row.id)
        .gte('auto_post_month', currentRealMonthFirstDay())
    }
    await load()
    onTemplatesChanged()
  }

  const skipThisMonth = async (row: RecurringTemplate) => {
    if (!supabase) return
    const monthDate = monthValueToFirstDay(selectedMonth)
    const { error: skipErr } = await supabase.from('recurring_skips').upsert({
      household_id: householdId,
      template_id: row.id,
      skip_month: monthDate,
    })
    if (skipErr && skipErr.code !== '42P01') setError(skipErr.message)
    await supabase
      .from('transactions')
      .delete()
      .eq('household_id', householdId)
      .eq('auto_post_template_id', row.id)
      .eq('auto_post_month', monthDate)
    await load()
    onTemplatesChanged()
  }

  const restoreThisMonth = async (row: RecurringTemplate) => {
    if (!supabase) return
    const monthDate = monthValueToFirstDay(selectedMonth)
    await supabase.from('recurring_skips').delete().eq('template_id', row.id).eq('skip_month', monthDate)
    await load()
    onTemplatesChanged()
  }

  const remove = async (id: string) => {
    if (!supabase) return
    await supabase
      .from('transactions')
      .delete()
      .eq('household_id', householdId)
      .eq('auto_post_template_id', id)
      .gte('auto_post_month', currentRealMonthFirstDay())
    await supabase.from('recurring_templates').delete().eq('id', id)
    await load()
    onTemplatesChanged()
  }

  const startEdit = (row: RecurringTemplate) => {
    setEditingId(row.id)
    setDirection(row.direction)
    setMode(row.mode)
    setCategory(ALL_PLAN_CATEGORIES.includes(row.category) ? row.category : 'אחר')
    setCustomCategory(ALL_PLAN_CATEGORIES.includes(row.category) ? '' : row.category)
    setLabel(row.label ?? '')
    setDefaultAmount(String(row.default_amount ?? 0))
    setEndRule(row.end_rule)
    const startValue = row.template_start_month?.slice(0, 7) ?? selectedMonth
    setStartMonth(startValue)
    const endValue =
      row.end_month?.slice(0, 7) ??
      (row.end_rule === 'fixed_installments' && row.max_installments
        ? addMonths(startValue, Math.max(0, row.max_installments - 1))
        : selectedMonth)
    setEndMonth(endValue)
    setMaxInstallments(row.max_installments ? String(row.max_installments) : '')
    setOwnerUserId(row.owner_user_id ?? '')
    setError(null)
    setShowCreate(true)
  }

  const onStartMonthChange = (value: string) => {
    setStartMonth(value)
    if (endRule !== 'fixed_installments') return
    const parsed = Number(maxInstallments)
    if (Number.isFinite(parsed) && parsed > 0) {
      setEndMonth(addMonths(value, parsed - 1))
    }
  }

  return (
    <div className="screen-pad">
      <div className="screen-head">
        <h2 className="screen-title">קבועים</h2>
      </div>
      <p className="panel-intro muted">
        קובעים פעם אחת — נרשם אוטומטית בחודש הזה ובחודשים הבאים. אפשר לבטל לחודש או לתמיד.
      </p>

      {!loading && list.length ? (
        <article className="card tx-totals-bar">
          <div className="tx-totals-row">
            <span>קבועים החודש</span>
            <strong className="amount-income tabular">{formatIls(activeFixedTotals.income)}</strong>
          </div>
          <div className="tx-totals-row">
            <span>הוצאות קבועות</span>
            <strong className="amount-expense tabular">{formatIls(activeFixedTotals.expense)}</strong>
          </div>
          <div className="tx-totals-row tx-totals-balance">
            <span>יתרה מקבועים</span>
            <strong className={activeFixedTotals.balance >= 0 ? 'amount-income tabular' : 'amount-expense tabular'}>
              {formatIls(activeFixedTotals.balance)}
            </strong>
          </div>
        </article>
      ) : null}

      {loading ? (
        <div className="skeleton-list">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : null}
      {error ? <p className="sheet-error">{error}</p> : null}

      <article className="card card-form">
        <div className="card-heading-row">
          <h3 className="card-heading">רשימה</h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingId(null)
              setOwnerUserId('')
              setShowCreate(true)
            }}
          >
            + קבוע
          </button>
        </div>
        <ul className="recurring-sheet-list">
          {visible.map((row) => {
            const skipped = skippedIds.has(row.id)
            const amt = templateAmount(row)
            return (
              <li key={row.id} className={`recurring-sheet-item${row.active ? '' : ' inactive'}${skipped ? ' skipped' : ''}`}>
                <span className="tx-sheet-icon" aria-hidden>
                  {categoryIcon(row.category)}
                </span>
                <div className="tx-sheet-main">
                  <strong>
                    {row.label?.trim() || row.category}
                    {row.label?.trim() ? <span className="muted small"> · {row.category}</span> : null}
                  </strong>
                  <span className="tx-sheet-sub">
                    {row.direction === 'income' ? 'הכנסה' : 'הוצאה'} · {ownerLabel(row)} · {describePeriod(row)}
                    {skipped ? ' · בוטל החודש' : ''}
                    {!row.active ? ' · מושבת' : ''}
                  </span>
                </div>
                <strong
                  className={`tabular ${
                    row.mode === 'variable_budget'
                      ? 'amount-variable'
                      : row.direction === 'income'
                        ? 'amount-income'
                        : 'amount-expense'
                  }`}
                >
                  {row.mode === 'variable_budget' ? 'משתנה' : formatIls(amt)}
                </strong>
                <div className="recurring-sheet-actions">
                  {row.active && !skipped ? (
                    <button type="button" className="btn-ghost btn-xs" onClick={() => void skipThisMonth(row)}>
                      בטל החודש
                    </button>
                  ) : null}
                  {skipped ? (
                    <button type="button" className="btn-secondary btn-xs" onClick={() => void restoreThisMonth(row)}>
                      שחזר החודש
                    </button>
                  ) : null}
                  <button type="button" className="btn-ghost btn-xs" onClick={() => void toggleActive(row)}>
                    {row.active ? 'השבת לתמיד' : 'הפעל'}
                  </button>
                  <button type="button" className="btn-secondary btn-xs" onClick={() => startEdit(row)}>
                    ערוך
                  </button>
                  <button type="button" className="btn-danger btn-xs" onClick={() => void remove(row.id)}>
                    מחק
                  </button>
                </div>
              </li>
            )
          })}
          {!visible.length && !loading ? <li className="empty">אין קבועים. לחצו על "+ קבוע".</li> : null}
        </ul>
      </article>

      {showCreate || editingId ? (
        <div
          className="modal-backdrop modal-backdrop--center"
          onClick={() => {
            setEditingId(null)
            setShowCreate(false)
          }}
        >
          <article className="card card-form modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-heading">{editingId ? 'עריכת קבוע' : 'קבוע חדש'}</h3>
            <form onSubmit={editingId ? saveEdit : addTemplate} className="stack tight">
              <div className="segmented">
                <button type="button" className={direction === 'expense' ? 'seg active' : 'seg'} onClick={() => setDirection('expense')}>
                  הוצאה
                </button>
                <button type="button" className={direction === 'income' ? 'seg active' : 'seg'} onClick={() => setDirection('income')}>
                  הכנסה
                </button>
              </div>
              <div className="segmented">
                <button type="button" className={mode === 'fixed_amount' ? 'seg active' : 'seg'} onClick={() => setMode('fixed_amount')}>
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
                שייך ל
                <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
                  <option value="">משותף</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.userId === currentUserId ? `${m.displayName} (אני)` : m.displayName}
                    </option>
                  ))}
                </select>
              </label>
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
                תיאור (אופציונלי)
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="למשל: חשמל דירה" />
              </label>
              {mode === 'fixed_amount' ? (
                <label>
                  סכום חודשי (₪)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={defaultAmount}
                    onChange={(e) => setDefaultAmount(e.target.value)}
                    required
                  />
                </label>
              ) : (
                <p className="muted small">בתקציב משתנה הסכום יישאר ריק עד שתעדכנו בחודש.</p>
              )}
              <label>
                מתחיל מחודש
                <MonthValuePicker value={startMonth} onChange={onStartMonthChange} />
              </label>
              <div className="segmented">
                <button type="button" className={endRule === 'unlimited' ? 'seg active' : 'seg'} onClick={() => setEndRule('unlimited')}>
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
                  onClick={() => {
                    setEndRule('fixed_installments')
                    if (!maxInstallments) setMaxInstallments(String(inclusiveMonthSpan(startMonth, endMonth) || 1))
                  }}
                >
                  מספר תשלומים
                </button>
              </div>
              {endRule === 'until_month' ? (
                <label>
                  חודש סיום
                  <MonthValuePicker value={endMonth} onChange={setEndMonth} />
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
                    onChange={(e) => {
                      const value = e.target.value
                      setMaxInstallments(value)
                      const parsed = Number(value)
                      if (Number.isFinite(parsed) && parsed > 0) setEndMonth(addMonths(startMonth, parsed - 1))
                    }}
                    required
                  />
                </label>
              ) : null}
              <div className="edit-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditingId(null)
                    setShowCreate(false)
                  }}
                >
                  ביטול
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'שומר…' : editingId ? 'שמור' : 'הוסף קבוע'}
                </button>
              </div>
            </form>
          </article>
        </div>
      ) : null}
    </div>
  )
}
