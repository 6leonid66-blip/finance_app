import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, isOtherCategory } from '../constants/categories'
import type { EntryType, FinanceEntry, FinancialAccount, HouseholdMemberBrief } from '../types'
import { analyzeReceiptWithGemini } from '../lib/geminiReceipt'
import { deleteReceiptAttachment, uploadReceiptAttachment } from '../lib/receiptStorage'
import { MonthValuePicker } from './MonthValuePicker'
import { householdAccountPickLabel } from '../lib/accountPickLabel'
import { memberProfileDisplayName } from '../lib/displayUser'

type TransactionsViewProps = {
  entries: FinanceEntry[]
  selectedMonth: string
  onSelectedMonthChange: (month: string) => void
  householdId: string
  sessionUserId: string
  householdMembers: HouseholdMemberBrief[]
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
  return memberProfileDisplayName(entry.owner_name, entry.owner_email, entry.owner_id, 'משתמש')
}

/** Same ordering as legacy feed: category → created_at → occurred_on → id */
function compareFinanceEntryDisplayOrder(a: FinanceEntry, b: FinanceEntry): number {
  const catCmp = a.category.localeCompare(b.category, 'he')
  if (catCmp !== 0) return catCmp
  if (a.created_at && b.created_at && a.created_at !== b.created_at) {
    return b.created_at.localeCompare(a.created_at)
  }
  if (a.occurred_on !== b.occurred_on) {
    return b.occurred_on.localeCompare(a.occurred_on)
  }
  return b.id.localeCompare(a.id)
}

/** Row materialised from recurring template auto-post into `transactions`. */
function isFromRecurringTemplate(e: FinanceEntry | undefined | null): boolean {
  if (!e) return false
  return !!(e.is_auto_from_recurring || e.auto_post_template_id)
}

type FeedSectionTotals = { income: number; expense: number }

type FeedRenderItem =
  | { kind: 'section'; key: string; label: string; totals?: FeedSectionTotals }
  | { kind: 'row'; entry: FeedItem }

/** סכום הכנסות/הוצאות של קבוצת שורות (אחרי הפילטר בפיד). */
function bucketIncomeExpense(items: FeedItem[]) {
  let income = 0
  let expense = 0
  for (const it of items) {
    if (it.type === 'income') income += it.amount
    else expense += it.amount
  }
  return { income, expense }
}

function sectionTotalSubtitle(filter: EntryFilter, totals: FeedSectionTotals) {
  if (filter === 'expenses') {
    return `סך הכל: ${totals.expense.toLocaleString()} ₪`
  }
  if (filter === 'income') {
    return `סך הכל: ${totals.income.toLocaleString()} ₪`
  }
  const { income, expense } = totals
  const balance = income - expense
  return `הוצאות ${expense.toLocaleString()} ₪ · הכנסות ${income.toLocaleString()} ₪ · יתרה ${balance.toLocaleString()} ₪`
}

export function TransactionsView({
  entries,
  selectedMonth,
  onSelectedMonthChange,
  householdId,
  sessionUserId,
  householdMembers,
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

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(() => new Set())
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const skipNextRowTapRef = useRef(false)

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const resolvedCategory = isOtherCategory(category) ? customCategory.trim() || 'אחר' : category
  const editCategories = editType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const resolvedEditCategory = isOtherCategory(editCategory) ? editCustomCategory.trim() || 'אחר' : editCategory

  const sortedEntries = useMemo(() => [...entries].sort(compareFinanceEntryDisplayOrder), [entries])

  const allFeedItems = useMemo<FeedItem[]>(
    () =>
      sortedEntries.map((entry) => ({
        id: `tx-${entry.id}`,
        type: entry.type,
        amount: entry.amount,
        category: entry.category,
        note: entry.note,
        occurred_on: entry.occurred_on,
        sourceEntry: entry,
        accountName: entry.account_name ?? null,
        ownerName: ownerLabel(entry),
      })),
    [sortedEntries],
  )

  const formatShortDate = (dateValue: string) => {
    const d = new Date(`${dateValue}T00:00:00`)
    if (Number.isNaN(d.getTime())) return dateValue
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  const filteredEntries = useMemo(() => {
    // Always pin the visible list to the currently selected month using a
    // string comparison on the YYYY-MM prefix of occurred_on. This is the
    // single source of truth for which rows are eligible for display, and
    // it is intentionally independent of any server-side date range filter
    // so that timezone drift, stale fetches, or future fetch-window
    // changes can never leak adjacent-month rows into the view. The type
    // filter is layered on top so {month} x {type} intersect correctly.
    const monthFiltered = allFeedItems.filter((entry) => entry.occurred_on.slice(0, 7) === selectedMonth)
    if (entryFilter === 'expenses') return monthFiltered.filter((entry) => entry.type === 'expense')
    if (entryFilter === 'income') return monthFiltered.filter((entry) => entry.type === 'income')
    return monthFiltered
  }, [allFeedItems, entryFilter, selectedMonth])

  // Duplicate detection: oldest row by created_at stays unmarked; later
  // entries with same (type, amount, occurred_on, note) get highlighted.
  const duplicateHighlightIds = useMemo(() => {
    const buckets = new Map<string, FeedItem[]>()
    filteredEntries.forEach((entry) => {
      const monthKey = entry.occurred_on.slice(0, 7)
      const note = (entry.note ?? '').trim().toLowerCase()
      const key = `${entry.type}|${entry.amount}|${entry.occurred_on}|${monthKey}|${note}`
      const list = buckets.get(key) ?? []
      list.push(entry)
      buckets.set(key, list)
    })
    const ids = new Set<string>()
    buckets.forEach((items) => {
      if (items.length < 2) return
      const sorted = [...items].sort((a, b) => {
        const ca = a.sourceEntry?.created_at ?? ''
        const cb = b.sourceEntry?.created_at ?? ''
        if (ca !== cb) return ca.localeCompare(cb)
        const ida = a.sourceEntry?.id ?? a.id
        const idb = b.sourceEntry?.id ?? b.id
        return ida.localeCompare(idb)
      })
      for (let i = 1; i < sorted.length; i++) {
        ids.add(sorted[i].id)
      }
    })
    return ids
  }, [filteredEntries])

  /** Recurring/auto-post rows first, then manual; headings when both buckets exist */
  const feedRenderList = useMemo((): FeedRenderItem[] => {
    const fromTemplateRaw: FeedItem[] = []
    const manualRaw: FeedItem[] = []
    for (const f of filteredEntries) {
      if (isFromRecurringTemplate(f.sourceEntry)) fromTemplateRaw.push(f)
      else manualRaw.push(f)
    }
    const sortBucket = (arr: FeedItem[]) =>
      [...arr].sort((a, b) => {
        if (!a.sourceEntry || !b.sourceEntry) return 0
        return compareFinanceEntryDisplayOrder(a.sourceEntry, b.sourceEntry)
      })
    const fromTemplate = sortBucket(fromTemplateRaw)
    const manual = sortBucket(manualRaw)
    const recTotals = bucketIncomeExpense(fromTemplate)
    const manTotals = bucketIncomeExpense(manual)
    const out: FeedRenderItem[] = []
    if (fromTemplate.length > 0) {
      out.push({
        kind: 'section',
        key: 'sec-recurring',
        label: 'מתוך הקבועים',
        totals: recTotals,
      })
    }
    fromTemplate.forEach((entry) => out.push({ kind: 'row', entry }))
    if (fromTemplate.length > 0 && manual.length > 0) {
      out.push({
        kind: 'section',
        key: 'sec-manual',
        label: 'תנועות ידניות',
        totals: manTotals,
      })
    }
    if (fromTemplate.length === 0 && manual.length > 0) {
      out.push({
        kind: 'section',
        key: 'sec-manual',
        label: 'תנועות ידניות',
        totals: manTotals,
      })
    }
    manual.forEach((entry) => out.push({ kind: 'row', entry }))
    return out
  }, [filteredEntries])

  const toggleTxnSelected = (financeId: string) => {
    setSelectedTxnIds((prev) => {
      const next = new Set(prev)
      if (next.has(financeId)) next.delete(financeId)
      else next.add(financeId)
      return next
    })
  }

  const clearSelection = () => {
    setSelectionMode(false)
    setSelectedTxnIds(new Set())
  }

  const beginLongPress = (financeId: string) => {
    longPressFiredRef.current = false
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true
      skipNextRowTapRef.current = true
      setSelectionMode(true)
      setSelectedTxnIds((prev) => new Set(prev).add(financeId))
      longPressTimerRef.current = null
    }, 500)
  }

  const endLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleRowTap = (item: FeedItem) => {
    if (skipNextRowTapRef.current) {
      skipNextRowTapRef.current = false
      return
    }
    const fid = item.sourceEntry?.id
    if (!fid) return
    if (!selectionMode) return
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      return
    }
    toggleTxnSelected(fid)
  }

  const removeBulk = async () => {
    if (!supabase) return
    const ids = Array.from(selectedTxnIds)
    if (!ids.length) return
    const targets: FinanceEntry[] = []
    for (const id of ids) {
      const fi = filteredEntries.find((f) => f.sourceEntry?.id === id)
      if (fi?.sourceEntry) targets.push(fi.sourceEntry)
    }
    if (targets.length !== ids.length) {
      setStatus('לא ניתן למחוק את כל הנבחרים')
      return
    }
    const anyAuto = targets.some((e) => isFromRecurringTemplate(e))
    const msg =
      anyAuto && targets.length > 1
        ? `${targets.length} תנועות יימחקו. חלקן נוצרו אוטומטית מקבועים — מחיקה תסיר את התנועה בחודש הזה בלבד. להמשיך?`
        : anyAuto && targets.length === 1
          ? 'זו תנועה שנוצרה אוטומטית מקבוע. מחיקה כאן תמחק רק את התנועה בחודש הזה, ולא את הקבוע עצמו. להמשיך?'
          : `למחוק ${targets.length} תנועות?`
    if (!window.confirm(msg)) return
    setStatus(null)
    try {
      for (const e of targets) {
        if (e.receipt_path) {
          await deleteReceiptAttachment(e.receipt_path)
        }
      }
      const { error } = await supabase.from('transactions').delete().in('id', ids)
      if (error) throw error
      clearSelection()
      setStatus(`נמחקו ${targets.length} תנועות`)
      onRefresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'מחיקה נכשלה')
    }
  }

  useEffect(() => () => endLongPress(), [])

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
  const scopeHint = scopeMode === 'shared' ? 'כל המשתמשים' : 'רק תנועות שלי'
  const totalsSubtitle = `${scopeLabel} (${scopeHint}) · ${monthLabel} · ${filteredTotals.count.toLocaleString()} תנועות`

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
    clearSelection()
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
    const confirmText = isFromRecurringTemplate(entry)
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
        <div className="card-heading-row">
          <h3 className="card-heading">תנועות החודש</h3>
          {selectionMode ? (
            <div className="row-actions tx-selection-actions">
              <span className="muted small">{selectedTxnIds.size} נבחרו</span>
              <button type="button" className="btn-secondary btn-xs" onClick={clearSelection}>
                בטל בחירה
              </button>
              <button
                type="button"
                className="btn-danger btn-xs"
                disabled={!selectedTxnIds.size}
                onClick={() => void removeBulk()}
              >
                מחק נבחרים
              </button>
            </div>
          ) : (
            <p className="muted small tx-select-hint">לחיצה ארוכה על שורה — לבחירה ומחיקה מרובת</p>
          )}
        </div>
        <ul className="tx-mobile-list">
          {feedRenderList.map((item) => {
            if (item.kind === 'section') {
              return (
                <li key={item.key} className="tx-feed-section tx-feed-section-sticky">
                  <div className="tx-feed-section-title">{item.label}</div>
                  {item.totals ? (
                    <div className="tx-feed-section-sum">{sectionTotalSubtitle(entryFilter, item.totals)}</div>
                  ) : null}
                </li>
              )
            }
            const entry = item.entry
            const financeId = entry.sourceEntry?.id
            const isDupExtra = duplicateHighlightIds.has(entry.id)
            const isSelected = financeId ? selectedTxnIds.has(financeId) : false
            return (
            <li
              key={`m-${entry.id}`}
              className={`tx-mobile-item${isDupExtra ? ' duplicate-row' : ''}${selectionMode && isSelected ? ' tx-row-selected' : ''}`}
              onPointerDown={() => financeId && beginLongPress(financeId)}
              onPointerUp={endLongPress}
              onPointerLeave={endLongPress}
              onPointerCancel={endLongPress}
              onClick={() => handleRowTap(entry)}
            >
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
              {entry.sourceEntry?.installment_progress_label ||
              isFromRecurringTemplate(entry.sourceEntry) ||
              isDupExtra ? (
                <div className="entry-badges">
                  {isFromRecurringTemplate(entry.sourceEntry) ? (
                    <span className="entry-badge entry-badge-fixed">מתוך הקבועים</span>
                  ) : null}
                  {entry.sourceEntry?.installment_progress_label ? (
                    <span className="entry-badge entry-badge-progress">{entry.sourceEntry.installment_progress_label}</span>
                  ) : null}
                  {isDupExtra ? (
                    <span
                      className="entry-badge entry-badge-duplicate"
                      title="עותק חשוד (לפי הרשומה הישנה יותר עם אותם פרטים). אפשר למחוק את המסומן אם כפילות בטעות."
                    >
                      עותק חשוד
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="row-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
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
            )
          })}
          {!filteredEntries.length ? <li className="empty">אין תנועות להצגה במסנן הנוכחי.</li> : null}
        </ul>
        <div className="bank-table-wrap tx-trans-feed-scroll">
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
              {feedRenderList.map((item) => {
                if (item.kind === 'section') {
                  return (
                    <tr key={item.key} className="tx-section-row tx-section-row-sticky">
                      <td colSpan={8} className="tx-section-label">
                        <div className="tx-section-label-inner">
                          <span className="tx-section-title">{item.label}</span>
                          {item.totals ? (
                            <span className="tx-section-sum">{sectionTotalSubtitle(entryFilter, item.totals)}</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                }
                const entry = item.entry
                const financeId = entry.sourceEntry?.id
                const isDupExtra = duplicateHighlightIds.has(entry.id)
                const isSelected = financeId ? selectedTxnIds.has(financeId) : false
                const rowCls = [
                  isDupExtra ? 'duplicate-row' : '',
                  selectionMode && isSelected ? 'tx-row-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                const fromRec = isFromRecurringTemplate(entry.sourceEntry)
                return (
                <tr
                  key={entry.id}
                  className={rowCls || undefined}
                  onPointerDown={() => financeId && beginLongPress(financeId)}
                  onPointerUp={endLongPress}
                  onPointerLeave={endLongPress}
                  onPointerCancel={endLongPress}
                  onClick={() => handleRowTap(entry)}
                >
                  <td data-label="תאריך">{entry.occurred_on}</td>
                  <td data-label="סוג">{entry.type === 'expense' ? 'הוצאה' : 'הכנסה'}</td>
                  <td data-label="קטגוריה">{entry.category}</td>
                  <td data-label="תיאור">{entry.note || '—'}</td>
                  <td data-label="חשבון/משתמש">{entry.accountName || entry.ownerName || '—'}</td>
                  <td data-label="סכום" className={entry.type === 'expense' ? 'amount-expense' : 'amount-income'}>
                    {entry.amount.toLocaleString()} ₪
                  </td>
                  <td data-label="סטטוס">
                    {fromRec ? (
                      <span className="entry-badge entry-badge-fixed">מתוך הקבועים</span>
                    ) : null}
                    {entry.sourceEntry?.installment_progress_label ? (
                      <span className="entry-badge entry-badge-progress">{entry.sourceEntry.installment_progress_label}</span>
                    ) : null}
                    {isDupExtra ? (
                      <span
                        className="entry-badge entry-badge-duplicate"
                        title="עותק חשוד (לפי הרשומה הישנה יותר עם אותם פרטים). אפשר למחוק את המסומן אם כפילות בטעות."
                      >
                        עותק חשוד
                      </span>
                    ) : null}
                    {!fromRec &&
                    !entry.sourceEntry?.installment_progress_label &&
                    !isDupExtra ? (
                      <span className="muted small">—</span>
                    ) : null}
                  </td>
                  <td data-label="פעולות">
                    <div className="row-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
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
                )
              })}
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
                      {householdAccountPickLabel(account, sessionUserId, householdMembers)}
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
                    {householdAccountPickLabel(account, sessionUserId, householdMembers)}
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
