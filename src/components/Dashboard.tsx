import { useEffect, useMemo, useState } from 'react'
import type { FinanceEntry, FinancialAccount } from '../types'
import { MonthValuePicker } from './MonthValuePicker'

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
  householdCode: string
  onJoinByCode: (code: string) => Promise<{ ok: boolean; message: string }>
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
  householdCode,
  onJoinByCode,
}: DashboardProps) {
  const defaultDismissed =
    typeof window !== 'undefined' ? localStorage.getItem('pwa-install-dismissed') === '1' : false
  const defaultIosHint =
    !defaultDismissed &&
    typeof window !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.matchMedia('(display-mode: standalone)').matches
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null)
  const [showInstallHint, setShowInstallHint] = useState(defaultIosHint)
  const [installHintText, setInstallHintText] = useState(
    defaultIosHint ? 'iPhone: Share → Add to Home Screen כדי להתקין.' : '',
  )
  const [installDismissed, setInstallDismissed] = useState(defaultDismissed)
  const [joinCode, setJoinCode] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinMessage, setJoinMessage] = useState<string | null>(null)

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      if (!installDismissed) {
        setDeferredPrompt(event as InstallPromptEvent)
        setShowInstallHint(true)
      }
    }
    const onInstalled = () => {
      localStorage.setItem('pwa-install-dismissed', '1')
      setDeferredPrompt(null)
      setShowInstallHint(false)
      setInstallHintText('האפליקציה הותקנה בהצלחה.')
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [installDismissed])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setInstallHintText('האפליקציה תותקן כעת.')
    }
    setDeferredPrompt(null)
  }

  const dismissInstall = () => {
    localStorage.setItem('pwa-install-dismissed', '1')
    setInstallDismissed(true)
    setShowInstallHint(false)
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

  const balanceActual = actualIncome - actualExpense
  const balancePlanned = plannedIncome - plannedExpense
  const incomePct = pct(actualIncome, plannedIncome)
  const expensePct = pct(actualExpense, plannedExpense)
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

  return (
    <div className="dashboard">
      <div className="dashboard-top">
        <div>
          <h1 className="dashboard-title">הבית שלנו</h1>
          <p className="dashboard-sub">סיכום חודשי — מתוכנן מול בפועל</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => void onSignOut()}>
          יציאה
        </button>
      </div>

      <label className="month-field">
        <span className="sr-only">חודש</span>
        <MonthValuePicker value={selectedMonth} onChange={onMonthChange} />
      </label>

      {showInstallHint && !installDismissed ? (
        <section className="install-cta card">
          <div>
            <strong>התקן אפליקציה</strong>
            <p className="muted">{installHintText || 'התקנה מהירה למסך הבית באנדרואיד / אייפון.'}</p>
          </div>
          <div className="row-actions">
            {deferredPrompt ? (
              <button type="button" className="btn-primary btn-xs" onClick={() => void handleInstall()}>
                התקן אפליקציה
              </button>
            ) : null}
            <button type="button" className="btn-secondary btn-xs" onClick={dismissInstall}>
              לא עכשיו
            </button>
          </div>
        </section>
      ) : null}

      {loading ? <p className="muted">טוען נתונים…</p> : null}

      <section className="card card-form">
        <h2 className="card-heading">שיתוף בית / חיבור חשבון שני</h2>
        <p className="muted small">קוד הבית שלך: <code>{householdCode}</code></p>
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
        </div>
        {joinMessage ? <p className="inline-status">{joinMessage}</p> : null}
      </section>

      <div className="kpi-grid">
        <article className="kpi-card kpi-income">
          <span className="kpi-label">הכנסות בפועל (תנועות אמיתיות)</span>
          <strong className="kpi-value">{actualIncome.toLocaleString()} ₪</strong>
          <span className="kpi-meta">מתוכנן: {plannedIncome.toLocaleString()} ₪</span>
          <div className="progress-track" aria-hidden>
            <div
              className="progress-fill progress-income"
              style={{ width: `${incomePct ?? 0}%` }}
            />
          </div>
          <small className="kpi-foot">
            {plannedIncome <= 0 ? 'אין תכנון הכנסה' : `${incomePct}% מהתכנון`}
          </small>
        </article>

        <article className="kpi-card kpi-expense">
          <span className="kpi-label">הוצאות בפועל (תנועות אמיתיות)</span>
          <strong className="kpi-value">{actualExpense.toLocaleString()} ₪</strong>
          <span className="kpi-meta">מתוכנן: {plannedExpense.toLocaleString()} ₪</span>
          <div className="progress-track" aria-hidden>
            <div
              className="progress-fill progress-expense"
              style={{ width: `${expensePct ?? 0}%` }}
            />
          </div>
          <small className="kpi-foot">
            {plannedExpense <= 0 ? 'אין תכנון הוצאות' : `${expensePct}% מהתכנון`}
          </small>
        </article>
      </div>

      <div className="balance-cards">
        <div className="balance-card">
          <span>יתרה בפועל</span>
          <strong>{balanceActual.toLocaleString()} ₪</strong>
        </div>
        <div className="balance-card balance-muted">
          <span>יתרה מתוכננת</span>
          <strong>{balancePlanned.toLocaleString()} ₪</strong>
        </div>
      </div>

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
              <small>תכנון בית כולל קבועים: {(plannedIncome - plannedExpense).toLocaleString()} ₪</small>
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
    </div>
  )
}
