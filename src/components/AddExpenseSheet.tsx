import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, isOtherCategory } from '../constants/categories'
import type { EntryType, FinancialAccount } from '../types'
import { analyzeReceiptWithGemini } from '../lib/geminiReceipt'
import { uploadReceiptAttachment } from '../lib/receiptStorage'

type AddExpenseSheetProps = {
  open: boolean
  onClose: () => void
  householdId: string
  sessionUserId: string
  selectedMonth: string
  accounts: FinancialAccount[]
  selectedAccountId: string
  onSelectedAccountIdChange: (id: string) => void
  initialType?: EntryType
  onSaved: () => void
}

export function AddExpenseSheet({
  open,
  onClose,
  householdId,
  sessionUserId,
  selectedMonth,
  accounts,
  selectedAccountId,
  onSelectedAccountIdChange,
  initialType = 'expense',
  onSaved,
}: AddExpenseSheetProps) {
  const [type, setType] = useState<EntryType>(initialType)
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0])
  const [customCategory, setCustomCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- איפוס טופס בפתיחה
    setType(initialType)
    setCategory(initialType === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0])
    setCustomCategory('')
    setReceiptFile(null)
    setReceiptPreview(null)
    setError(null)
  }, [open, initialType])

  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview)
    }
  }, [receiptPreview])

  if (!open) return null

  const resolvedCategory = isOtherCategory(category) ? customCategory.trim() || 'אחר' : category

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    const parsed = Number(amount)
    if (!parsed || parsed <= 0) {
      setError('הזן סכום חיובי')
      return
    }
    const [y, m] = selectedMonth.split('-').map(Number)
    const today = new Date()
    const defaultDay = new Date(y, m - 1, Math.min(today.getDate(), new Date(y, m, 0).getDate()))
    const occurredOn = defaultDay.toISOString().slice(0, 10)

    setSaving(true)
    setError(null)
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

      const { error: insertError } = await supabase.from('transactions').insert({
        household_id: householdId,
        owner_id: sessionUserId,
        account_id: selectedAccountId || null,
        ...receiptMeta,
        type,
        amount: parsed,
        category: resolvedCategory,
        note: note.trim() || null,
        occurred_on: occurredOn,
        planned: false,
      })
      if (insertError) throw insertError
      setAmount('')
      setNote('')
      setReceiptFile(null)
      if (receiptPreview) URL.revokeObjectURL(receiptPreview)
      setReceiptPreview(null)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירה')
    } finally {
      setSaving(false)
    }
  }

  const onSelectReceipt = (file?: File | null) => {
    if (!file) return
    if (receiptPreview) URL.revokeObjectURL(receiptPreview)
    setReceiptFile(file)
    setReceiptPreview(URL.createObjectURL(file))
    setError(null)
  }

  const analyzeReceipt = async () => {
    if (!receiptFile) {
      setError('בחר תמונה לפני ניתוח')
      return
    }

    setAnalyzing(true)
    setError(null)
    try {
      const result = await analyzeReceiptWithGemini({
        file: receiptFile,
        categories,
      })

      if (result.amount) {
        setAmount(Number.isInteger(result.amount) ? String(result.amount) : result.amount.toFixed(2))
      }
      if (result.description) {
        setNote((prev) => (prev.trim() ? prev : result.description ?? ''))
      }
      if (result.suggestedCategory) {
        if ((categories as readonly string[]).includes(result.suggestedCategory)) {
          setCategory(result.suggestedCategory)
        } else {
          setCategory('אחר')
          setCustomCategory(result.suggestedCategory)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ניתוח תמונה נכשל')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="sheet-handle" />
        <h2 id="sheet-title" className="sheet-title">
          {type === 'expense' ? 'הוספת הוצאה' : 'הוספת הכנסה'}
        </h2>

        <form onSubmit={submit} className="sheet-form">
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
              <h3 className="receipt-title">צילום / העלאת חשבונית</h3>
              <label className="receipt-upload">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => onSelectReceipt(e.target.files?.[0])}
                />
                <span>צלם או בחר תמונה</span>
              </label>
              {receiptPreview ? (
                <img src={receiptPreview} alt="receipt preview" className="receipt-preview" />
              ) : null}
              <button
                type="button"
                className="btn-secondary"
                disabled={!receiptFile || analyzing}
                onClick={() => void analyzeReceipt()}
              >
                {analyzing ? 'מנתח עם Gemini…' : 'ניתוח אוטומטי ומילוי שדות'}
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
              פירוט קטגוריה
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="למשל: קורס שחייה"
                required
              />
            </label>
          ) : null}

          <label>
            סכום (₪)
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label>
            הערה (אופציונלי)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {error ? <p className="sheet-error">{error}</p> : null}

          <div className="sheet-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              ביטול
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'שומר…' : 'אישור'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
