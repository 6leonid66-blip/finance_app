import { supabase } from '../supabase'

export type CardConnection = {
  id: string
  provider: string
  status: 'queued' | 'syncing' | 'awaiting_otp' | 'ready' | 'attention' | 'paused'
  enabled: boolean
  lastSuccessAt: number | null
  nextRunAt: number | null
  error: string | null
  challenge: string | null
  otpExpiresAt: number | null
  checked?: number
  pending?: number
  unidentified?: number
}
export type ProviderInfo = Record<string, { name: string; fields: string[] }>
export const syncServiceConfigured = Boolean(import.meta.env.VITE_CARD_SYNC_URL)
const messages: Record<string, string> = {
  AUTH_REQUIRED: 'ההתחברות פגה. יש להתחבר לאפליקציה מחדש.',
  ORIGIN_DENIED: 'כתובת האפליקציה אינה מורשית בשירות הסנכרון.',
  MEMBERSHIP_REQUIRED: 'לא נמצאה הרשאה לבית הזה.',
  INVALID_INPUT: 'בדקו את פרטי ההתחברות. תעודת זהות צריכה להכיל 9 ספרות.',
  CONSENT_REQUIRED: 'נדרשת הסכמה לשמירת פרטי ההתחברות ולסנכרון.',
  ALREADY_CONNECTED: 'החברה הזו כבר מחוברת. לעדכון פרטים יש לנתק ולחבר מחדש.',
  OTP_EXPIRED: 'הקוד או בקשת האימות פגו. הפעילו סנכרון מחדש לקבלת בקשה חדשה.',
  INVALID_OTP: 'קוד האימות אינו תקין.',
  RATE_LIMIT: 'בוצעו יותר מדי פעולות. המתינו דקה ונסו שוב.',
  COOLDOWN: 'יש להמתין דקה בין ניסיונות התחברות.',
  ALREADY_RUNNING: 'הסנכרון כבר פועל.',
  CAPACITY: 'שירות הסנכרון מלא כרגע. נסו שוב מאוחר יותר.',
  NOT_FOUND: 'החיבור לא נמצא. רעננו את המסך.',
}
export async function cardSyncRequest<T>(household: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const base = new URL(import.meta.env.VITE_CARD_SYNC_URL)
  const local = ['localhost', '127.0.0.1'].includes(base.hostname) && window.location.protocol === 'http:'
  if (base.protocol !== 'https:' && !local) throw new Error('נדרש חיבור מוצפן לשירות הסנכרון.')
  const url = new URL(path, base)
  url.searchParams.set('household', household)
  const { data } = await supabase!.auth.getSession()
  if (!data.session) throw new Error(messages.AUTH_REQUIRED)
  try {
    const response = await fetch(url, { method,
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000), credentials: 'omit',
    })
    const result = await response.json()
    if (!response.ok) throw new Error(messages[result.error] ?? 'שירות הסנכרון לא השלים את הפעולה. נסו שוב.')
    return result as T
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))) throw new Error('שירות הסנכרון אינו זמין כרגע. הפרטים לא נשמרו בדפדפן. נסו שוב מאוחר יותר.', { cause: error })
    throw error
  }
}
