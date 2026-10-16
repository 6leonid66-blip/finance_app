export const CARD_PROVIDERS = { max: 'MAX', visaCal: 'כאל', isracard: 'ישראכרט', amex: 'אמריקן אקספרס' } as const
export type CardProvider = keyof typeof CARD_PROVIDERS
export type ImportRow = {
  source_key: string
  provider: CardProvider
  card_label: string
  amount: number
  type: 'income' | 'expense'
  occurred_on: string
  description: string
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('מבנה קובץ לא תקין')
  return value as Record<string, unknown>
}

function calendarDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) throw new Error('תאריך עסקה לא תקין')
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error('תאריך עסקה לא תקין')
  // Scrapers return ISO instants in Israel time; slicing UTC can shift the billing date.
  if (value.length === 10) {
    if (parsed.toISOString().slice(0, 10) !== value) throw new Error('תאריך עסקה לא תקין')
    return value
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed)
}

/** Only finalized ILS card charges. Never import bank settlement lines as card purchases. */
export async function normalizeCardImport(input: unknown, provider: CardProvider) {
  if (!Object.hasOwn(CARD_PROVIDERS, provider)) throw new Error('חברת אשראי לא נתמכת')
  const result = record(input)
  if (result.success !== true || !Array.isArray(result.accounts)) throw new Error('נדרש קובץ סנכרון מוצלח עם רשימת חשבונות')
  const rows: ImportRow[] = []
  let pending = 0
  let unidentified = 0
  const seen = new Set<string>()
  for (const rawAccount of result.accounts) {
    const account = record(rawAccount)
    if (typeof account.accountNumber !== 'string' || !account.accountNumber || !Array.isArray(account.txns)) throw new Error('פרטי כרטיס חסרים')
    for (const rawTransaction of account.txns) {
      const txn = record(rawTransaction)
      if (txn.status === 'pending') { pending++; continue }
      if (txn.status !== 'completed') throw new Error('סטטוס עסקה לא מוכר')
      if (!['ILS', '₪', 'NIS'].includes(String(txn.chargedCurrency))) throw new Error('מטבע החיוב חסר או שאינו שקל. הקובץ לא יובא כדי למנוע חישוב שגוי.')
      if (typeof txn.chargedAmount !== 'number' || !Number.isFinite(txn.chargedAmount)) throw new Error('סכום חיוב לא תקין')
      const amount = Math.round(Math.abs(txn.chargedAmount) * 100) / 100
      if (!amount) continue
      if (amount >= 1e10) throw new Error('סכום חיוב גדול מדי')
      // No fuzzy fingerprint: two legitimate identical purchases must not be silently merged.
      if (!['number', 'string'].includes(typeof txn.identifier) || String(txn.identifier).trim() === '') { unidentified++; continue }
      const date = calendarDate(txn.processedDate ?? txn.date)
      const installment = txn.installments == null ? null : record(txn.installments)
      if (installment && (!Number.isInteger(installment.number) || Number(installment.number) < 1)) throw new Error('מספר תשלום לא תקין')
      const identity = JSON.stringify([provider, account.accountNumber, String(txn.identifier), installment?.number ?? null, date])
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
      const source_key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
      if (seen.has(source_key)) continue
      seen.add(source_key)
      rows.push({ source_key, provider, card_label: account.accountNumber.slice(-4), amount,
        type: txn.chargedAmount < 0 ? 'expense' : 'income', occurred_on: date,
        description: String(txn.description ?? 'עסקת אשראי').slice(0, 500) + (installment ? ` · תשלום ${installment.number}/${installment.total}` : ''),
      })
      if (rows.length > 2000) throw new Error('ניתן לקלוט עד 2,000 עסקאות בכל קובץ')
    }
  }
  return { rows, pending, unidentified }
}
