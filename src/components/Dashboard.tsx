import { useEffect, useMemo, useState } from 'react'
import type { FinanceEntry, FinancialAccount, UserProfileView } from '../types'
import { MonthValuePicker } from './MonthValuePicker'
import { generateHouseholdAdviceWithGemini } from '../lib/geminiReceipt'

type DashboardProps = {
  selectedMonth: string
  onMonthChange: (value: string) => void
  actualIncome: number
  actualExpense: number
  plannedIncome: number
  plannedExpense: number
  entries: FinanceEntry[]
  historyEntries: Array<{ type: 'income' | 'expense'; amount: number; occurred_on: string; planned: boolean }>
  accounts: FinancialAccount[]
  selectedAccountId: string
  onSelectAccount: (id: string) => void
  loading: boolean
  onSignOut: () => void
  profile: UserProfileView
  onSaveProfile: (next: { full_name: string; avatar_url: string }) => Promise<{ ok: boolean; message: string }>
  householdCode: string
  onJoinByCode: (code: string) => Promise<{ ok: boolean; message: string }>
  scopeMode: 'personal' | 'shared'
  onScopeModeChange: (scope: 'personal' | 'shared') => void
}

function pct(actual: number, planned: number) {
  if (planned <= 0) return null
  return Math.min(100, Math.round((actual / planned) * 100))
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function Dashboard({
  selectedMonth,
  onMonthChange,
  actualIncome,
  actualExpense,
  plannedIncome,
  plannedExpense,
  entries,
  historyEntries,
  accounts,
  selectedAccountId,
  onSelectAccount,
  loading,
  onSignOut,
  profile,
  onSaveProfile,
  householdCode,
  onJoinByCode,
  scopeMode,
  onScopeModeChange,
}: DashboardProps) {
  const defaultIosHint =
    typeof window !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.matchMedia('(display-mode: standalone)').matches
  const isStandaloneDefault =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(isStandaloneDefault)
  const [installHintText, setInstallHintText] = useState(
    defaultIosHint ? 'iPhone: Share → Add to Home Screen כדי להתקין.' : '',
  )
  const [joinCode, setJoinCode] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinMessage, setJoinMessage] = useState<string | null>(null)
  const [showHouseholdTools, setShowHouseholdTools] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [profileName, setProfileName] = useState(profile.full_name ?? '')
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(profile.avatar_url ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [advisorLoading, setAdvisorLoading] = useState(false)
  const [advisorText, setAdvisorText] = useState<string | null>(null)

  const profileInitials = useMemo(() => {
    const source = (profile.full_name?.trim() || profile.email?.trim() || 'U').replace(/\s+/g, ' ')
    const pieces = source.split(' ')
    if (pieces.length >= 2) return `${pieces[0][0] ?? ''}${pieces[1][0] ?? ''}`.toUpperCase()
    return source.slice(0, 2).toUpperCase()
  }, [profile.full_name, profile.email])

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as InstallPromptEvent)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      setIsStandalone(true)
      setInstallHintText('האפליקציה הותקנה בהצלחה.')
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setInstallHintText('האפליקציה תותקן כעת.')
      }
      setDeferredPrompt(null)
      return
    }
    if (defaultIosHint) {
      setInstallHintText('iPhone: פתח Safari → Share → Add to Home Screen')
      return
    }
    if (typeof window !== 'undefined' && window.location.protocol !== 'https:') {
      setInstallHintText('התקנת PWA באנדרואיד דורשת HTTPS. פתח דרך הדומיין המאובטח (Vercel).')
      return
    }
    setInstallHintText('Android/Chrome: פתח תפריט ⋮ ואז Install app / Add to Home screen')
  }

  const copyHouseholdCode = async () => {
    try {
      await navigator.clipboard.writeText(householdCode)
      setJoinMessage('קוד הבית הועתק')
    } catch {
      setJoinMessage('לא הצלחתי להעתיק. אפשר להעתיק ידנית.')
    }
  }

  const submitJoinCode = async () => {
    const code = joinCode.trim()
    if (!code) {
      setJoinMessage('יש להזין קוד בית')
      return
    }
    setJoinLoading(true)
    const result = await onJoinByCode(code)
    setJoinMessage(result.message)
    setJoinLoading(false)
    if (result.ok) setJoinCode('')
  }

  const submitProfile = async () => {
    setProfileSaving(true)
    const result = await onSaveProfile({
      full_name: profileName,
      avatar_url: profileAvatarUrl,
    })
    setProfileMessage(result.message)
    setProfileSaving(false)
    if (result.ok) {
      setTimeout(() => setShowProfile(false), 650)
    }
  }

  const balanceActual = actualIncome - actualExpense
  const balancePlanned = plannedIncome - plannedExpense
  const incomePct = pct(actualIncome, plannedIncome)
  const expensePct = pct(actualExpense, plannedExpense)
  const forecastSummary = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number)
    const prevDate = new Date(year, month - 2, 1)
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
    const prevRows = historyEntries.filter((entry) => !entry.planned && entry.occurred_on.startsWith(prevKey))
    const prevIncome = prevRows.filter((e) => e.type === 'income').reduce((sum, e) => sum + e.amount, 0)
    const prevExpense = prevRows.filter((e) => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0)
    return {
      prevIncome,
      prevExpense,
      incomeDelta: plannedIncome - prevIncome,
      expenseDelta: plannedExpense - prevExpense,
    }
  }, [historyEntries, plannedExpense, plannedIncome, selectedMonth])
  const accountSummaries = useMemo(
    () =>
      accounts.map((account) => {
        const list = entries.filter((entry) => entry.account_id === account.id && !entry.planned)
        const income = list.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0)
        const expense = list
          .filter((entry) => entry.type === 'expense')
          .reduce((sum, entry) => sum + entry.amount, 0)
        return {
          ...account,
          income,
          expense,
          balance: income - expense,
          kind: account.is_shared ? 'משותף' : account.owner_user_id ? 'אישי' : 'חשבון נוסף',
        }
      }),
    [accounts, entries],
  )
  const expenseDistribution = useMemo(() => {
    const expenses = entries.filter((entry) => entry.type === 'expense' && !entry.planned)
    const byCategory = new Map<string, number>()
    expenses.forEach((entry) => {
      byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.amount)
    })
    const total = expenses.reduce((sum, entry) => sum + entry.amount, 0)
    const rows = Array.from(byCategory.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        pctExpense: total > 0 ? (amount / total) * 100 : 0,
        pctIncome: actualIncome > 0 ? (amount / actualIncome) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
    return { rows, total }
  }, [entries, actualIncome])
  const monthlyTrend = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number)
    const selectedIndex = year * 12 + (month - 1)
    const grouped = new Map<string, { income: number; expense: number }>()
    historyEntries.forEach((entry) => {
      if (entry.planned) return
      const key = entry.occurred_on.slice(0, 7)
      const [y, m] = key.split('-').map(Number)
      const idx = y * 12 + (m - 1)
      if (idx > selectedIndex || idx < selectedIndex - 11) return
      const row = grouped.get(key) ?? { income: 0, expense: 0 }
      if (entry.type === 'income') row.income += entry.amount
      if (entry.type === 'expense') row.expense += entry.amount
      grouped.set(key, row)
    })
    const keys = Array.from(grouped.keys()).sort()
    if (!keys.length) keys.push(selectedMonth)
    return keys.map((key) => {
      const [y, m] = key.split('-').map(Number)
      const d = new Date(y, m - 1, 1)
      const row = grouped.get(key) ?? { income: 0, expense: 0 }
      return {
        key,
        label: d.toLocaleDateString('he-IL', { month: 'short' }),
        income: row.income,
        expense: row.expense,
        net: row.income - row.expense,
      }
    })
  }, [historyEntries, selectedMonth])

  const cumulativeTotals = useMemo(() => {
    const totalIncome = monthlyTrend.reduce((sum, m) => sum + m.income, 0)
    const totalExpense = monthlyTrend.reduce((sum, m) => sum + m.expense, 0)
    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
    }
  }, [monthlyTrend])

  const chartMax = useMemo(() => {
    const maxValue = Math.max(
      1,
      ...monthlyTrend.map((m) => Math.max(m.income, m.expense, Math.abs(m.net))),
    )
    return maxValue
  }, [monthlyTrend])
  const insights = useMemo(() => {
    const monthKey = selectedMonth
    const [year, month] = monthKey.split('-').map(Number)
    const prevDate = new Date(year, month - 2, 1)
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
    const currentRows = historyEntries.filter((entry) => !entry.planned && entry.occurred_on.startsWith(monthKey))
    const prevRows = historyEntries.filter((entry) => !entry.planned && entry.occurred_on.startsWith(prevKey))
    const currentIncome = currentRows.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0)
    const currentExpense = currentRows.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0)
    const prevExpense = prevRows.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0)
    const topCategory = expenseDistribution.rows[0]
    const rows: string[] = []
    if (topCategory) {
      rows.push(`הוצאה מובילה: ${topCategory.category} (${topCategory.amount.toLocaleString()} ₪)`)
    }
    if (prevExpense > 0) {
      const change = ((currentExpense - prevExpense) / prevExpense) * 100
      rows.push(`שינוי הוצאות מול חודש קודם: ${change >= 0 ? '+' : ''}${change.toFixed(0)}%`)
    }
    if (currentIncome > 0) {
      const savingRate = ((currentIncome - currentExpense) / currentIncome) * 100
      rows.push(`שיעור חיסכון חודשי משוער: ${savingRate.toFixed(0)}%`)
    }
    if (!rows.length) rows.push('אין מספיק נתונים לניתוח החודש.')
    return rows
  }, [historyEntries, selectedMonth, expenseDistribution.rows])
  const pieGradient = useMemo(() => {
    if (!expenseDistribution.rows.length || expenseDistribution.total <= 0) {
      return 'conic-gradient(#1f2937 0deg 360deg)'
    }
    const palette = ['#38bdf8', '#34d399', '#f59e0b', '#f97316', '#a78bfa', '#f472b6', '#fb7185', '#22d3ee']
    let start = 0
    const parts = expenseDistribution.rows.map((row, index) => {
      const span = (row.amount / expenseDistribution.total) * 360
      const color = palette[index % palette.length]
      const end = start + span
      const part = `${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`
      start = end
      return part
    })
    return `conic-gradient(${parts.join(', ')})`
  }, [expenseDistribution])

  const runAdvisor = async () => {
    const summary = [
      `actualIncome=${actualIncome}`,
      `actualExpense=${actualExpense}`,
      `forecastIncome=${plannedIncome}`,
      `forecastExpense=${plannedExpense}`,
      `topCategory=${expenseDistribution.rows[0]?.category ?? 'none'}`,
      `topCategoryAmount=${expenseDistribution.rows[0]?.amount ?? 0}`,
      `insights=${insights.join(' | ')}`,
    ].join('\n')
    setAdvisorLoading(true)
    try {
      const text = await generateHouseholdAdviceWithGemini({
        month: selectedMonth,
        summary,
      })
      setAdvisorText(text)
    } catch (error) {
      const fallback = [
        'המלצה 1: בדוק את הקטגוריה המובילה והגדר לה תקרת הוצאה חודשית.',
        'המלצה 2: אם ההוצאות גבוהות מהתחזית, צמצם 5%-10% בקטגוריות הלא חיוניות.',
        'המלצה 3: שמור כרית ביטחון של לפחות 10% מההכנסה החודשית.',
      ]
      const msg = error instanceof Error ? error.message : 'שגיאת AI'
      setAdvisorText(`${fallback.join('\n')}\n\nהערה: ${msg}`)
    } finally {
      setAdvisorLoading(false)
    }
  }

  return (
    <div className="dashboard">
      <section className="dashboard-hero card">
        <div className="dashboard-top">
          <div>
            <h1 className="dashboard-title">הבית שלנו</h1>
            <p className="dashboard-sub">סיכום חודשי — תחזית חכמה מול בפועל</p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="profile-chip"
              onClick={() => {
                setProfileName(profile.full_name ?? '')
                setProfileAvatarUrl(profile.avatar_url ?? '')
                setProfileMessage(null)
                setShowProfile(true)
              }}
            >
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="profile-chip-avatar" />
              ) : (
                <span className="profile-chip-initials">{profileInitials}</span>
              )}
              <span>{profile.full_name?.trim() || 'הפרופיל שלי'}</span>
            </button>
            <button type="button" className="btn-secondary btn-xs" onClick={() => setShowHouseholdTools(true)}>
              שיתוף בית
            </button>
            <button type="button" className="btn-ghost" onClick={() => void onSignOut()}>
              יציאה
            </button>
          </div>
        </div>
      </section>

      <label className="month-field month-field-dashboard">
        <span className="sr-only">חודש</span>
        <MonthValuePicker value={selectedMonth} onChange={onMonthChange} className="dashboard-month-picker" />
      </label>
      <div className="scope-switch card">
        <strong>תצוגה</strong>
        <div className="segmented">
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
      </div>

      <section className="install-cta card">
        <div>
          <strong>התקן אפליקציה לטלפון</strong>
          <p className="muted">
            {isStandalone
              ? 'האפליקציה כבר מותקנת במכשיר זה.'
              : installHintText || 'התקנה מהירה למסך הבית באנדרואיד / אייפון.'}
          </p>
          {!deferredPrompt && !isStandalone ? (
            <p className="muted small">אם אין חלון התקנה: Android/Chrome → תפריט ⋮ → Install app.</p>
          ) : null}
          {defaultIosHint && !isStandalone ? (
            <p className="muted small">iPhone/Safari → Share → Add to Home Screen.</p>
          ) : null}
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="btn-primary btn-xs install-btn"
            onClick={() => void handleInstall()}
            disabled={isStandalone}
          >
            {isStandalone ? 'מותקן' : 'הורד אפליקציה'}
          </button>
        </div>
      </section>

      {loading ? <p className="muted">טוען נתונים…</p> : null}

      <div className="kpi-grid">
        <article className="kpi-card kpi-income">
          <span className="kpi-label">הכנסות בפועל (תנועות אמיתיות)</span>
          <strong className="kpi-value">{actualIncome.toLocaleString()} ₪</strong>
          <span className="kpi-meta">תחזית חכמה: {plannedIncome.toLocaleString()} ₪</span>
          <div className="progress-track" aria-hidden>
            <div
              className="progress-fill progress-income"
              style={{ width: `${incomePct ?? 0}%` }}
            />
          </div>
          <small className="kpi-foot">
            {plannedIncome <= 0 ? 'אין מספיק נתונים לתחזית הכנסה' : `${incomePct}% מהתחזית`}
          </small>
        </article>

        <article className="kpi-card kpi-expense">
          <span className="kpi-label">הוצאות בפועל (תנועות אמיתיות)</span>
          <strong className="kpi-value">{actualExpense.toLocaleString()} ₪</strong>
          <span className="kpi-meta">תחזית חכמה: {plannedExpense.toLocaleString()} ₪</span>
          <div className="progress-track" aria-hidden>
            <div
              className="progress-fill progress-expense"
              style={{ width: `${expensePct ?? 0}%` }}
            />
          </div>
          <small className="kpi-foot">
            {plannedExpense <= 0 ? 'אין מספיק נתונים לתחזית הוצאות' : `${expensePct}% מהתחזית`}
          </small>
        </article>
      </div>

      <div className="balance-cards">
        <div className="balance-card">
          <span>יתרה בפועל</span>
          <strong>{balanceActual.toLocaleString()} ₪</strong>
        </div>
        <div className="balance-card balance-muted">
          <span>יתרת תחזית חכמה</span>
          <strong>{balancePlanned.toLocaleString()} ₪</strong>
        </div>
      </div>
      <section className="card">
        <h2 className="card-heading">תכנון חכם אוטומטי</h2>
        <div className="insights-list">
          <p className="muted">
            תחזית הכנסה לחודש: {plannedIncome.toLocaleString()} ₪ ({forecastSummary.incomeDelta >= 0 ? '+' : ''}
            {forecastSummary.incomeDelta.toLocaleString()} מול חודש קודם)
          </p>
          <p className="muted">
            תחזית הוצאה לחודש: {plannedExpense.toLocaleString()} ₪ ({forecastSummary.expenseDelta >= 0 ? '+' : ''}
            {forecastSummary.expenseDelta.toLocaleString()} מול חודש קודם)
          </p>
          <p className="muted">
            בסיס התחזית: הרגלי החודשים האחרונים + החודש הקודם, בלי הזנה ידנית של תכנון.
          </p>
        </div>
      </section>
      <section className="card expense-distribution">
        <h2 className="card-heading">חלוקת הוצאות לפי קטגוריה</h2>
        <div className="expense-pie-wrap">
          <div className="expense-pie" style={{ background: pieGradient }} aria-label="חלוקת הוצאות" />
          <div className="expense-legend">
            {expenseDistribution.rows.slice(0, 8).map((row) => (
              <div key={row.category} className="expense-legend-row">
                <strong>{row.category}</strong>
                <span>{row.amount.toLocaleString()} ₪</span>
                <small>
                  {row.pctExpense.toFixed(0)}% מההוצאות · {row.pctIncome.toFixed(0)}% מההכנסות
                </small>
              </div>
            ))}
            {!expenseDistribution.rows.length ? <p className="muted">אין הוצאות בפועל לחודש זה.</p> : null}
          </div>
        </div>
      </section>
      <section className="card">
        <h2 className="card-heading">תובנות חכמות לחודש</h2>
        <div className="insights-list">
          {insights.map((insight) => (
            <p key={insight} className="muted">
              {insight}
            </p>
          ))}
        </div>
        <div className="row-actions" style={{ marginTop: 8 }}>
          <button type="button" className="btn-primary btn-xs" onClick={() => void runAdvisor()} disabled={advisorLoading}>
            {advisorLoading ? 'מנתח נתונים…' : 'יועץ AI — המלצות לחיסכון'}
          </button>
        </div>
        {advisorText ? <pre className="advisor-output">{advisorText}</pre> : null}
      </section>

      <section className="trend-section card">
        <h2 className="card-heading">מצטבר 12 חודשים</h2>
        <div className="kpi-grid">
          <article className="kpi-card">
            <span className="kpi-label">סך הכנסות בפועל מצטבר</span>
            <strong className="kpi-value">{cumulativeTotals.totalIncome.toLocaleString()} ₪</strong>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">סך הוצאות בפועל מצטבר</span>
            <strong className="kpi-value">{cumulativeTotals.totalExpense.toLocaleString()} ₪</strong>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">יתרה מצטברת</span>
            <strong className="kpi-value">{cumulativeTotals.balance.toLocaleString()} ₪</strong>
          </article>
        </div>

        <div className="trend-legend">
          <span>הכנסות</span>
          <span>הוצאות</span>
          <span>נטו</span>
        </div>
        <div className="mini-trend-chart" role="img" aria-label="מגמת 12 חודשים מינימליסטית">
          {monthlyTrend.map((month) => (
            <div
              key={month.key}
              className="mini-trend-col"
              title={`הכנסות ${month.income.toLocaleString()} | הוצאות ${month.expense.toLocaleString()} | נטו ${month.net.toLocaleString()} ₪`}
            >
              <div className="mini-trend-bars">
                <div
                  className="mini-trend-bar mini-trend-income"
                  style={{ height: `${Math.max(6, (month.income / chartMax) * 100)}%` }}
                />
                <div
                  className="mini-trend-bar mini-trend-expense"
                  style={{ height: `${Math.max(6, (month.expense / chartMax) * 100)}%` }}
                />
              </div>
              <span className={month.net >= 0 ? 'mini-net mini-net-plus' : 'mini-net mini-net-minus'}>●</span>
              <span className="mini-trend-label">{month.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="accounts-section">
        <div className="accounts-head">
          <h2 className="card-heading">חלוקה לפי חשבונות</h2>
          <select
            value={selectedAccountId}
            onChange={(event) => onSelectAccount(event.target.value)}
            className="account-select"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <div className="account-grid">
          {accountSummaries.map((account) => (
            <article key={account.id} className="account-card">
              <div className="account-title-row">
                <strong>{account.name}</strong>
                <span className="account-kind">{account.kind}</span>
              </div>
              <small>הכנסות: {account.income.toLocaleString()} ₪</small>
              <small>הוצאות: {account.expense.toLocaleString()} ₪</small>
              <small>תחזית בית חכמה: {(plannedIncome - plannedExpense).toLocaleString()} ₪</small>
              <strong className="account-balance">מאזן: {account.balance.toLocaleString()} ₪</strong>
            </article>
          ))}
          {accountSummaries.length < 2 ? (
            <article className="account-card account-card-placeholder">
              <strong>חשבון נוסף</strong>
              <small>כשיצורף משתמש נוסף, החשבון שלו יופיע כאן אוטומטית.</small>
            </article>
          ) : null}
        </div>
      </section>
      {showProfile ? (
        <div className="modal-backdrop" onClick={() => setShowProfile(false)}>
          <article className="card card-form modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-heading">הפרופיל שלי</h2>
            <div className="profile-modal-preview">
              {profileAvatarUrl.trim() ? (
                <img src={profileAvatarUrl.trim()} alt="avatar preview" className="profile-modal-avatar" />
              ) : (
                <span className="profile-chip-initials profile-modal-initials">{profileInitials}</span>
              )}
              <div>
                <strong>{profileName.trim() || 'ללא שם'}</strong>
                <p className="muted small">{profile.email || ''}</p>
              </div>
            </div>
            <label className="stack" style={{ marginTop: 8 }}>
              <span>שם תצוגה</span>
              <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="למשל: לאוניד" />
            </label>
            <label className="stack" style={{ marginTop: 8 }}>
              <span>קישור לתמונת פרופיל</span>
              <input
                type="url"
                value={profileAvatarUrl}
                onChange={(e) => setProfileAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="ltr-input"
              />
            </label>
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn-primary btn-xs" disabled={profileSaving} onClick={() => void submitProfile()}>
                {profileSaving ? 'שומר…' : 'שמור פרופיל'}
              </button>
              <button type="button" className="btn-secondary btn-xs" onClick={() => setShowProfile(false)}>
                סגור
              </button>
            </div>
            {profileMessage ? <p className="inline-status">{profileMessage}</p> : null}
          </article>
        </div>
      ) : null}
      {showHouseholdTools ? (
        <div className="modal-backdrop" onClick={() => setShowHouseholdTools(false)}>
          <article className="card card-form modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-heading">שיתוף בית / חיבור חשבון שני</h2>
            <p className="muted small">
              קוד הבית שלך: <code>{householdCode}</code>
            </p>
            <div className="row-actions">
              <button type="button" className="btn-secondary btn-xs" onClick={() => void copyHouseholdCode()}>
                העתק קוד
              </button>
            </div>
            <label className="stack" style={{ marginTop: 8 }}>
              <span>הצטרפות לבית קיים לפי קוד</span>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="הדבק כאן קוד בית"
              />
            </label>
            <div className="row-actions">
              <button type="button" className="btn-primary btn-xs" disabled={joinLoading} onClick={() => void submitJoinCode()}>
                {joinLoading ? 'מחבר…' : 'חבר לחשבון המשפחתי'}
              </button>
              <button type="button" className="btn-secondary btn-xs" onClick={() => setShowHouseholdTools(false)}>
                סגור
              </button>
            </div>
            {joinMessage ? <p className="inline-status">{joinMessage}</p> : null}
          </article>
        </div>
      ) : null}
    </div>
  )
}
