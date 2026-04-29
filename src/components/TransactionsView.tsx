import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, isOtherCategory } from '../constants/categories'
import type { EntryType, FinanceEntry, FinancialAccount } from '../types'
import { analyzeReceiptWithGemini } from '../lib/geminiReceipt'
import { deleteReceiptAttachment, uploadReceiptAttachment } from '../lib/receiptStorage'
import { MonthValuePicker } from './MonthValuePicker'

type TransactionsViewProps = {
  entries: FinanceEntry[]
  selectedMonth: string
  onSelectedMonthChange: (month: string) => void
  householdId: string
  sessionUserId: string
  accounts: FinancialAccount[]
  selectedAccountId: string
  onSelectedAccountIdChange: (id: string) => void
  loading: boolean
  onRefresh: () => void
  scopeMode: 'personal' | 'shared'
  onScopeModeChange: (scope: 'personal' | 'shared') => void
}
type EntryFilter = 'expenses' | 'income' | 'all'
type FeedItem = {
  id: string
  type: EntryType
  amount: number
  category: string
  note: string | null
  occurred_on: string
  sourceEntry?: FinanceEntry
  accountName?: string | null
  ownerName?: string | null
}

function ownerLabel(entry: FinanceEntry) {
  if (entry.owner_name?.trim()) return entry.owner_name
  if (entry.owner_email) return entry.owner_email.split('@')[0] ?? entry.owner_email
  return 'משתמש'
}

export function TransactionsView({
  entries,
  selectedMonth,
  onSelectedMonthChange,
  householdId,
  sessionUserId,
  accounts,
  selectedAccountId,
  onSelectedAccountIdChange,
  loading,
  onRefresh,
  scopeMode,
  onScopeModeChange,
}: TransactionsViewProps) {
  const [type, setType] = useState<EntryType>('expense')
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0])
  const [customCategory, setCustomCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [planned, setPlanned] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [entryFilter, setEntryFilter] = useState<EntryFilter>('expenses')
  const [showCreate, setShowCreate] = useState(false)

  const [editing, setEditing] = useState<FinanceEntry | null>(null)
  const [editType, setEditType] = useState<EntryType>('expense')
  const [editCategory, setEditCategory] = useState<string>(EXPENSE_CATEGORIES[0])
  const [editCustomCategory, setEditCustomCategory] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editPlanned, setEditPlanned] = useState(false)
  const [editAccountId, setEditAccountId] = useState('')
  const [editReceiptFile, setEditReceiptFile] = useState<File | null>(null)
  const [editReceiptPreview, setEditReceiptPreview] = useState<string | null>(null)
  const [removeExistingReceipt, setRemoveExistingReceipt] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editAnalyzing, setEditAnalyzing] = useState(false)
  const [editStatus, setEditStatus] = useState<string | null>(null)

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const resolvedCategory = isOtherCategory(category) ? customCategory.trim() || 'אחר' : category
  const editCategories = editType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const resolvedEditCategory = isOtherCategory(editCategory) ? editCustomCategory.trim() || 'אחר' : editCategory

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        if (a.occurred_on === b.occurred_on) return b.created_at.localeCompare(a.created_at)
        return b.occurred_on.localeCompare(a.occurred_on)
      }),
    [entries],
  )

  const allFeedItems = useMemo<FeedItem[]>(() => {
    const actualItems: FeedItem[] = sortedEntries.map((entry) => ({
      id: `tx-${entry.id}`,
      type: entry.type,
      amount: entry.amount,
      category: entry.category,
      note: entry.note,
      occurred_on: entry.occurred_on,
      sourceEntry: entry,
      accountName: entry.account_name ?? null,
      ownerName: ownerLabel(entry),
    }))
    return actualItems.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
  }, [sortedEntries])

  const formatShortDate = (dateValue: string) => {
    const d = new Date(`${dateValue}T00:00:00`)
    if (Number.isNaN(d.getTime())) return dateValue
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  const filteredEntries = useMemo(() => {
    if (entryFilter === 'expenses') return allFeedItems.filter((entry) => entry.type === 'expense')
    if (entryFilter === 'income') return allFeedItems.filter((entry) => entry.type === 'income')
    return allFeedItems
  }, [allFeedItems, entryFilter])

  const filteredTotals = useMemo(() => {
    const expenseTotal = filteredEntries
      .filter((e) => e.type === 'expense')
      .reduce((sum, e) => sum + e.amount, 0)
    const incomeTotal = filteredEntries
      .filter((e) => e.type === 'income')
      .reduce((sum, e) => sum + e.amount, 0)
    return {
      count: filteredEntries.length,
      expenseTotal,
      incomeTotal,
      balance: incomeTotal - expenseTotal,
    }
  }, [filteredEntries])

  const monthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    if (!y || !m) return selectedMonth
    return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
  }, [selectedMonth])

  const scopeLabel = scopeMode === 'shared' ? 'משותף' : 'אישי'
  const totalsSubtitle = `${scopeLabel} · ${monthLabel} · ${filteredTotals.count.toLocaleString()} תנועות`

  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview)
      if (editReceiptPreview) URL.revokeObjectURL(editReceiptPreview)
    }
  }, [receiptPreview, editReceiptPreview])

  const addEntry = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    const parsed = Number(amount)
    if (!parsed || parsed <= 0) {
      setStatus('סכום לא חוקי')
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const receiptMeta = receiptFile
        ? await uploadReceiptAttachment({
            file: receiptFile,
            householdId,
            userId: sessionUserId,
          })
        : {
            receipt_path: null,
            receipt_filename: null,
            receipt_mime_type: null,
            receipt_size_bytes: null,
          }

      const { error } = await supabase.from('transactions').insert({
        household_id: householdId,
        owner_id: sessionUserId,
        account_id: selectedAccountId || null,
        ...receiptMeta,
        type,
        amount: parsed,
        category: resolvedCategory,
        note: note.trim() || null,
        occurred_on: occurredOn,
        planned,
      })
      if (error) throw error
      setAmount('')
      setNote('')
      setReceiptFile(null)
      if (receiptPreview) URL.revokeObjectURL(receiptPreview)
      setReceiptPreview(null)
      setShowCreate(false)
      setStatus('נשמר')
      onRefresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  const onSelectReceipt = (file?: File | null) => {
    if (!file) return
    if (receiptPreview) URL.revokeObjectURL(receiptPreview)
    setReceiptFile(file)
    setReceiptPreview(URL.createObjectURL(file))
    void analyzeAddReceipt(file)
  }

  const analyzeAddReceipt = async (fileArg?: File) => {
    const image = fileArg ?? receiptFile
    if (!image) return
    setAnalyzing(true)
    setStatus(null)
    try {
      const result = await analyzeReceiptWithGemini({
        file: image,
        categories,
      })
      if (result.amount) setAmount(String(result.amount))
      if (result.description && !note.trim()) setNote(result.description)
      if (result.suggestedCategory) {
        if ((categories as readonly string[]).includes(result.suggestedCategory)) {
          setCategory(result.suggestedCategory)
        } else {
          setCategory('אחר')
          setCustomCategory(result.suggestedCategory)
        }
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'ניתוח תמונה נכשל')
    } finally {
      setAnalyzing(false)
    }
  }

  const beginEdit = (entry: FinanceEntry) => {
    setEditing(entry)
    setEditType(entry.type)
    const defaultCategoryList = entry.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
    if ((defaultCategoryList as readonly string[]).includes(entry.category)) {
      setEditCategory(entry.category)
      setEditCustomCategory('')
    } else {
      setEditCategory('אחר')
      setEditCustomCategory(entry.category)
    }
    setEditAmount(String(entry.amount))
    setEditNote(entry.note ?? '')
    setEditDate(entry.occurred_on)
    setEditPlanned(entry.planned)
    setEditAccountId(entry.account_id ?? selectedAccountId ?? '')
    setEditReceiptFile(null)
    if (editReceiptPreview) URL.revokeObjectURL(editReceiptPreview)
    setEditReceiptPreview(null)
    setRemoveExistingReceipt(false)
    setEditStatus(null)
  }

  const onEditReceiptSelect = (file?: File | null) => {
    if (!file) return
    if (editReceiptPreview) URL.revokeObjectURL(editReceiptPreview)
    setEditReceiptFile(file)
    setEditReceiptPreview(URL.createObjectURL(file))
    setRemoveExistingReceipt(false)
    void analyzeEditReceipt(file)
  }

  const analyzeEditReceipt = async (fileArg?: File) => {
    const image = fileArg ?? editReceiptFile
    if (!image) return
    setEditAnalyzing(true)
    setEditStatus(null)
    try {
      const result = await analyzeReceiptWithGemini({
        file: image,
        categories: editCategories,
      })
      if (result.amount) setEditAmount(String(result.amount))
      if (result.description && !editNote.trim()) setEditNote(result.description)
      if (result.suggestedCategory) {
        if ((editCategories as readonly string[]).includes(result.suggestedCategory)) {
          setEditCategory(result.suggestedCategory)
        } else {
          setEditCategory('אחר')
          setEditCustomCategory(result.suggestedCategory)
        }
      }
    } catch (err) {
      setEditStatus(err instanceof Error ? err.message : 'ניתוח תמונה נכשל')
    } finally {
      setEditAnalyzing(false)
    }
  }

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !editing) return
    const parsed = Number(editAmount)
    if (!parsed || parsed <= 0) {
      setEditStatus('סכום לא חוקי')
      return
    }

    setEditSaving(true)
    setEditStatus(null)
    try {
      let receiptMeta: {
        receipt_path: string | null
        receipt_filename: string | null
        receipt_mime_type: string | null
        receipt_size_bytes: number | null
      } = {
        receipt_path: editing.receipt_path,
        receipt_filename: editing.receipt_filename,
        receipt_mime_type: editing.receipt_mime_type,
        receipt_size_bytes: editing.receipt_size_bytes,
      }

      if (editReceiptFile) {
        receiptMeta = await uploadReceiptAttachment({
          file: editReceiptFile,
          householdId,
          userId: sessionUserId,
          previousPath: editing.receipt_path,
        })
      } else if (removeExistingReceipt && editing.receipt_path) {
        await deleteReceiptAttachment(editing.receipt_path)
        receiptMeta = {
          receipt_path: null,
          receipt_filename: null,
          receipt_mime_type: null,
          receipt_size_bytes: null,
        }
      }

      const { error } = await supabase
        .from('transactions')
        .update({
          account_id: editAccountId || null,
          type: editType,
          amount: parsed,
          category: resolvedEditCategory,
          note: editNote.trim() || null,
          occurred_on: editDate,
          planned: editPlanned,
          ...receiptMeta,
        })
        .eq('id', editing.id)
      if (error) throw error

      setEditing(null)
      setEditStatus('נשמר בהצלחה')
      onRefresh()
    } catch (err) {
      setEditStatus(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setEditSaving(false)
    }
  }

  const removeEntry = async (entry: FinanceEntry) => {
    if (!supabase) return
    const confirmText = entry.is_auto_from_recurring
      ? 'זו תנועה שנוצרה אוטומטית מקבוע. מחיקה כאן תמחק רק את התנועה בחודש הזה, ולא את הקבוע עצמו. להמשיך?'
      : 'למחוק את התנועה הזו?'
    if (!window.confirm(confirmText)) return
    setStatus(null)
    try {
      if (entry.receipt_path) {
        await deleteReceiptAttachment(entry.receipt_path)
      }
      const { error } = await supabase.from('transactions').delete().eq('id', entry.id)
      if (error) throw error
      setStatus('התנועה נמחקה')
      onRefresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'מחיקה נכשלה')
    }
  }

  return (
    <div className="screen-pad">
      {loading ? <p className="muted">טוען…</p> : null}

      <article className="card card-form bank-feed-head">
        <div className="feed-filter-row">
          <strong>פיד תנועות</strong>
          <MonthValuePicker
            value={selectedMonth}
            onChange={onSelectedMonthChange}
            className="tx-month-picker dashboard-month-picker"
          />
          <div className="segmented scope-mini">
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
          <div className="segmented feed-segmented">
            <button
              type="button"
              className={entryFilter === 'expenses' ? 'seg active' : 'seg'}
              onClick={() => setEntryFilter('expenses')}
            >
              הוצאות
            </button>
            <button
              type="button"
              className={entryFilter === 'income' ? 'seg active' : 'seg'}
              onClick={() => setEntryFilter('income')}
            >
              הכנסות
            </button>
            <button
              type="button"
              className={entryFilter === 'all' ? 'seg active' : 'seg'}
              onClick={() => setEntryFilter('all')}
            >
              הכל
            </button>
          </div>
          <button type="button" className="btn-secondary btn-xs" onClick={() => setShowCreate(true)}>
            הוסף חדש
          </button>
        </div>
      </article>

      <article className="card tx-totals-bar">
        {entryFilter === 'expenses' ? (
          <div className="tx-totals-row">
            <span className="tx-totals-label">סך הכל הוצאות</span>
            <strong className="tx-totals-value amount-expense">
              {filteredTotals.expenseTotal.toLocaleString()} ₪
            </strong>
          </div>
        ) : null}
        {entryFilter === 'income' ? (
          <div className="tx-totals-row">
            <span className="tx-totals-label">סך הכל הכנסות</span>
            <strong className="tx-totals-value amount-income">
              {filteredTotals.incomeTotal.toLocaleString()} ₪
            </strong>
          </div>
        ) : null}
        {entryFilter === 'all' ? (
          <>
            <div className="tx-totals-row">
              <span className="tx-totals-label">סך הכל הכנסות</span>
              <strong className="tx-totals-value amount-income">
                {filteredTotals.incomeTotal.toLocaleString()} ₪
              </strong>
            </div>
            <div className="tx-totals-row">
              <span className="tx-totals-label">סך הכל הוצאות</span>
              <strong className="tx-totals-value amount-expense">
                {filteredTotals.expenseTotal.toLocaleString()} ₪
              </strong>
            </div>
            <div className="tx-totals-row tx-totals-balance">
              <span className="tx-totals-label">יתרה</span>
              <strong
                className={`tx-totals-value ${filteredTotals.balance >= 0 ? 'amount-income' : 'amount-expense'}`}
              >
                {filteredTotals.balance.toLocaleString()} ₪
              </strong>
            </div>
          </>
        ) : null}
        <p className="muted small tx-totals-sub">{totalsSubtitle}</p>
      </article>

      <article className="card card-form">
        <h3 className="card-heading">תנועות החודש</h3>
        <ul className="tx-mobile-list">
          {filteredEntries.map((entry) => (
            <li key={`m-${entry.id}`} className="tx-mobile-item">
              <div className="tx-mobile-top">
                <strong>{entry.category}</strong>
                <span className={entry.type === 'expense' ? 'amount-expense' : 'amount-income'}>
                  {entry.amount.toLocaleString()} ₪
                </span>
              </div>
              <div className="tx-mobile-meta">
                <span>{formatShortDate(entry.occurred_on)}</span>
                <span>{entry.ownerName || 'משתמש'}</span>
                {entry.accountName ? <span>{entry.accountName}</span> : null}
              </div>
              {entry.note ? <p className="tx-mobile-note">{entry.note}</p> : null}
              {entry.sourceEntry?.is_auto_from_recurring || entry.sourceEntry?.installment_progress_label ? (
                <div className="entry-badges">
                  {entry.sourceEntry?.is_auto_from_recurring ? (
                    <span className="entry-badge entry-badge-fixed">קבוע-אוטומטי</span>
                  ) : null}
                  {entry.sourceEntry?.installment_progress_label ? (
                    <span className="entry-badge">{entry.sourceEntry.installment_progress_label}</span>
                  ) : null}
                </div>
              ) : null}
              <div className="row-actions">
                {entry.sourceEntry ? (
                  <button type="button" className="btn-secondary btn-xs" onClick={() => beginEdit(entry.sourceEntry!)}>
                    ערוך
                  </button>
                ) : null}
                {entry.sourceEntry ? (
                  <button type="button" className="btn-danger btn-xs" onClick={() => void removeEntry(entry.sourceEntry!)}>
                    מחק
                  </button>
                ) : null}
              </div>
            </li>
          ))}
          {!filteredEntries.length ? <li className="empty">אין תנועות להצגה במסנן הנוכחי.</li> : null}
        </ul>
        <div className="bank-table-wrap">
          <table className="bank-table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>סוג</th>
                <th>קטגוריה</th>
                <th>תיאור</th>
                <th>חשבון/משתמש</th>
                <th>סכום</th>
                <th>סטטוס</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="תאריך">{entry.occurred_on}</td>
                  <td data-label="סוג">{entry.type === 'expense' ? 'הוצאה' : 'הכנסה'}</td>
                  <td data-label="קטגוריה">{entry.category}</td>
                  <td data-label="תיאור">{entry.note || '—'}</td>
                  <td data-label="חשבון/משתמש">{entry.accountName || entry.ownerName || '—'}</td>
                  <td data-label="סכום" className={entry.type === 'expense' ? 'amount-expense' : 'amount-income'}>
                    {entry.amount.toLocaleString()} ₪
                  </td>
                  <td data-label="סטטוס">
                    {entry.sourceEntry?.is_auto_from_recurring ? (
                      <span className="entry-badge entry-badge-fixed">קבוע-אוטומטי</span>
                    ) : null}
                    {entry.sourceEntry?.installment_progress_label ? (
                      <span className="entry-badge">{entry.sourceEntry.installment_progress_label}</span>
                    ) : null}
                    {!entry.sourceEntry?.is_auto_from_recurring &&
                    !entry.sourceEntry?.installment_progress_label ? (
                      <span className="muted small">—</span>
                    ) : null}
                  </td>
                  <td data-label="פעולות">
                    <div className="row-actions">
                      {entry.sourceEntry ? (
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          onClick={() => {
                            if (entry.sourceEntry) beginEdit(entry.sourceEntry)
                          }}
                        >
                          ערוך
                        </button>
                      ) : null}
                      {entry.sourceEntry ? (
                        <button
                          type="button"
                          className="btn-danger btn-xs"
                          onClick={() => {
                            if (entry.sourceEntry) void removeEntry(entry.sourceEntry)
                          }}
                        >
                          מחק
                        </button>
                      ) : null}
                      {entry.sourceEntry?.receipt_url ? (
                        <a
                          className="btn-secondary btn-xs receipt-link-btn"
                          href={entry.sourceEntry.receipt_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          קבלה
                        </a>
                      ) : null}
                      {!entry.sourceEntry ? '—' : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredEntries.length ? (
                <tr>
                  <td colSpan={8} className="empty">
                    אין תנועות להצגה במסנן הנוכחי.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {showCreate ? (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <article className="card card-form modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-heading">הוספת תנועה חדשה</h3>
            <form onSubmit={addEntry} className="stack tight">
              <div className="segmented">
            <button
              type="button"
              className={type === 'expense' ? 'seg active' : 'seg'}
              onClick={() => {
                setType('expense')
                setCategory(EXPENSE_CATEGORIES[0])
              }}
            >
              הוצאה
            </button>
            <button
              type="button"
              className={type === 'income' ? 'seg active' : 'seg'}
              onClick={() => {
                setType('income')
                setCategory(INCOME_CATEGORIES[0])
              }}
            >
              הכנסה
            </button>
              </div>
              <label>
                חשבון
                <select
                  value={selectedAccountId}
                  onChange={(e) => onSelectedAccountIdChange(e.target.value)}
                  required
                >
                  {!accounts.length ? <option value="">אין חשבונות</option> : null}
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              {type === 'expense' ? (
                <section className="receipt-box">
                  <h4 className="receipt-title">חשבונית/צ'ק (אופציונלי)</h4>
                  <label className="receipt-upload">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => onSelectReceipt(e.target.files?.[0])}
                    />
                    <span>צלם או העלה תמונה</span>
                  </label>
                  {receiptPreview ? <img src={receiptPreview} alt="receipt preview" className="receipt-preview" /> : null}
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!receiptFile || analyzing}
                    onClick={() => void analyzeAddReceipt()}
                  >
                    {analyzing ? 'מנתח…' : 'ניתוח AI ומילוי אוטומטי'}
                  </button>
                </section>
              ) : null}
              <label>
                קטגוריה
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
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
                סכום
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
              <label>
                תאריך
                <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
              </label>
              <label>
                הערה
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <label className="check">
                <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} />
                תנועה מתוכננת
              </label>
              <div className="edit-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
                  ביטול
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'שומר…' : 'הוסף'}
                </button>
              </div>
            </form>
            {status ? <p className="inline-status">{status}</p> : null}
          </article>
        </div>
      ) : null}

      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <article className="card card-form edit-card modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-heading">עריכת תנועה</h3>
            <form onSubmit={saveEdit} className="stack tight">
            <div className="segmented">
              <button
                type="button"
                className={editType === 'expense' ? 'seg active' : 'seg'}
                onClick={() => setEditType('expense')}
              >
                הוצאה
              </button>
              <button
                type="button"
                className={editType === 'income' ? 'seg active' : 'seg'}
                onClick={() => setEditType('income')}
              >
                הכנסה
              </button>
            </div>
            <label>
              חשבון
              <select value={editAccountId} onChange={(e) => setEditAccountId(e.target.value)} required>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              קטגוריה
              <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                {editCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            {isOtherCategory(editCategory) ? (
              <label>
                פירוט
                <input value={editCustomCategory} onChange={(e) => setEditCustomCategory(e.target.value)} required />
              </label>
            ) : null}
            <label>
              סכום
              <input type="number" min={0} step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </label>
            <label>
              תאריך
              <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </label>
            <label>
              הערה
              <input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={editPlanned} onChange={(e) => setEditPlanned(e.target.checked)} />
              תנועה מתוכננת
            </label>
            <section className="receipt-box">
              <h4 className="receipt-title">קבלה/חשבונית לתנועה</h4>
              {editing.receipt_url && !removeExistingReceipt ? (
                <a href={editing.receipt_url} target="_blank" rel="noreferrer" className="receipt-link">
                  פתח קבלה נוכחית
                </a>
              ) : null}
              <label className="receipt-upload">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => onEditReceiptSelect(e.target.files?.[0])}
                />
                <span>החלף/הוסף תמונה</span>
              </label>
              {editReceiptPreview ? (
                <img src={editReceiptPreview} alt="edit receipt preview" className="receipt-preview" />
              ) : null}
              <button
                type="button"
                className="btn-secondary"
                disabled={!editReceiptFile || editAnalyzing}
                onClick={() => void analyzeEditReceipt()}
              >
                {editAnalyzing ? 'מנתח…' : 'ניתוח AI מהתמונה החדשה'}
              </button>
              {editing.receipt_path ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={removeExistingReceipt}
                    onChange={(e) => setRemoveExistingReceipt(e.target.checked)}
                  />
                  הסר קבלה קיימת
                </label>
              ) : null}
            </section>
            <div className="edit-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                ביטול
              </button>
              <button type="submit" className="btn-primary" disabled={editSaving}>
                {editSaving ? 'שומר…' : 'שמור שינויים'}
              </button>
            </div>
              {editStatus ? <p className="inline-status">{editStatus}</p> : null}
            </form>
          </article>
        </div>
      ) : null}
    </div>
  )
}
