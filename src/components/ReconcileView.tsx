import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { MonthValuePicker } from './MonthValuePicker'
import { monthValueToRange } from '../lib/month'
import { reconcile } from '../lib/reconcile'
import type { MatchResult, ParsedBankRow } from '../lib/reconcile'
import { parseBankStatementFile, parseBankStatementRows } from '../lib/geminiReceipt'
import type { FinanceEntry, FinancialAccount } from '../types'
import type { AddExpensePrefill } from './AddExpenseSheet'

type ReconcileViewProps = {
  householdId: string
  sessionUserId: string
  accounts: FinancialAccount[]
  selectedAccountId: string
  onSelectedAccountIdChange: (id: string) => void
  scopeMode: 'personal' | 'shared'
  onScopeModeChange: (scope: 'personal' | 'shared') => void
  onRefresh: () => void
  onPrefillAddExpense: (type: 'expense' | 'income', prefill: AddExpensePrefill) => void
}

type Phase = 'idle' | 'parsing' | 'fetching' | 'review' | 'applying'

const ACCEPT =
  '.csv,.xlsx,.xls,application/pdf,image/png,image/jpeg,image/webp,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

function previousMonthValue(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatHebrewDate(value: string): string {
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function isSpreadsheetLike(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) return true
  const t = file.type.toLowerCase()
  return (
    t === 'text/csv' ||
    t === 'application/vnd.ms-excel' ||
    t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}

async function readSpreadsheetRows(file: File): Promise<Record<string, unknown>[]> {
  const xlsx = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = xlsx.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return []
  const sheet = workbook.Sheets[firstSheetName]
  if (!sheet) return []
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null, raw: false })
  return rows as Record<string, unknown>[]
}

export function ReconcileView({
  householdId,
  sessionUserId,
  accounts,
  selectedAccountId,
  onSelectedAccountIdChange,
  scopeMode,
  onScopeModeChange,
  onRefresh,
  onPrefillAddExpense,
}: ReconcileViewProps) {
  const [startMonth, setStartMonth] = useState<string>(previousMonthValue)
  const [endMonth, setEndMonth] = useState<string>(previousMonthValue)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [parsedRows, setParsedRows] = useState<ParsedBankRow[]>([])
  const [result, setResult] = useState<MatchResult | null>(null)
  const [missingSelected, setMissingSelected] = useState<Set<number>>(new Set())
  const [extraDismissed, setExtraDismissed] = useState<Set<string>>(new Set())
  const [showMatched, setShowMatched] = useState(false)

  const effectiveEndMonth = endMonth < startMonth ? startMonth : endMonth

  const dateRange = useMemo(() => {
    const s = monthValueToRange(startMonth)
    const e = monthValueToRange(effectiveEndMonth)
    return {
      startDate: s.startDate,
      endDate: e.endDate,
    }
  }, [startMonth, effectiveEndMonth])

  const resetReview = () => {
    setParsedRows([])
    setResult(null)
    setMissingSelected(new Set())
    setExtraDismissed(new Set())
    setShowMatched(false)
  }

  const accountsSelectable = useMemo(
    () =>
      scopeMode === 'shared'
        ? accounts
        : accounts.filter(
            (a) => a.is_shared || (!a.is_shared && a.owner_user_id === sessionUserId),
          ),
    [accounts, scopeMode, sessionUserId],
  )

  const fetchAppTransactions = async (): Promise<FinanceEntry[]> => {
    if (!supabase) return []
    const householdWideAccountIds = accounts.map((a) => a.id)

    if (scopeMode === 'shared' && !householdWideAccountIds.length) {
      return []
    }

    let query = supabase
      .from('transactions')
      .select(
        'id,household_id,owner_id,account_id,type,amount,category,note,occurred_on,planned,created_at,is_auto_from_recurring,installment_progress_label,receipt_path,receipt_filename,receipt_mime_type,receipt_size_bytes',
      )
      .eq('household_id', householdId)
      .gte('occurred_on', dateRange.startDate)
      .lte('occurred_on', dateRange.endDate)
      .order('occurred_on', { ascending: true })

    if (scopeMode === 'shared') {
      const ids = householdWideAccountIds.join(',')
      query = query.or(`account_id.in.(${ids}),account_id.is.null`)
    } else {
      query = query.eq('owner_id', sessionUserId)
      if (householdWideAccountIds.length) {
        const ids = householdWideAccountIds.join(',')
        query = query.or(`account_id.in.(${ids}),account_id.is.null`)
      }
    }

    const { data, error: qErr } = await query
    if (qErr) throw new Error(qErr.message)
    return (data ?? []) as unknown as FinanceEntry[]
  }

  const onFileSelected = async (file?: File | null) => {
    if (!file) return
    setError(null)
    setStatus(null)
    setFileName(file.name)
    setPhase('parsing')
    resetReview()

    try {
      let parsed: ParsedBankRow[] = []
      if (isSpreadsheetLike(file)) {
        const rows = await readSpreadsheetRows(file)
        if (!rows.length) throw new Error('הקובץ ריק או לא הצלחתי לקרוא נתונים.')
        const proxy = await parseBankStatementRows(rows)
        parsed = proxy.items
        if (proxy.truncated) setStatus('הקובץ ארוך — עיבדתי רק 500 שורות ראשונות.')
      } else {
        const proxy = await parseBankStatementFile(file)
        parsed = proxy.items
      }

      const inRange = parsed.filter(
        (row) => row.occurred_on >= dateRange.startDate && row.occurred_on <= dateRange.endDate,
      )

      setParsedRows(inRange)

      setPhase('fetching')
      const appTxns = await fetchAppTransactions()

      const matchResult = reconcile(inRange, appTxns)
      setResult(matchResult)
      setMissingSelected(new Set(matchResult.missingInApp.map((_, i) => i)))
      setPhase('review')
    } catch (err) {
      setPhase('idle')
      setError(err instanceof Error ? err.message : 'שגיאה לא צפויה')
    }
  }

  const toggleMissing = (idx: number) => {
    setMissingSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const setAllMissing = (selected: boolean) => {
    if (!result) return
    if (!selected) setMissingSelected(new Set())
    else setMissingSelected(new Set(result.missingInApp.map((_, i) => i)))
  }

  const insertSelectedMissing = async () => {
    if (!supabase || !result) return
    if (!selectedAccountId) {
      setError('בחר חשבון לפני הוספה.')
      return
    }
    const rowsToInsert = result.missingInApp.filter((_, i) => missingSelected.has(i))
    if (!rowsToInsert.length) return
    setPhase('applying')
    setError(null)
    try {
      const payload = rowsToInsert.map((row) => ({
        household_id: householdId,
        owner_id: sessionUserId,
        account_id: selectedAccountId,
        type: row.type,
        amount: row.amount,
        category: 'אחר',
        note: row.description ?? null,
        occurred_on: row.occurred_on,
        planned: false,
      }))
      const { error: insErr } = await supabase.from('transactions').insert(payload)
      if (insErr) throw insErr
      setStatus(`נוספו ${payload.length} תנועות חדשות.`)
      setMissingSelected(new Set())
      setResult({
        ...result,
        missingInApp: result.missingInApp.filter((_, i) => !rowsToInsert.includes(result.missingInApp[i])),
      })
      onRefresh()
      const refreshed = await fetchAppTransactions()
      const remainingMissing = result.missingInApp.filter((row) => !rowsToInsert.includes(row))
      const refreshedResult = reconcile(parsedRows, refreshed)
      setResult({
        matched: refreshedResult.matched,
        missingInApp: remainingMissing.length ? refreshedResult.missingInApp : [],
        extraInApp: refreshedResult.extraInApp,
      })
      setMissingSelected(new Set())
      setPhase('review')
    } catch (err) {
      setPhase('review')
      setError(err instanceof Error ? err.message : 'הוספה נכשלה')
    }
  }

  const editBeforeInsert = (idx: number) => {
    if (!result) return
    const row = result.missingInApp[idx]
    if (!row) return
    onPrefillAddExpense(row.type, {
      amount: String(row.amount),
      note: row.description ?? '',
      category: 'אחר',
      customCategory: '',
    })
  }

  const removeExtra = async (entry: FinanceEntry) => {
    if (!supabase) return
    if (!window.confirm('למחוק את התנועה הזו מהמערכת?')) return
    try {
      const { error: delErr } = await supabase.from('transactions').delete().eq('id', entry.id)
      if (delErr) throw delErr
      setStatus('התנועה נמחקה.')
      onRefresh()
      const refreshed = await fetchAppTransactions()
      const refreshedResult = reconcile(parsedRows, refreshed)
      setResult(refreshedResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'מחיקה נכשלה')
    }
  }

  const dismissExtra = (id: string) => {
    setExtraDismissed((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const visibleExtras = useMemo(() => {
    if (!result) return [] as FinanceEntry[]
    return result.extraInApp.filter((entry) => !extraDismissed.has(entry.id))
  }, [result, extraDismissed])

  const isBusy = phase === 'parsing' || phase === 'fetching' || phase === 'applying'

  return (
    <div className="screen-pad">
      <h2 className="screen-title">השוואה לבנק</h2>
      <p className="panel-intro muted">
        בוחרים טווח תאריכים, מעלים דף תנועות מהבנק (CSV / Excel / PDF / תמונה), המערכת תעשה השוואה לרשומות שלך
        ותציע מה להוסיף או למחוק.
      </p>

      <article className="card card-form reconcile-controls">
        <div className="scope-row">
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
        <div className="reconcile-date-row">
          <label>
            מחודש
            <MonthValuePicker value={startMonth} onChange={setStartMonth} className="dashboard-month-picker" />
          </label>
          <label>
            עד חודש
            <MonthValuePicker value={endMonth} onChange={setEndMonth} className="dashboard-month-picker" />
          </label>
        </div>
        <label>
          חשבון להוספת תנועות חסרות
          <select value={selectedAccountId} onChange={(e) => onSelectedAccountIdChange(e.target.value)}>
            {!accountsSelectable.length ? <option value="">אין חשבונות</option> : null}
            {accountsSelectable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      </article>

      <article className="card card-form reconcile-upload">
        <h3 className="card-heading">העלאת דף תנועות</h3>
        <label className="receipt-upload">
          <input
            type="file"
            accept={ACCEPT}
            onChange={(e) => void onFileSelected(e.target.files?.[0])}
            disabled={isBusy}
          />
          <span>בחר קובץ (CSV / Excel / PDF / תמונה)</span>
        </label>
        {fileName ? <p className="muted small">קובץ: {fileName}</p> : null}
        {phase === 'parsing' ? (
          <p className="muted">
            סורק את הקובץ
            <span className="thinking-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : null}
        {phase === 'fetching' ? (
          <p className="muted">
            משווה לתנועות שלך
            <span className="thinking-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : null}
        {phase === 'applying' ? (
          <p className="muted">
            שומר
            <span className="thinking-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : null}
        {error ? <p className="sheet-error">{error}</p> : null}
        {status ? <p className="inline-status">{status}</p> : null}
      </article>

      {result ? (
        <>
          <article className="card reconcile-summary">
            <span>
              נסרקו <strong>{parsedRows.length}</strong> שורות
            </span>
            <span>·</span>
            <span>
              התאמה <strong>{result.matched.length}</strong>
            </span>
            <span>·</span>
            <span>
              חסרות אצלך <strong>{result.missingInApp.length}</strong>
            </span>
            <span>·</span>
            <span>
              עודפות אצלך <strong>{visibleExtras.length}</strong>
            </span>
          </article>

          <article className="card card-form reconcile-section reconcile-missing">
            <div className="card-heading-row">
              <h3 className="card-heading">חסרות במערכת ({result.missingInApp.length})</h3>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  onClick={() => setAllMissing(true)}
                  disabled={!result.missingInApp.length}
                >
                  בחר הכל
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  onClick={() => setAllMissing(false)}
                  disabled={!missingSelected.size}
                >
                  נקה בחירה
                </button>
                <button
                  type="button"
                  className="btn-primary btn-xs"
                  onClick={() => void insertSelectedMissing()}
                  disabled={!missingSelected.size || isBusy}
                >
                  הוסף את הנבחרים ({missingSelected.size})
                </button>
              </div>
            </div>
            {!result.missingInApp.length ? (
              <p className="muted small">אין שורות חסרות — הכל מסונכרן עם הבנק.</p>
            ) : (
              <ul className="reconcile-list">
                {result.missingInApp.map((row, idx) => (
                  <li key={`miss-${idx}`} className="reconcile-row">
                    <label className="reconcile-row-main">
                      <input
                        type="checkbox"
                        checked={missingSelected.has(idx)}
                        onChange={() => toggleMissing(idx)}
                      />
                      <div className="reconcile-row-text">
                        <strong className={row.type === 'expense' ? 'amount-expense' : 'amount-income'}>
                          {row.amount.toLocaleString()} ₪
                        </strong>
                        <span className="muted small">{formatHebrewDate(row.occurred_on)}</span>
                        {row.description ? <span>{row.description}</span> : null}
                      </div>
                    </label>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => editBeforeInsert(idx)}
                    >
                      ערוך לפני הוספה
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="card card-form reconcile-section reconcile-extra">
            <div className="card-heading-row">
              <h3 className="card-heading">עודפות במערכת ({visibleExtras.length})</h3>
            </div>
            {!visibleExtras.length ? (
              <p className="muted small">אין תנועות אצלך שלא מופיעות בקובץ הבנק.</p>
            ) : (
              <ul className="reconcile-list">
                {visibleExtras.map((entry) => (
                  <li key={`ex-${entry.id}`} className="reconcile-row">
                    <div className="reconcile-row-text">
                      <strong className={entry.type === 'expense' ? 'amount-expense' : 'amount-income'}>
                        {entry.amount.toLocaleString()} ₪
                      </strong>
                      <span className="muted small">
                        {formatHebrewDate(entry.occurred_on)} · {entry.category}
                      </span>
                      {entry.note ? <span>{entry.note}</span> : null}
                    </div>
                    <div className="row-actions row-actions-compact">
                      <button
                        type="button"
                        className="btn-secondary btn-xs"
                        onClick={() => dismissExtra(entry.id)}
                      >
                        השאר
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-xs"
                        onClick={() => void removeExtra(entry)}
                      >
                        מחק
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="card card-form reconcile-section reconcile-matched">
            <div className="card-heading-row">
              <h3 className="card-heading">התאמה מלאה ({result.matched.length})</h3>
              <button
                type="button"
                className="btn-secondary btn-xs"
                onClick={() => setShowMatched((v) => !v)}
                disabled={!result.matched.length}
              >
                {showMatched ? 'הסתר' : 'הצג'}
              </button>
            </div>
            {showMatched && result.matched.length ? (
              <ul className="reconcile-list">
                {result.matched.map((pair, idx) => (
                  <li key={`m-${idx}`} className="reconcile-row">
                    <div className="reconcile-row-text">
                      <strong>{pair.bank.amount.toLocaleString()} ₪</strong>
                      <span className="muted small">
                        בנק: {formatHebrewDate(pair.bank.occurred_on)} · אצלך:{' '}
                        {formatHebrewDate(pair.app.occurred_on)} · {pair.app.category}
                      </span>
                      {pair.bank.description ? <span>{pair.bank.description}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        </>
      ) : null}
    </div>
  )
}
