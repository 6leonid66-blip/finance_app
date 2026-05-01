import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../supabase'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, isOtherCategory } from '../constants/categories'
import type { EntryType, FinancialAccount, HouseholdMemberBrief } from '../types'
import { analyzeReceiptWithGemini, analyzeSpokenExpenseWithGemini } from '../lib/geminiReceipt'
import { uploadReceiptAttachment } from '../lib/receiptStorage'
import { getSpeechRecognitionCtor } from '../lib/speech'
import type { SpeechRecognitionLike } from '../lib/speech'
import { householdAccountPickLabel } from '../lib/accountPickLabel'
import { MonthValuePicker } from './MonthValuePicker'
import { formatLocalYmd, getLocalMonthValue } from '../lib/month'

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
  /** Called with the calendar month (YYYY-MM) the transaction was stored under. */
  onSaved: (savedMonth: string) => void | Promise<void>
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
  const [recordingVoice, setRecordingVoice] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Month the row belongs to; reset to current calendar month each time the sheet opens. */
  const [entryMonth, setEntryMonth] = useState(() => getLocalMonthValue())
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const spokenTextRef = useRef('')

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- איפוס טופס בפתיחה
    setType(initialType)
    setCustomCategory(prefill?.customCategory ?? '')
    setRecordingVoice(false)
    spokenTextRef.current = ''
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setReceiptFile(null)
    setReceiptPreview(null)
    setError(null)
    setEntryMonth(getLocalMonthValue())

    const baseCategoryList = initialType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
    if (prefill?.category && (baseCategoryList as readonly string[]).includes(prefill.category)) {
      setCategory(prefill.category)
    } else if (prefill?.customCategory) {
      setCategory('אחר')
    } else {
      setCategory(baseCategoryList[0])
    }
    setAmount(prefill?.amount ?? '')
    setNote(prefill?.note ?? '')
  }, [open, initialType, prefill])

  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview)
      recognitionRef.current?.stop()
      recognitionRef.current = null
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
    const [y, m] = entryMonth.split('-').map(Number)
    const today = new Date()
    const defaultDay = new Date(y, m - 1, Math.min(today.getDate(), new Date(y, m, 0).getDate()))
    const occurredOn = formatLocalYmd(defaultDay)

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
      await Promise.resolve(onSaved(entryMonth.slice(0, 7)))
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
    void analyzeReceipt(file)
  }

  const applyGeminiResult = (result: { amount?: number; description?: string; suggestedCategory?: string }) => {
    if (result.amount) {
      setAmount(Number.isInteger(result.amount) ? String(result.amount) : result.amount.toFixed(2))
    }
    if (result.description) {
      const aiNote = result.description.trim()
      if (aiNote) {
        setNote((prev) => {
          const prevTrim = prev.trim()
          if (!prevTrim) return aiNote
          if (prevTrim === aiNote || prevTrim.includes(aiNote)) return prev
          return `${aiNote} — ${prevTrim}`
        })
      }
    }
    if (result.suggestedCategory) {
      if ((categories as readonly string[]).includes(result.suggestedCategory)) {
        setCategory(result.suggestedCategory)
      } else {
        setCategory('אחר')
        setCustomCategory(result.suggestedCategory)
      }
    }
  }

  const inferFromSpokenText = (spokenText: string) => {
    const normalized = spokenText.trim()
    if (!normalized) return
    const amountMatch = normalized.match(/(\d+(?:[.,]\d{1,2})?)/)
    if (amountMatch?.[1]) {
      const parsedAmount = Number(amountMatch[1].replace(',', '.'))
      if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
        setAmount(Number.isInteger(parsedAmount) ? String(parsedAmount) : parsedAmount.toFixed(2))
      }
    }
    const matchedCategory = categories.find((c) => normalized.includes(c))
    if (matchedCategory) {
      setCategory(matchedCategory)
    }
    setNote((prev) => (prev.trim() ? prev : normalized))
  }

  const analyzeReceipt = async (fileArg?: File) => {
    const image = fileArg ?? receiptFile
    if (!image) {
      setError('בחר תמונה לפני ניתוח')
      return
    }

    setAnalyzing(true)
    setError(null)
    try {
      const result = await analyzeReceiptWithGemini({
        file: image,
        categories,
      })
      applyGeminiResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ניתוח תמונה נכשל')
    } finally {
      setAnalyzing(false)
    }
  }

  const toggleVoiceCapture = () => {
    if (recordingVoice && recognitionRef.current) {
      recognitionRef.current.stop()
      return
    }
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setError('דפדפן זה לא תומך בהקלטה קולית')
      return
    }
    const recognition = new Ctor()
    recognitionRef.current = recognition
    spokenTextRef.current = ''
    recognition.lang = 'he-IL'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.maxAlternatives = 1
    setRecordingVoice(true)
    setError(null)
    recognition.onresult = (event) => {
      const transcript = event.results?.[event.results.length - 1]?.[0]?.transcript?.trim()
      if (!transcript) return
      spokenTextRef.current = `${spokenTextRef.current} ${transcript}`.trim()
    }
    recognition.onerror = () => {
      setError('הקלטה קולית נכשלה. נסה שוב.')
    }
    recognition.onend = () => {
      setRecordingVoice(false)
      const spokenText = spokenTextRef.current.trim()
      spokenTextRef.current = ''
      recognitionRef.current = null
      if (!spokenText) return
      setNote((prev) => (prev.trim() ? prev : spokenText))
      void analyzeSpokenExpenseWithGemini({ spokenText, categories })
        .then((parsed) => applyGeminiResult(parsed))
        .catch((err) => {
          inferFromSpokenText(spokenText)
          setError(
            err instanceof Error
              ? `${err.message}. מילאתי את מה שאפשר מתוך הטקסט הקולי, אפשר להשלים ידנית ולאשר.`
              : 'פענוח קול נכשל. מילאתי חלקית מהטקסט הקולי.',
          )
        })
    }
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
            חודש של התנועה
            <MonthValuePicker value={entryMonth} onChange={setEntryMonth} className="sheet-month-picker" />
            <span className="muted small" style={{ display: 'block', marginTop: 4 }}>
              ברירת המחדל: החודש הנוכחי בפתיחת המסך. אפשר לשנות אם ההוצאה או ההכנסה שייכות לחודש אחר.
            </span>
          </label>

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
            <h3 className="receipt-title">
              {type === 'expense' ? 'צילום / העלאת חשבונית' : 'צילום / העלאת אסמכתא להכנסה'}
            </h3>
            <button
              type="button"
              className={recordingVoice ? 'btn-danger voice-btn pulse' : 'btn-danger voice-btn'}
              onClick={toggleVoiceCapture}
              aria-busy={recordingVoice}
            >
              <span className="btn-label">
                {recordingVoice
                  ? '⏹ עצור הקלטה ומלא'
                  : type === 'expense'
                    ? '🎙️ הוצאה קולית מהירה'
                    : '🎙️ הכנסה קולית מהירה'}
              </span>
            </button>
            <p className="muted small">הקלטה ממלאת אוטומטית סכום, קטגוריה ותיאור. נשאר רק לאשר.</p>
            <label className="receipt-upload">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onSelectReceipt(e.target.files?.[0])}
              />
              <span>{type === 'expense' ? 'צלם או בחר תמונה של החשבונית' : 'צלם או בחר תמונה של האסמכתא'}</span>
            </label>
            {receiptPreview ? (
              <img src={receiptPreview} alt="receipt preview" className="receipt-preview" />
            ) : null}
            {receiptFile ? (
              <button
                type="button"
                className={analyzing ? 'btn-secondary btn-loading' : 'btn-secondary'}
                disabled={analyzing}
                aria-busy={analyzing}
                onClick={() => void analyzeReceipt()}
              >
                <span className="btn-label">{analyzing ? 'מנתח עם Gemini…' : 'ניתוח חוזר ידני'}</span>
                {analyzing ? (
                  <span className="btn-spinner thinking-dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
              </button>
            ) : null}
            <p className="muted small">בעת צילום/העלאה מתבצע ניתוח אוטומטי. רק אשר ושמור.</p>
          </section>

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
            <button
              type="submit"
              className={saving ? 'btn-primary btn-loading' : 'btn-primary'}
              disabled={saving}
              aria-busy={saving}
            >
              <span className="btn-label">{saving ? 'שומר…' : 'אישור'}</span>
              {saving ? (
                <span className="btn-spinner thinking-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              ) : null}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
