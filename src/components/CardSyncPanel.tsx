import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { CARD_PROVIDERS, normalizeCardImport } from '../lib/bankImport'
import type { CardProvider, ImportRow } from '../lib/bankImport'
import type { FinanceEntry, FinancialAccount } from '../types'
import { EXPENSE_CATEGORIES } from '../constants/categories'
import { formatIls } from '../lib/money'
import { CardConnections } from './CardConnections'

type Item = ImportRow & { id: string }
type Props = { householdId: string; userId: string; accounts: FinancialAccount[]; onRefresh: () => void }

export function CardSyncPanel({ householdId, userId, accounts, onRefresh }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [provider, setProvider] = useState<CardProvider>('max')
  const [accountId, setAccountId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [candidates, setCandidates] = useState<FinanceEntry[]>([])
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [matches, setMatches] = useState<Record<string, string>>({})
  const [matchingReady, setMatchingReady] = useState(false)
  const eligibleAccounts = accounts.filter(a => a.active && (a.is_shared || a.owner_user_id === userId))

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      const { data, error } = await supabase.from('card_import_items').select('*')
        .eq('household_id', householdId).eq('owner_id', userId).eq('status', 'pending').order('occurred_on', { ascending: false }).limit(200)
      if (cancelled) return
      if (error) { setMessage('לא ניתן לטעון את הסנכרון. יש לוודא שהוגדר שירות הסנכרון במסד הנתונים.'); return }
      const rows = (data ?? []) as Item[]
      setItems(rows)
      if (!rows.length) { setCandidates([]); return }
      const dates = rows.map(r => r.occurred_on).sort()
      const { data: transactions, error: matchError } = await supabase.from('transactions').select('*')
        .eq('household_id', householdId).eq('owner_id', userId).eq('planned', false)
        .gte('occurred_on', dates[0].slice(0, 7) + '-01').lte('occurred_on', dates[dates.length - 1]).limit(1000)
      if (!cancelled) {
        setCandidates((transactions ?? []) as FinanceEntry[])
        setMatchingReady(!matchError)
        if (matchError) setMessage('בדיקת עסקאות קיימות נכשלה. יש לרענן לפני אישור הייבוא.')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [householdId, userId, revision])

  async function upload(file: File) {
    if (!supabase) return
    setBusy(true); setMessage('')
    try {
      if (file.size > 5_000_000) throw new Error('הקובץ גדול מדי. הגודל המותר הוא עד 5MB')
      const { rows, pending, unidentified } = await normalizeCardImport(JSON.parse(await file.text()), provider)
      if (rows.length) {
        const { error } = await supabase.from('card_import_items').upsert(rows.map(row => ({ ...row, household_id: householdId, owner_id: userId })),
          { onConflict: 'household_id,owner_id,source_key', ignoreDuplicates: true })
        if (error) throw new Error('שמירת העסקאות נכשלה. בדקו שהסנכרון הוגדר ונסו שוב.')
      }
      setMessage(`נבדקו ${rows.length} עסקאות סופיות. כפילויות סנכרון לא יתווספו. ${pending} עסקאות ממתינות ו־${unidentified} ללא מזהה לא יובאו.`)
      setRevision(r => r + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'הקובץ לא נקלט') }
    finally { setBusy(false) }
  }

  async function review(item: Item, action: 'ignore' | 'import') {
    if (!supabase) return
    setBusy(true); setMessage('')
    try {
      const { error } = await supabase.rpc('review_card_import', {
        p_id: item.id, p_action: action, p_account_id: accountId || null,
        p_category: categories[item.id] ?? (item.type === 'income' ? 'החזר אשראי' : 'אחר'), p_match_id: matches[item.id] || null,
      })
      if (error) throw new Error('הפעולה לא נשמרה. בדקו את החשבון ואת התאמת העסקה ונסו שוב.')
      setItems(current => current.filter(row => row.id !== item.id))
      setRevision(r => r + 1)
      setMessage(action === 'ignore' ? 'העסקה הוסתרה ולא תיובא שוב.' : 'העסקה אושרה והנתונים עודכנו.')
      onRefresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'הפעולה נכשלה') }
    finally { setBusy(false) }
  }

  return <section className="sync-panel">
    <div className="page-intro"><span className="eyebrow">הכסף שלכם, במקום אחד</span><h1>מרכז האשראי</h1><p className="muted">קולטים, בודקים ומאשרים. השליטה נשארת אצלכם.</p></div>
    <CardConnections householdId={householdId} onSynced={() => { setRevision(r => r + 1); onRefresh() }} />
    <div className="card"><h2 className="card-heading">קליטת קובץ סנכרון</h2><p className="muted small">קובץ JSON שהופק ממחבר האשראי. פרטי ההתחברות אינם נדרשים כאן.</p>
      <div className="sync-fields"><label>חברת אשראי<select disabled={busy} value={provider} onChange={e => setProvider(e.target.value as CardProvider)}>{Object.entries(CARD_PROVIDERS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>קובץ עסקאות<input type="file" accept=".json,application/json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = '' }} /></label></div>
    </div>
    {message && <p className="banner-msg" role="status">{message}</p>}
    <div className="card"><div className="card-heading-row"><h2 className="card-heading">ממתינות לאישור</h2><span className="sync-count">{items.length}</span><button className="btn-secondary" disabled={busy} onClick={() => { setMatchingReady(false); setRevision(r => r + 1) }}>רענון</button></div>
      <p className="muted small">לפי מועד החיוב, בשקלים. זיכויים נרשמים כהכנסה. מוצגות עד 200 עסקאות בכל פעם. התאימו הוצאות שכבר הזנתם כדי למנוע ספירה כפולה.</p>
      <label>חשבון לרישום עסקאות חדשות<select value={accountId} disabled={busy} onChange={e => setAccountId(e.target.value)}><option value="">בחרו חשבון</option>{eligibleAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {!items.length && <div className="sync-empty"><span aria-hidden>✓</span><h3>הכול מסודר כאן</h3><p className="muted">עסקאות שייקלטו יופיעו כאן לבדיקה ואישור.</p></div>}
      {items.map(item => {
        const possible = candidates.filter(t => t.type === item.type && Number(t.amount) === Number(item.amount) && t.occurred_on.slice(0, 7) === item.occurred_on.slice(0, 7))
        return <article className="sync-row" key={item.id}><div className="sync-row-title"><div><strong>{item.description}</strong><p className="muted small">{CARD_PROVIDERS[item.provider]} · •••• {item.card_label} · {item.occurred_on}</p></div><strong className={item.type === 'income' ? 'amount-income' : 'amount-expense'}>{item.type === 'income' ? '+' : '−'}{formatIls(item.amount)}</strong></div>
          <div className="sync-fields"><label>קטגוריה<select disabled={busy || !!matches[item.id]} value={categories[item.id] ?? (item.type === 'income' ? 'החזר אשראי' : 'אחר')} onChange={e => setCategories(v => ({ ...v, [item.id]: e.target.value }))}>{(item.type === 'income' ? ['החזר אשראי', 'אחר'] : EXPENSE_CATEGORIES).map(c => <option key={c}>{c}</option>)}</select></label>
          {possible.length > 0 && <label>נמצאו תנועות בסכום זהה<select disabled={busy} value={matches[item.id] ?? ''} onChange={e => setMatches(v => ({ ...v, [item.id]: e.target.value }))}><option value="">זו עסקה חדשה</option>{possible.map(t => <option key={t.id} value={t.id}>{t.occurred_on} · {t.note || t.category}</option>)}</select></label>}</div>
          <div className="sync-actions"><button className="btn-primary" disabled={busy || !matchingReady || (!accountId && !matches[item.id])} onClick={() => void review(item, 'import')}>{matches[item.id] ? 'קישור לתנועה קיימת' : 'אישור והוספה'}</button><button className="btn-secondary" disabled={busy} onClick={() => void review(item, 'ignore')}>דילוג</button></div>
        </article>
      })}
    </div>
  </section>
}
