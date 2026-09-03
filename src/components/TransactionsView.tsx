import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryIcon, isOtherCategory } from '../constants/categories'
import type { EntryType, FinanceEntry, FinancialAccount, HouseholdMemberBrief } from '../types'
import { deleteReceiptAttachment } from '../lib/receiptStorage'
import { householdAccountPickLabel } from '../lib/accountPickLabel'
import { memberProfileDisplayName } from '../lib/displayUser'
import { formatIls } from '../lib/money'
import { colorForAccount, identityLabelForAccount } from '../lib/memberColor'
import { monthValueToFirstDay } from '../lib/month'
import { UndoToast } from './UndoToast'

type TransactionsViewProps = {
  entries: FinanceEntry[]
  selectedMonth: string
  householdId: string
  sessionUserId: string
  householdMembers: HouseholdMemberBrief[]
  accounts: FinancialAccount[]
  selectedAccountId: string
  loading: boolean
  onRefresh: () => void
  onOptimisticRemove: (id: string) => void
  onOptimisticRestore: (entry: FinanceEntry) => void
  onOptimisticUpdate: (entry: FinanceEntry) => void
}

type EntryFilter = 'all' | 'expenses' | 'income'
type SortKey = 'created' | 'date' | 'amount'

function ownerLabel(entry: FinanceEntry) {
  return memberProfileDisplayName(entry.owner_name, entry.owner_email, entry.owner_id, 'משתמש')
}

function isFromRecurringTemplate(e: FinanceEntry | undefined | null): boolean {
  if (!e) return false
  return !!(e.is_auto_from_recurring || e.auto_post_template_id)
}

function compareCreatedDesc(a: FinanceEntry, b: FinanceEntry) {
  if (a.created_at && b.created_at && a.created_at !== b.created_at) {
    return b.created_at.localeCompare(a.created_at)
  }
  if (a.occurred_on !== b.occurred_on) return b.occurred_on.localeCompare(a.occurred_on)
  return b.id.localeCompare(a.id)
}

export function TransactionsView({
  entries,
  selectedMonth,
  householdId,
  sessionUserId,
  householdMembers,
  accounts,
  selectedAccountId,
  loading,
  onRefresh,
  onOptimisticRemove,
  onOptimisticRestore,
  onOptimisticUpdate,
}: TransactionsViewProps) {
  const [entryFilter, setEntryFilter] = useState<EntryFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('created')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const [editing, setEditing] = useState<FinanceEntry | null>(null)
  const [editType, setEditType] = useState<EntryType>('expense')
  const [editCategory, setEditCategory] = useState<string>(EXPENSE_CATEGORIES[0] ?? 'אחר')
  const [editCustomCategory, setEditCustomCategory] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editAccountId, setEditAccountId] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editStatus, setEditStatus] = useState<string | null>(null)

  const [undo, setUndo] = useState<{ entry: FinanceEntry } | null>(null)
  const undoTimer = useRef<number | null>(null)

  const editCategories = editType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const resolvedEditCategory = isOtherCategory(editCategory) ? editCustomCategory.trim() || 'אחר' : editCategory

  const filtered = useMemo(() => {
    const monthRows = entries.filter((e) => e.occurred_on.slice(0, 7) === selectedMonth)
    const typed =
      entryFilter === 'expenses'
        ? monthRows.filter((e) => e.type === 'expense')
        : entryFilter === 'income'
          ? monthRows.filter((e) => e.type === 'income')
          : monthRows
    const q = query.trim().toLowerCase()
    const searched = q
      ? typed.filter((e) => {
          const hay = `${e.category} ${e.note ?? ''} ${e.amount} ${ownerLabel(e)}`.toLowerCase()
          return hay.includes(q)
        })
      : typed
    return [...searched].sort((a, b) => {
      if (sortKey === 'amount') return b.amount - a.amount
      if (sortKey === 'date') {
        if (a.occurred_on !== b.occurred_on) return b.occurred_on.localeCompare(a.occurred_on)
        return compareCreatedDesc(a, b)
      }
      return compareCreatedDesc(a, b)
    })
  }, [entries, selectedMonth, entryFilter, query, sortKey])

  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    for (const e of filtered) {
      if (e.type === 'income') income += e.amount
      else expense += e.amount
    }
    return { income, expense, balance: income - expense, count: filtered.length }
  }, [filtered])

  const formatShortDate = (dateValue: string) => {
    const d = new Date(`${dateValue}T00:00:00`)
    if (Number.isNaN(d.getTime())) return dateValue
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onScroll = () => setHeaderCollapsed(el.scrollTop > 24)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const editCardRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!editing) return
    const node = editCardRef.current
    if (!node) return
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    window.setTimeout(() => node.scrollIntoView({ block: 'center', inline: 'nearest' }), 50)
  }, [editing])

  const beginEdit = (entry: FinanceEntry) => {
    setEditing(entry)
    setEditType(entry.type)
    const list = entry.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
    if ((list as readonly string[]).includes(entry.category)) {
      setEditCategory(entry.category)
      setEditCustomCategory('')
    } else {
      setEditCategory('אחר')
      setEditCustomCategory(entry.category)
    }
    setEditAmount(String(entry.amount))
    setEditNote(entry.note ?? '')
    setEditDate(entry.occurred_on)
    setEditAccountId(entry.account_id ?? selectedAccountId ?? '')
    setEditStatus(null)
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
    const next: FinanceEntry = {
      ...editing,
      type: editType,
      amount: parsed,
      category: resolvedEditCategory,
      note: editNote.trim() || null,
      occurred_on: editDate,
      account_id: editAccountId || null,
      manually_edited: true,
    }
    onOptimisticUpdate(next)
    try {
      const patch: Record<string, unknown> = {
        account_id: editAccountId || null,
        type: editType,
        amount: parsed,
        category: resolvedEditCategory,
        note: editNote.trim() || null,
        occurred_on: editDate,
        planned: false,
        manually_edited: true,
      }
      const { error } = await supabase.from('transactions').update(patch).eq('id', editing.id)
      if (error) {
        if (error.code === '42703' || error.message?.includes('manually_edited')) {
          delete patch.manually_edited
          const retry = await supabase.from('transactions').update(patch).eq('id', editing.id)
          if (retry.error) throw retry.error
        } else {
          throw error
        }
      }
      setEditing(null)
    } catch (err) {
      setEditStatus(err instanceof Error ? err.message : 'שמירה נכשלה')
      onRefresh()
    } finally {
      setEditSaving(false)
    }
  }

  const commitDelete = async (entry: FinanceEntry) => {
    if (!supabase) return
    if (entry.receipt_path) {
      await deleteReceiptAttachment(entry.receipt_path)
    }
    if (entry.auto_post_template_id) {
      const skipMonth = monthValueToFirstDay(entry.auto_post_month ?? entry.occurred_on)
      const { error: skipErr } = await supabase.from('recurring_skips').upsert({
        household_id: householdId,
        template_id: entry.auto_post_template_id,
        skip_month: skipMonth,
      })
      if (skipErr && skipErr.code !== '42P01' && skipErr.code !== '42703') {
        console.warn('recurring_skips insert failed', skipErr.message)
      }
    }
    const { error } = await supabase.from('transactions').delete().eq('id', entry.id)
    if (error) throw error
  }

  const removeEntry = (entry: FinanceEntry) => {
    onOptimisticRemove(entry.id)
    setUndo({ entry })
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => {
      void commitDelete(entry).catch(() => {
        onOptimisticRestore(entry)
      })
      setUndo(null)
      undoTimer.current = null
    }, 5000)
  }

  const undoDelete = () => {
    if (!undo) return
    if (undoTimer.current) {
      window.clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
    onOptimisticRestore(undo.entry)
    setUndo(null)
  }

  return (
    <div className="screen-pad tx-sheet-screen">
      <div className={headerCollapsed ? 'tx-toolbar is-collapsed' : 'tx-toolbar'}>
        <div className="tx-toolbar-main">
          <button
            type="button"
            className="icon-btn"
            aria-label="חיפוש"
            onClick={() => setSearchOpen((v) => !v)}
          >
            ⌕
          </button>
        </div>
        {searchOpen || query ? (
          <input
            className="tx-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש קטגוריה, סכום, הערה…"
            autoFocus={searchOpen}
          />
        ) : null}
        {!headerCollapsed ? (
          <div className="tx-toolbar-filters">
            <div className="segmented feed-segmented">
              <button
                type="button"
                className={entryFilter === 'all' ? 'seg active' : 'seg'}
                onClick={() => setEntryFilter('all')}
              >
                הכל
              </button>
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
            </div>
            <select
              className="sort-select"
              aria-label="מיון"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="created">הוספה אחרונה</option>
              <option value="date">תאריך</option>
              <option value="amount">סכום</option>
            </select>
          </div>
        ) : null}
      </div>

      <div className="tx-sheet-list" ref={listRef}>
        {loading && !entries.length ? (
          <div className="skeleton-list">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        ) : null}
        {filtered.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="tx-sheet-row"
            style={
              {
                '--member-fg': colorForAccount(
                  accounts.find((a) => a.id === entry.account_id),
                  householdMembers,
                  sessionUserId,
                  entry.owner_id,
                ).fg,
              } as CSSProperties
            }
            onClick={() => beginEdit(entry)}
          >
            <span className="tx-sheet-icon" aria-hidden>
              {categoryIcon(entry.category)}
            </span>
            <span className="tx-sheet-main">
              <strong>{entry.note?.trim() || entry.category}</strong>
              <span className="tx-sheet-sub">
                <span className="member-dot-label">
                  {identityLabelForAccount(
                    accounts.find((a) => a.id === entry.account_id),
                    householdMembers,
                    entry.owner_id,
                    entry.owner_name,
                  )}
                </span>
                {` · ${formatShortDate(entry.occurred_on)}`}
                {entry.note?.trim() ? ` · ${entry.category}` : ''}
                {isFromRecurringTemplate(entry) ? ' · ↻' : ''}
              </span>
              {entry.installment_progress_label ? (
                <span
                  className={
                    entry.installment_progress_label === '∞'
                      ? 'tx-remain-badge is-infinite'
                      : 'tx-remain-badge'
                  }
                >
                  {entry.installment_progress_label}
                </span>
              ) : null}
            </span>
            <span className={entry.type === 'expense' ? 'tx-sheet-amt amount-expense' : 'tx-sheet-amt amount-income'}>
              {entry.type === 'expense' ? '−' : '+'}
              {formatIls(entry.amount)}
            </span>
          </button>
        ))}
        {!filtered.length && !loading ? <p className="empty">אין תנועות להצגה.</p> : null}
      </div>

      <div className="tx-sticky-totals">
        <div>
          <span>הכנסות</span>
          <strong className="amount-income tabular">{formatIls(totals.income)}</strong>
        </div>
        <div>
          <span>הוצאות</span>
          <strong className="amount-expense tabular">{formatIls(totals.expense)}</strong>
        </div>
        <div>
          <span>יתרה</span>
          <strong className={totals.balance >= 0 ? 'amount-income tabular' : 'amount-expense tabular'}>
            {formatIls(totals.balance)}
          </strong>
        </div>
      </div>

      <UndoToast
        message={undo ? 'התנועה נמחקה' : null}
        onUndo={undoDelete}
        onDismiss={() => setUndo(null)}
      />

      {editing
        ? createPortal(
        <div className="modal-backdrop modal-backdrop--sheet" onClick={() => setEditing(null)}>
          <article
            ref={editCardRef}
            className="card card-form modal-card"
            onClick={(e) => e.stopPropagation()}
          >
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
                <select value={editAccountId} onChange={(e) => setEditAccountId(e.target.value)}>
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
              {isFromRecurringTemplate(editing) ? (
                <p className="muted small">עריכה ידנית של קבוע תישמר לחודש הזה בלבד ולא תידרס בסנכרון.</p>
              ) : null}
              <div className="edit-actions">
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    const target = editing
                    setEditing(null)
                    removeEntry(target)
                  }}
                >
                  מחק
                </button>
                <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                  ביטול
                </button>
                <button type="submit" className="btn-primary" disabled={editSaving}>
                  {editSaving ? 'שומר…' : 'שמור'}
                </button>
              </div>
              {editStatus ? <p className="inline-status">{editStatus}</p> : null}
              {editing.receipt_url ? (
                <a href={editing.receipt_url} target="_blank" rel="noreferrer" className="receipt-link">
                  פתח קבלה
                </a>
              ) : null}
            </form>
          </article>
        </div>,
        document.body,
      )
        : null}
    </div>
  )
}
