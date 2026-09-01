import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, isOtherCategory } from '../constants/categories'
import type { EntryType, FinanceEntry, FinancialAccount, HouseholdMemberBrief } from '../types'
import { uploadReceiptAttachment } from '../lib/receiptStorage'
import { getSpeechRecognitionCtor } from '../lib/speech'
import { householdAccountPickLabel } from '../lib/accountPickLabel'
import { formatLocalYmd, getLocalMonthValue } from '../lib/month'
import { CategoryGrid } from './CategoryGrid'

export type AddExpensePrefill = {
  amount?: string
  note?: string
  category?: string
  customCategory?: string
} | null

type AddExpenseSheetProps = {
  open: boolean
  onClose: () => void
  householdId: string
  sessionUserId: string
  householdMembers: HouseholdMemberBrief[]
  accounts: FinancialAccount[]
  selectedAccountId: string
  onSelectedAccountIdChange: (id: string) => void
  initialType?: EntryType
  prefill?: AddExpensePrefill
  defaultMonth?: string
  onSaved: (saved: { month: string; entry?: FinanceEntry }) => void | Promise<void>
}

export function AddExpenseSheet({
  open,
  onClose,
  householdId,
  sessionUserId,
  householdMembers,
  accounts,
  selectedAccountId,
  onSelectedAccountIdChange,
  initialType = 'expense',
  prefill,
  defaultMonth,
  onSaved,
}: AddExpenseSheetProps) {
  const [type, setType] = useState<EntryType>(initialType)
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0] ?? 'מזון')
  const [customCategory, setCustomCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [occurredOn, setOccurredOn] = useState(() => formatLocalYmd(new Date()))
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [recordingVoice, setRecordingVoice] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  useEffect(() => {
    if (!open) return
    setType(initialType)
    setCustomCategory(prefill?.customCategory ?? '')
    setRecordingVoice(false)
    setReceiptFile(null)
    setReceiptPreview(null)
    setError(null)
    setShowMore(false)
    const month = (defaultMonth ?? getLocalMonthValue()).slice(0, 7)
    const today = new Date()
    const todayKey = getLocalMonthValue(today)
    if (month === todayKey) {
      setOccurredOn(formatLocalYmd(today))
    } else {
      const [y, m] = month.split('-').map(Number)
      setOccurredOn(formatLocalYmd(new Date(y, m - 1, 1)))
    }
    const baseCategoryList = initialType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
    if (prefill?.category && (baseCategoryList as readonly string[]).includes(prefill.category)) {
      setCategory(prefill.category)
    } else if (prefill?.customCategory) {
      setCategory('אחר')
    } else {
      setCategory(baseCategoryList[0] ?? 'אחר')
    }
    setAmount(prefill?.amount ?? '')
    setNote(prefill?.note ?? '')
  }, [open, initialType, prefill, defaultMonth])

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
    if (!selectedAccountId?.trim()) {
      setError('בחר חשבון לפני שמירה')
      return
    }
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

      const { data, error: insertError } = await supabase
        .from('transactions')
        .insert({
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
        .select(
          'id,owner_id,account_id,receipt_path,receipt_filename,receipt_mime_type,receipt_size_bytes,auto_post_template_id,auto_post_month,type,amount,category,note,occurred_on,planned,created_at',
        )
        .single()
      if (insertError) throw insertError
      const savedMonth = occurredOn.slice(0, 7)
      const entry = data
        ? ({
            ...(data as FinanceEntry),
            amount: Number((data as FinanceEntry).amount),
            is_auto_from_recurring: false,
          } satisfies FinanceEntry)
        : undefined
      setAmount('')
      setNote('')
      setReceiptFile(null)
      if (receiptPreview) URL.revokeObjectURL(receiptPreview)
      setReceiptPreview(null)
      onClose()
      await Promise.resolve(onSaved({ month: savedMonth, entry }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירה')
    } finally {
      setSaving(false)
    }
  }

  const toggleVoiceCapture = () => {
    if (recordingVoice) return
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setError('דפדפן זה לא תומך בהקלטה קולית')
      return
    }
    const recognition = new Ctor()
    recognition.lang = 'he-IL'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.maxAlternatives = 1
    setRecordingVoice(true)
    setError(null)
    recognition.onresult = (event) => {
      const transcript = event.results?.[event.results.length - 1]?.[0]?.transcript?.trim()
      if (!transcript) return
      setNote((prev) => (prev.trim() ? prev : transcript))
      const amountMatch = transcript.match(/(\d+(?:[.,]\d{1,2})?)/)
      if (amountMatch?.[1]) {
        const parsedAmount = Number(amountMatch[1].replace(',', '.'))
        if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
          setAmount(Number.isInteger(parsedAmount) ? String(parsedAmount) : parsedAmount.toFixed(2))
        }
      }
      const matchedCategory = categories.find((c) => transcript.includes(c))
      if (matchedCategory) setCategory(matchedCategory)
    }
    recognition.onerror = () => setError('הקלטה קולית נכשלה. נסה שוב.')
    recognition.onend = () => setRecordingVoice(false)
    recognition.start()
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
                setCategory(EXPENSE_CATEGORIES[0] ?? 'אחר')
              }}
            >
              הוצאה
            </button>
            <button
              type="button"
              className={type === 'income' ? 'seg active' : 'seg'}
              onClick={() => {
                setType('income')
                setCategory(INCOME_CATEGORIES[0] ?? 'אחר')
              }}
            >
              הכנסה
            </button>
          </div>

          <label className="amount-field">
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
              className="amount-input"
            />
          </label>

          <div>
            <span className="field-label">קטגוריה</span>
            <CategoryGrid type={type} value={category} onChange={setCategory} />
          </div>

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
            תאריך
            <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
          </label>

          <label>
            הערה (אופציונלי)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <button type="button" className="link-btn" onClick={() => setShowMore((v) => !v)}>
            {showMore ? 'הסתר פרטים נוספים' : 'עוד פרטים · חשבון / קבלה / קול'}
          </button>

          {showMore ? (
            <>
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
              <section className="receipt-box">
                <button
                  type="button"
                  className={recordingVoice ? 'btn-secondary voice-btn pulse' : 'btn-secondary'}
                  onClick={toggleVoiceCapture}
                >
                  {recordingVoice ? 'מקליט…' : '🎙️ הוספה קולית'}
                </button>
                <label className="receipt-upload">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (receiptPreview) URL.revokeObjectURL(receiptPreview)
                      setReceiptFile(file)
                      setReceiptPreview(URL.createObjectURL(file))
                    }}
                  />
                  <span>צרף קבלה (אופציונלי)</span>
                </label>
                {receiptPreview ? <img src={receiptPreview} alt="" className="receipt-preview" /> : null}
              </section>
            </>
          ) : null}

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
