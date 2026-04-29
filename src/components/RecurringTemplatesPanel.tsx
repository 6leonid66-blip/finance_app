import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { ALL_PLAN_CATEGORIES, isOtherCategory } from '../constants/categories'
import { MonthValuePicker } from './MonthValuePicker'
import type {
  RecurringDirection,
  RecurringEndRule,
  RecurringMode,
  RecurringTemplate,
} from '../types'
import { monthValueToFirstDay } from '../lib/month'

type RecurringTemplatesPanelProps = {
  householdId: string
  selectedMonth: string
  onTemplatesChanged: () => void
  scopeMode: 'personal' | 'shared'
  onScopeModeChange: (scope: 'personal' | 'shared') => void
  visibleCategories: string[] | null
}

export function RecurringTemplatesPanel({
  householdId,
  selectedMonth,
  onTemplatesChanged,
  scopeMode,
  onScopeModeChange,
  visibleCategories,
}: RecurringTemplatesPanelProps) {
  const [list, setList] = useState<RecurringTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [direction, setDirection] = useState<RecurringDirection>('expense')
  const [mode, setMode] = useState<RecurringMode>('fixed_amount')
  const [category, setCategory] = useState(ALL_PLAN_CATEGORIES[0])
  const [customCategory, setCustomCategory] = useState('')
  const [label, setLabel] = useState('')
  const [defaultAmount, setDefaultAmount] = useState('')
  const [startMonth, setStartMonth] = useState(selectedMonth)
  const [endRule, setEndRule] = useState<RecurringEndRule>('unlimited')
  const [endMonth, setEndMonth] = useState(selectedMonth)
  const [maxInstallments, setMaxInstallments] = useState('')
  const [autoPostAsActual, setAutoPostAsActual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const monthDiffInclusive = (startValue: string, endValue: string) => {
    const [sy, sm] = startValue.split('-').map(Number)
    const [ey, em] = endValue.split('-').map(Number)
    if (!sy || !sm || !ey || !em) return 0
    return Math.max(0, (ey - sy) * 12 + (em - sm) + 1)
  }

  const addMonths = (monthValue: string, months: number) => {
    const [y, m] = monthValue.split('-').map(Number)
    if (!y || !m) return monthValue
    const d = new Date(y, m - 1, 1)
    d.setMonth(d.getMonth() + months)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  const resolvedCategory = isOtherCategory(category) ? customCategory.trim() || 'אחר' : category
  const filteredList = useMemo(() => {
    if (!visibleCategories || !visibleCategories.length) return list
    const visibleSet = new Set(visibleCategories)
    return list.filter((row) => visibleSet.has(row.category))
  }, [list, visibleCategories])

  const load = async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error: qErr } = await supabase
      .from('recurring_templates')
      .select(
        'id,household_id,direction,category,label,mode,default_amount,template_start_month,end_rule,end_month,max_installments,auto_post_as_actual,active,created_at,updated_at',
      )
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
    setLoading(false)
    if (qErr) {
      setError(qErr.message)
      return
    }
    setList((data ?? []) as RecurringTemplate[])
    setError(null)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // householdId בלבד טוען מחדש רשימת תבניות
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId])

  const addTemplate = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    const amt = Number(defaultAmount || 0)
    if (mode === 'fixed_amount' && (!amt || amt <= 0)) {
      setError('בקבוע עם סכום קבוע חייב סכום חיובי')
      return
    }
    if (
      endRule === 'fixed_installments' &&
      (!Number(maxInstallments || monthDiffInclusive(startMonth, endMonth)) ||
        Number(maxInstallments || monthDiffInclusive(startMonth, endMonth)) <= 0)
    ) {
      setError('יש להזין מספר תשלומים חוקי')
      return
    }
    if (endRule !== 'unlimited' && !endMonth) {
      setError('יש לבחור חודש סיום')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { error: insErr } = await supabase.from('recurring_templates').insert({
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
          endRule === 'fixed_installments'
            ? Number(maxInstallments || monthDiffInclusive(startMonth, endMonth))
            : null,
        auto_post_as_actual: autoPostAsActual,
        active: true,
      })
      if (insErr) throw insErr
      setLabel('')
      setDefaultAmount('')
      setMaxInstallments('')
      setEndRule('unlimited')
      setAutoPostAsActual(false)
      setShowCreate(false)
      await load()
      onTemplatesChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (row: RecurringTemplate) => {
    if (!supabase) return
    await supabase.from('recurring_templates').update({ active: !row.active }).eq('id', row.id)
    await load()
    onTemplatesChanged()
  }

  const toggleAutoPost = async (row: RecurringTemplate) => {
    if (!supabase) return
    setError(null)
    const { error: toggleError } = await supabase
      .from('recurring_templates')
      .update({ auto_post_as_actual: !row.auto_post_as_actual })
      .eq('id', row.id)
    if (toggleError) {
      setError(toggleError.message)
      return
    }
    await load()
    onTemplatesChanged()
  }

  const remove = async (id: string) => {
    if (!supabase) return
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
    setAutoPostAsActual(Boolean(row.auto_post_as_actual))
    setError(null)
  }

  const onStartMonthChange = (value: string) => {
    setStartMonth(value)
    if (endRule !== 'fixed_installments') return
    const parsed = Number(maxInstallments)
    if (Number.isFinite(parsed) && parsed > 0) {
      setEndMonth(addMonths(value, parsed - 1))
      return
    }
    const computed = monthDiffInclusive(value, endMonth)
    if (computed > 0) setMaxInstallments(String(computed))
  }

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !editingId) return
    const amt = Number(defaultAmount || 0)
    if (mode === 'fixed_amount' && (!amt || amt <= 0)) {
      setError('בקבוע עם סכום קבוע חייב סכום חיובי')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { error: updErr } = await supabase
        .from('recurring_templates')
        .update({
          direction,
          category: resolvedCategory,
          label: label.trim() || null,
          mode,
          default_amount: mode === 'fixed_amount' ? amt : 0,
          template_start_month: monthValueToFirstDay(startMonth),
          end_rule: endRule,
          end_month: endRule === 'unlimited' ? null : monthValueToFirstDay(endMonth),
          max_installments:
            endRule === 'fixed_installments'
              ? Number(maxInstallments || monthDiffInclusive(startMonth, endMonth))
              : null,
          auto_post_as_actual: autoPostAsActual,
        })
        .eq('id', editingId)
      if (updErr) throw updErr
      setEditingId(null)
      setShowCreate(false)
      await load()
      onTemplatesChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'עדכון נכשל')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen-pad">
      <h2 className="screen-title">הוצאות והכנסות קבועות</h2>
      <p className="panel-intro">ניהול קבועים מלא עם כללי תוקף, תשלומים וסנכרון אוטומטי לתחזית החכמה.</p>
      <p className="muted small">חודש נוכחי לבדיקה: {selectedMonth}</p>
      <div className="scope-switch card">
        <strong>תצוגה</strong>
        <div className="segmented">
          <button
            type="button"
            className={scopeMode === 'personal' ? 'seg active' : 'seg'}
            onClick={() => onScopeModeChange('personal')}
          >
            אישי
          </button>
          <button
            type="button"
            className={scopeMode === 'shared' ? 'seg active' : 'seg'}
            onClick={() => onScopeModeChange('shared')}
          >
            משותף
          </button>
        </div>
      </div>

      {loading ? <p className="muted">טוען…</p> : null}
      {error ? <p className="sheet-error">{error}</p> : null}

      <article className="card card-form toolbar-card recurring-toolbar">
        <div className="toolbar-actions">
          <strong>קבועים קיימים</strong>
          <button type="button" className="btn-secondary btn-xs" onClick={() => setShowCreate(true)}>
            הוסף חדש
          </button>
        </div>
      </article>

      <article className="card card-form">
        <h3 className="card-heading">קבועים קיימים</h3>
        <div className="bank-table-wrap compact-table-wrap">
          <table className="bank-table compact-table">
            <thead>
              <tr>
                <th>קטגוריה</th>
                <th>סוג</th>
                <th>שיטה</th>
                <th>סיום</th>
                <th>אוטומטי לפועל</th>
                <th>תשלומים</th>
                <th>סטטוס</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map((row) => (
                <tr key={row.id} className={row.active ? '' : 'inactive'}>
                  <td data-label="קטגוריה">
                    {row.category}
                    {row.label ? ` · ${row.label}` : ''}
                  </td>
                  <td data-label="סוג">{row.direction === 'income' ? 'הכנסה' : 'הוצאה'}</td>
                  <td data-label="שיטה">
                    {row.mode === 'fixed_amount' ? `${Number(row.default_amount).toLocaleString()} ₪` : 'תקציב משתנה'}
                  </td>
                  <td data-label="סיום">
                    {row.end_rule === 'unlimited'
                      ? 'ללא הגבלה'
                      : row.end_rule === 'until_month'
                        ? `עד ${row.end_month?.slice(0, 7) ?? '-'}`
                        : `${row.max_installments ?? 0} תשלומים`}
                  </td>
                  <td data-label="אוטומטי לפועל">
                    <button type="button" className="btn-secondary btn-xs" onClick={() => void toggleAutoPost(row)}>
                      {row.auto_post_as_actual ? 'פעיל' : 'כבוי'}
                    </button>
                  </td>
                  <td data-label="תשלומים">
                    {row.end_rule === 'fixed_installments' && row.max_installments
                      ? `מתוך ${row.max_installments}`
                      : '—'}
                  </td>
                  <td data-label="סטטוס">{row.active ? 'פעיל' : 'מושבת'}</td>
                  <td data-label="פעולות">
                    <div className="row-actions row-actions-compact">
                      <button type="button" className="btn-secondary btn-xs" onClick={() => startEdit(row)}>
                        ערוך
                      </button>
                      <button type="button" className="btn-secondary btn-xs" onClick={() => void toggleActive(row)}>
                        {row.active ? 'השבת' : 'הפעל'}
                      </button>
                      <button type="button" className="btn-danger btn-xs" onClick={() => void remove(row.id)}>
                        מחק
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredList.length && !loading ? (
                <tr>
                  <td colSpan={8} className="empty">
                    אין קבועים להצגה בתצוגה הנוכחית.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {showCreate || editingId ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setEditingId(null)
            setShowCreate(false)
          }}
        >
          <article className="card card-form modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-heading">{editingId ? 'עריכת תבנית' : 'הוספת תבנית'}</h3>
            <form onSubmit={editingId ? saveEdit : addTemplate} className="stack tight">
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
                סכום חודשי קבוע (₪)
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
              <p className="muted small">בתקציב משתנה הסכום המתוכנן יועתק מהחודש הקודם כשפותחים חודש חדש.</p>
            )}
            <label>
              מתחיל מחודש
              <MonthValuePicker value={startMonth} onChange={onStartMonthChange} />
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
                onClick={() => {
                  setEndRule('fixed_installments')
                  if (!maxInstallments) {
                    const computed = monthDiffInclusive(startMonth, endMonth)
                    setMaxInstallments(String(computed || 1))
                  }
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
              <>
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
                      if (Number.isFinite(parsed) && parsed > 0) {
                        setEndMonth(addMonths(startMonth, parsed - 1))
                      }
                    }}
                    required
                  />
                </label>
                <label>
                  חודש סיום (מחושב/ניתן לעריכה)
                  <MonthValuePicker
                    value={endMonth}
                    onChange={(value) => {
                      setEndMonth(value)
                      const computed = monthDiffInclusive(startMonth, value)
                      if (computed > 0) setMaxInstallments(String(computed))
                    }}
                  />
                </label>
                <p className="muted small">
                  אפשר לעדכן או את מספר התשלומים או את חודש הסיום — המערכת תחשב את השדה השני.
                </p>
              </>
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
                  {saving ? 'שומר…' : editingId ? 'שמור שינויים' : 'הוסף תבנית'}
                </button>
              </div>
            </form>
          </article>
        </div>
      ) : null}
    </div>
  )
}
