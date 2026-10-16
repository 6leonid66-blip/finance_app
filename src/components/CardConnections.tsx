import { useEffect, useEffectEvent, useState } from 'react'
import { cardSyncRequest, syncServiceConfigured } from '../lib/cardSyncApi'
import type { CardConnection, ProviderInfo } from '../lib/cardSyncApi'
import { CARD_PROVIDERS } from '../lib/bankImport'

const fieldLabels: Record<string, string> = { username: 'שם משתמש בחברת האשראי', password: 'סיסמה בחברת האשראי', id: 'תעודת זהות', card6Digits: '6 הספרות האחרונות של הכרטיס' }
const stateLabels: Record<CardConnection['status'], string> = { queued: 'ממתין לסנכרון', syncing: 'מתחברים ומעדכנים…', awaiting_otp: 'נדרש קוד אימות', ready: 'מחובר', attention: 'נדרשת פעולה', paused: 'הסנכרון מושהה' }
const failures: Record<string, string> = { INVALID_PASSWORD: 'חברת האשראי דחתה את פרטי ההתחברות. נתקו וחברו מחדש עם פרטים מעודכנים.', INVALID_OTP: 'חברת האשראי דחתה את הקוד.', CHANGE_PASSWORD: 'יש לעדכן את הסיסמה באתר חברת האשראי ולאחר מכן לחבר מחדש.', ACCOUNT_BLOCKED: 'הגישה נחסמה אצל חברת האשראי. יש לטפל בכך מולה לפני ניסיון נוסף.', OTP_TIMEOUT: 'זמן ההמתנה לקוד הסתיים.', TIMEOUT: 'חברת האשראי לא השלימה את הבקשה בזמן.', MEMBERSHIP_REQUIRED: 'אין עוד הרשאה לבית הזה.', RESTARTED: 'שירות הסנכרון הופעל מחדש. יש להתחיל ניסיון חדש.', SYNC_FAILED: 'הסנכרון לא הושלם. אפשר לנסות שוב; אם התקלה חוזרת יש לבדוק את שירות הסנכרון.' }
const date = (value: number) => new Date(value).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })

export function CardConnections({ householdId, onSynced, request = cardSyncRequest, configured = syncServiceConfigured }: {
  householdId: string; onSynced: () => void; request?: typeof cardSyncRequest; configured?: boolean
}) {
  const [connections, setConnections] = useState<CardConnection[]>([])
  const [providers, setProviders] = useState<ProviderInfo>({})
  const [provider, setProvider] = useState('max')
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [revision, setRevision] = useState(0)
  const notifySynced = useEffectEvent(onSynced)

  useEffect(() => {
    if (!configured) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const successes = new Map<string, number | null>()
    async function poll() {
      let active = false
      try {
        const [rows, available] = await Promise.all([
          request<CardConnection[]>(householdId, '/connections'),
          request<ProviderInfo>(householdId, '/providers'),
        ])
        if (cancelled) return
        for (const row of rows) {
          if (row.lastSuccessAt && successes.get(row.id) !== row.lastSuccessAt) notifySynced()
          successes.set(row.id, row.lastSuccessAt)
        }
        setConnections(rows); setProviders(available); setLoaded(true); setPollError('')
        active = rows.some(r => ['queued', 'syncing', 'awaiting_otp'].includes(r.status))
      } catch (failure) { if (!cancelled) { setLoaded(false); setPollError(failure instanceof Error ? failure.message : 'לא ניתן לטעון חיבורים') } }
      finally { if (!cancelled) timer = setTimeout(() => void poll(), active ? 3000 : 15000) }
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [householdId, revision, request, configured])

  async function connect() {
    setBusy(true); setError('')
    const submitted = credentials
    setCredentials({})
    try {
      await request(householdId, '/connections', 'POST', { provider, credentials: submitted, consent })
      setShowForm(false); setConsent(false); setRevision(r => r + 1)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'החיבור נכשל') }
    finally { setBusy(false) }
  }
  async function action(row: CardConnection, command: 'sync' | 'pause' | 'otp' | 'disconnect') {
    if (command === 'disconnect' && !window.confirm('לנתק את חברת האשראי ולמחוק את פרטי ההתחברות השמורים? העסקאות שכבר נקלטו יישארו.')) return
    setBusy(true); setError('')
    const code = codes[row.id]
    setCodes(current => ({ ...current, [row.id]: '' }))
    try {
      await request(householdId, `/connections/${row.id}${command === 'disconnect' ? '' : '/' + command}`, command === 'disconnect' ? 'DELETE' : 'POST', command === 'disconnect' ? undefined : command === 'otp' ? { code, challenge: row.challenge } : {})
      setRevision(r => r + 1)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'הפעולה נכשלה') }
    finally { setBusy(false) }
  }

  if (!configured) return <section className="card"><h2 className="card-heading">חיבור אוטומטי לכרטיס</h2><p className="muted">שירות החיבור עדיין לא הופעל עבור האפליקציה. לאחר הפעלתו תוכלו להתחבר כאן ולקבל עדכונים אוטומטיים.</p></section>
  return <section className="card connection-manager"><div className="card-heading-row"><h2 className="card-heading">חברות האשראי שלי</h2><button className="btn-primary" disabled={busy || !loaded} onClick={() => { setShowForm(!showForm); setCredentials({}); setConsent(false) }}>חיבור חברת אשראי</button></div>
    <p className="muted small">סנכרון אוטומטי כל 12 שעות. העסקאות מגיעות לבדיקה ואישור לפני הרישום בתקציב.</p>
    {error && <p role="alert" className="banner-msg">{error}</p>}
    {pollError && <p role="alert" className="banner-msg">{pollError}</p>}
    {!loaded && <p role="status" className="muted">ממתינים לחיבור לשירות…</p>}
    {showForm && <form className="connection-form" onSubmit={e => { e.preventDefault(); void connect() }}>
      <label>חברת אשראי<select disabled={busy} value={provider} onChange={e => { setProvider(e.target.value); setCredentials({}) }}>{Object.entries(providers).map(([id, info]) => <option key={id} value={id}>{info.name}</option>)}</select></label>
      <div className="sync-fields">{providers[provider]?.fields.map(field => <label key={field}>{fieldLabels[field] ?? field}<input required disabled={busy} type={field === 'password' ? 'password' : 'text'} autoComplete="off" inputMode={['id', 'card6Digits'].includes(field) ? 'numeric' : 'text'} maxLength={field === 'id' ? 9 : field === 'card6Digits' ? 6 : 200} pattern={field === 'id' ? '[0-9]{9}' : field === 'card6Digits' ? '[0-9]{6}' : undefined} value={credentials[field] ?? ''} onChange={e => setCredentials(current => ({ ...current, [field]: e.target.value }))} /></label>)}</div>
      <label className="connection-consent"><input type="checkbox" required disabled={busy} checked={consent} onChange={e => setConsent(e.target.checked)} /><span>אני מאשר/ת לשמור את פרטי ההתחברות מוצפנים בשירות הסנכרון ולקרוא עסקאות באופן אוטומטי. אפשר להשהות או לנתק בכל עת.</span></label>
      <p className="muted small">יש להזין את פרטי הכניסה לאתר חברת האשראי. אין להזין מספר כרטיס מלא או קוד אבטחה CVV.</p>
      <button className="btn-primary" disabled={busy || !loaded || !consent}>{busy ? 'מחברים…' : 'חיבור וסנכרון ראשון'}</button>
    </form>}
    {loaded && !connections.length && !showForm && <p className="muted">עדיין לא חיברתם חברת אשראי. כל הכרטיסים שבאותה התחברות ייבדקו יחד.</p>}
    {connections.map(row => <article className="connection-row" key={row.id}>
      <div className="sync-row-title"><strong>{CARD_PROVIDERS[row.provider as keyof typeof CARD_PROVIDERS] ?? row.provider}</strong><span className={`connection-status state-${row.status}`}>{stateLabels[row.status]}</span></div>
      <p className="muted small">{row.lastSuccessAt ? `סנכרון אחרון: ${date(row.lastSuccessAt)}` : 'טרם הושלם סנכרון'}{row.nextRunAt && row.status === 'ready' ? ` · הבא: ${date(row.nextRunAt)}` : ''}</p>
      {row.lastSuccessAt && <p className="muted small">נבדקו {row.checked ?? 0} עסקאות סופיות. {row.pending ?? 0} ממתינות ו־{row.unidentified ?? 0} ללא מזהה לא נקלטו.</p>}
      {row.error && <p role="status">{failures[row.error] ?? failures.SYNC_FAILED}</p>}
      {row.status === 'awaiting_otp' && <form className="otp-form" onSubmit={e => { e.preventDefault(); void action(row, 'otp') }}>
        <label>הקוד שהתקבל מחברת האשראי<input autoComplete="one-time-code" inputMode="numeric" required pattern="[0-9]{4,10}" minLength={4} maxLength={10} disabled={busy} value={codes[row.id] ?? ''} onChange={e => setCodes(current => ({ ...current, [row.id]: e.target.value }))} /></label>
        <p className="muted small">הקוד משמש לבקשה הזו בלבד ואינו נשמר. {row.otpExpiresAt ? `ניתן לשלוח עד ${date(row.otpExpiresAt)}.` : ''}</p>
        <button className="btn-primary" disabled={busy}>אימות והמשך</button>
      </form>}
      <div className="sync-actions"><button className="btn-secondary" disabled={busy || ['syncing', 'awaiting_otp', 'queued'].includes(row.status)} onClick={() => void action(row, 'sync')}>{row.status === 'paused' ? 'חידוש הסנכרון' : 'סנכרון עכשיו'}</button>
        {row.enabled && <button className="btn-secondary" disabled={busy} onClick={() => void action(row, 'pause')}>השהיה</button>}
        <button className="link-btn" disabled={busy} onClick={() => void action(row, 'disconnect')}>ניתוק ומחיקת פרטי חיבור</button></div>
    </article>)}
  </section>
}
