import { useEffect, useMemo, useState } from 'react'
import type { FinanceEntry, FinancialAccount, HouseholdMemberBrief, UserProfileView } from '../types'
import { MonthValuePicker } from './MonthValuePicker'
import { generateHouseholdAdviceWithGemini } from '../lib/geminiReceipt'
import { colorForCategory } from '../lib/categoryColors'
import { householdAccountPickLabel } from '../lib/accountPickLabel'
import { supabase } from '../supabase'
import { householdMemberUsernameLabel, usernameFromEmail } from '../lib/displayUser'

const ILS_FORMATTER = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 })

function formatIls(amount: number): string {
  return `${ILS_FORMATTER.format(Math.round(amount))} ₪`
}

function formatPctOneDecimal(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%'
  if (pct < 0.1) return '<0.1%'
  return `${pct.toFixed(1)}%`
}

type DashboardProps = {
  selectedMonth: string
  onMonthChange: (value: string) => void
  actualIncome: number
  actualExpense: number
  plannedIncome: number
  plannedExpense: number
  entries: FinanceEntry[]
  historyEntries: Array<{ type: 'income' | 'expense'; amount: number; occurred_on: string; planned: boolean }>
  /** כל החשבונות בבית (למתג בחירה). בתצוגה אישית: חשבונות שלי + משותפים (לפי תנועות שאני רשמת בפיד). */
  accounts: FinancialAccount[]
  householdId: string
  householdMembers: HouseholdMemberBrief[]
  selectedAccountId: string
  onSelectAccount: (id: string) => void
  loading: boolean
  onSignOut: () => void
  currentUserId: string
  profile: UserProfileView
  onSaveProfile: (next: { full_name: string; avatar_url: string; avatar_path: string }) => Promise<{ ok: boolean; message: string }>
  onUploadProfilePhoto: (
    file: File,
  ) => Promise<{ ok: boolean; message: string; avatar_path?: string; avatar_url?: string }>
  /** After הצטרפות לבית אחר — טעינה מחדש של בית וחשבונות. */
  onHouseholdJoined: () => void
  scopeMode: 'personal' | 'shared'
  onScopeModeChange: (scope: 'personal' | 'shared') => void
  householdName: string
  onRenameHousehold: (name: string) => Promise<{ ok: boolean; message: string }>
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
  householdId,
  householdMembers,
  selectedAccountId,
  onSelectAccount,
  loading,
  onSignOut,
  currentUserId,
  profile,
  onSaveProfile,
  onUploadProfilePhoto,
  onHouseholdJoined,
  scopeMode,
  onScopeModeChange,
  householdName,
  onRenameHousehold,
}: DashboardProps) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIos = /iphone|ipad|ipod/i.test(ua)
  const isAndroid = /android/i.test(ua)
  const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios|edg/i.test(ua)
  const isFirefox = /firefox|fxios/i.test(ua)
  const installPlatform: 'ios-safari' | 'ios-other' | 'android-chrome' | 'android-firefox' | 'desktop' | 'unknown' =
    isIos && isSafari
      ? 'ios-safari'
      : isIos
        ? 'ios-other'
        : isAndroid && isFirefox
          ? 'android-firefox'
          : isAndroid
            ? 'android-chrome'
            : typeof window !== 'undefined'
              ? 'desktop'
              : 'unknown'
  const isStandaloneDefault =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(isStandaloneDefault)
  const [installHintText, setInstallHintText] = useState<string>('')
  const [installDiagnostic, setInstallDiagnostic] = useState<string>('')
  const [showProfile, setShowProfile] = useState(false)
  const [profileName, setProfileName] = useState(profile.full_name ?? '')
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(profile.avatar_url ?? '')
  const [profileAvatarPath, setProfileAvatarPath] = useState(profile.avatar_path ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [advisorLoading, setAdvisorLoading] = useState(false)
  const [advisorText, setAdvisorText] = useState<string | null>(null)
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinMessage, setJoinMessage] = useState<string | null>(null)
  const [copyJoinHint, setCopyJoinHint] = useState<string | null>(null)
  const [familyNameDraft, setFamilyNameDraft] = useState(householdName)
  const [familyNameSaving, setFamilyNameSaving] = useState(false)
  const [familyNameMessage, setFamilyNameMessage] = useState<string | null>(null)

  const profileInitials = useMemo(() => {
    const source = (profile.full_name?.trim() || profile.email?.trim() || 'U').replace(/\s+/g, ' ')
    const pieces = source.split(' ')
    if (pieces.length >= 2) return `${pieces[0][0] ?? ''}${pieces[1][0] ?? ''}`.toUpperCase()
    return source.slice(0, 2).toUpperCase()
  }, [profile.full_name, profile.email])

  const familyMembers = useMemo(() => {
    if (householdMembers.length > 0) {
      return householdMembers.map((m) => ({
        id: m.userId,
        name:
          m.userId === currentUserId
            ? usernameFromEmail(profile.email) || householdMemberUsernameLabel(profile.email, currentUserId, 'אני')
            : m.displayName,
        avatar_url: m.userId === currentUserId ? (profile.avatar_url ?? m.avatarUrl) : m.avatarUrl,
      }))
    }

    const members = new Map<string, { name: string; avatar_url: string | null }>()
    entries.forEach((entry) => {
      if (!entry.owner_id) return
      if (!members.has(entry.owner_id)) {
        members.set(entry.owner_id, {
          name:
            usernameFromEmail(entry.owner_email) ||
            householdMemberUsernameLabel(entry.owner_email, entry.owner_id),
          avatar_url: entry.owner_avatar_url ?? null,
        })
      }
    })
    if (!members.has(currentUserId)) {
      members.set(currentUserId, {
        name:
          usernameFromEmail(profile.email) ||
          householdMemberUsernameLabel(profile.email, currentUserId, 'אני'),
        avatar_url: profile.avatar_url ?? null,
      })
    }
    return Array.from(members.entries()).map(([id, value]) => ({ id, ...value }))
  }, [householdMembers, entries, currentUserId, profile.email, profile.avatar_url])

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

  const platformInstructions = (() => {
    switch (installPlatform) {
      case 'ios-safari':
        return 'iPhone/iPad — Safari: לחץ על כפתור השיתוף (⬆) → "Add to Home Screen" (הוסף למסך הבית).'
      case 'ios-other':
        return 'באייפון: יש לפתוח את האפליקציה בדפדפן Safari (לא Chrome) ואז לחץ על השיתוף → "Add to Home Screen".'
      case 'android-chrome':
        return 'Android — Chrome: פתח את תפריט שלוש הנקודות (⋮) בפינה הימנית העליונה → "Install app" / "התקן אפליקציה" / "Add to Home screen".'
      case 'android-firefox':
        return 'Android — Firefox: תפריט ⋮ → "Install" או "Add to Home screen".'
      case 'desktop':
        return 'דסקטופ Chrome/Edge: לחץ על אייקון ההתקנה בסרגל הכתובת (משמאל לכוכבית), או תפריט ⋮ → "Install Finance Family App".'
      default:
        return 'פתח את האפליקציה בדפדפן עדכני (Chrome / Safari) דרך כתובת ה‑HTTPS ואז השתמש בתפריט הדפדפן להתקנה.'
    }
  })()

  const runInstallDiagnostic = async () => {
    const checks: string[] = []
    if (typeof window === 'undefined') {
      setInstallDiagnostic('הסביבה לא תומכת')
      return
    }
    checks.push(window.location.protocol === 'https:' ? '✓ HTTPS' : '✗ לא HTTPS — דרוש לדומיין מאובטח')
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (reg && (reg.active || reg.installing || reg.waiting)) {
          checks.push('✓ Service Worker רשום')
        } else {
          checks.push('✗ Service Worker לא רשום עדיין — רענן את הדף פעם נוספת')
        }
      } catch {
        checks.push('✗ לא ניתן לבדוק Service Worker')
      }
    } else {
      checks.push('✗ הדפדפן לא תומך ב‑Service Worker')
    }
    try {
      const res = await fetch('/manifest.webmanifest', { cache: 'no-store' })
      checks.push(res.ok ? '✓ Manifest זמין' : '✗ Manifest לא נטען')
    } catch {
      checks.push('✗ לא ניתן לטעון Manifest')
    }
    if (deferredPrompt) {
      checks.push('✓ הדפדפן מוכן לפתוח חלון התקנה')
    } else {
      checks.push('• הדפדפן לא הציע חלון התקנה אוטומטי — השתמש בתפריט הדפדפן (ראה הוראות מעלה)')
    }
    setInstallDiagnostic(checks.join(' · '))
  }

  const handleInstall = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt()
        const choice = await deferredPrompt.userChoice
        if (choice.outcome === 'accepted') {
          setInstallHintText('האפליקציה תותקן כעת.')
        } else {
          setInstallHintText('ההתקנה בוטלה. ניתן להתקין שוב מהתפריט של הדפדפן.')
        }
      } catch {
        setInstallHintText('שגיאה בפתיחת חלון ההתקנה. נסה דרך תפריט הדפדפן.')
      }
      setDeferredPrompt(null)
      return
    }
    if (typeof window !== 'undefined' && window.location.protocol !== 'https:') {
      setInstallHintText('התקנת PWA דורשת HTTPS. פתח את הקישור הרשמי של Vercel.')
    }
    setInstallHintText(platformInstructions)
    void runInstallDiagnostic()
  }

  const submitProfile = async () => {
    setProfileSaving(true)
    const result = await onSaveProfile({
      full_name: profileName,
      avatar_url: profileAvatarUrl,
      avatar_path: profileAvatarPath,
    })
    setProfileMessage(result.message)
    setProfileSaving(false)
    if (result.ok) {
      setTimeout(() => setShowProfile(false), 650)
    }
  }

  const onPickProfilePhoto = async (file?: File | null) => {
    if (!file) return
    setProfileSaving(true)
    const uploaded = await onUploadProfilePhoto(file)
    if (uploaded.ok) {
      setProfileAvatarPath(uploaded.avatar_path ?? '')
      setProfileAvatarUrl(uploaded.avatar_url ?? '')
      setProfileMessage('תמונה הועלתה בהצלחה')
    } else {
      setProfileMessage(uploaded.message)
    }
    setProfileSaving(false)
  }

  const accountsShownInBreakdown = useMemo(
    () =>
      scopeMode === 'shared'
        ? accounts
        : accounts.filter(
            (a) => a.is_shared || (!a.is_shared && a.owner_user_id === currentUserId),
          ),
    [accounts, scopeMode, currentUserId],
  )

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
      accountsShownInBreakdown.map((account) => {
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
          kind: account.is_shared ? 'משותף' : account.owner_user_id ? 'אישי' : 'כללי',
        }
      }),
    [accountsShownInBreakdown, entries],
  )
  const expenseDistribution = useMemo(() => {
    // Coverage: every actual expense for the scoped+selected-month view
    // contributes exactly once. No top-N cap, no "Other" rollup, no rounding
    // before aggregation. Categories are normalized only by trimming and
    // empty-string fallback; nothing else is dropped or merged.
    const expenses = entries.filter((entry) => entry.type === 'expense' && !entry.planned)
    const byCategory = new Map<string, number>()
    expenses.forEach((entry) => {
      const amount = Number(entry.amount)
      if (!Number.isFinite(amount) || amount <= 0) return
      const key = (entry.category ?? '').trim() || 'אחר'
      byCategory.set(key, (byCategory.get(key) ?? 0) + amount)
    })
    const total = Array.from(byCategory.values()).reduce((sum, value) => sum + value, 0)
    const rows = Array.from(byCategory.entries())
      .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
      .map(([category, amount]) => ({
        category,
        amount,
        color: colorForCategory(category),
        pctExpense: total > 0 ? (amount / total) * 100 : 0,
        pctIncome: actualIncome > 0 ? (amount / actualIncome) * 100 : 0,
      }))
      .sort((a, b) => {
        if (b.amount !== a.amount) return b.amount - a.amount
        return a.category.localeCompare(b.category, 'he')
      })
    // Invariant: the legend's slice sum must equal the displayed actualExpense
    // (both are computed from the same scoped+selected-month entries with
    // type === 'expense' && !planned). If this ever fails, a slice was hidden
    // or rounded away upstream.
    const sliceSum = rows.reduce((sum, row) => sum + row.amount, 0)
    console.assert(
      Math.abs(sliceSum - total) < 0.005,
      'expenseDistribution: slice sum diverges from category total',
      { sliceSum, total },
    )
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
    let start = 0
    const parts = expenseDistribution.rows.map((row) => {
      const span = (row.amount / expenseDistribution.total) * 360
      const end = start + span
      const part = `${row.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`
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
            <h1 className="dashboard-title">{householdName}</h1>
            <p className="dashboard-sub">סיכום חודשי — תחזית מול ביצוע</p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="profile-chip"
              onClick={() => {
                setProfileName(profile.full_name ?? '')
                setProfileAvatarUrl(profile.avatar_url ?? '')
                setProfileAvatarPath(profile.avatar_path ?? '')
                setProfileMessage(null)
                setJoinCodeInput('')
                setJoinMessage(null)
                setCopyJoinHint(null)
                setFamilyNameDraft(householdName)
                setFamilyNameMessage(null)
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
            <button type="button" className="btn-ghost" onClick={() => void onSignOut()}>
              יציאה
            </button>
          </div>
        </div>
      </section>
      <section className="card family-strip">
        <div className="family-strip-heading">
          <strong className="family-strip-title">{householdName}</strong>
          <p className="muted small family-strip-sub">
            {householdMembers.length > 1
              ? `${householdMembers.length} משתמשים בבית · במצב «משותף» רואים את כל החשבונות והתנועות של המשפחה`
              : 'בית אישי — ב«הפרופיל שלי» יש קוד הזמנה לשיתוף עם בן/בת הזוג'}
          </p>
        </div>
        <div className="family-members-label muted small">חברי הבית</div>
        <div className="family-members">
          {familyMembers.map((member) => (
            <div key={member.id} className="family-member">
              {member.avatar_url ? (
                <img src={member.avatar_url} alt={member.name} className="family-avatar" />
              ) : (
                <span className="profile-chip-initials family-avatar-initials">
                  {member.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span>{member.name}</span>
            </div>
          ))}
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
        <p className="muted small" style={{ marginTop: 8 }}>
          אישי: רק תנועות שאת/ה רשמת (כולל על חשבון משותף). משותף: כל תנועות הבית של כולם יחד.
        </p>
      </div>

      {!isStandalone ? (
        <section className="install-cta card">
          <div>
            <strong>התקן אפליקציה לטלפון</strong>
            <p className="muted">{installHintText || platformInstructions}</p>
            {installDiagnostic ? <p className="muted small">{installDiagnostic}</p> : null}
            {!deferredPrompt ? (
              <p className="muted small">
                טיפ: אם הכפתור לא פותח חלון התקנה — סימן שהדפדפן עדיין לא הציע חלון אוטומטי. בצע את ההוראות שלמעלה (תפריט הדפדפן).
              </p>
            ) : null}
          </div>
          <div className="row-actions">
            <button type="button" className="btn-primary btn-xs install-btn" onClick={() => void handleInstall()}>
              {deferredPrompt ? 'התקן אפליקציה' : 'הצג הוראות התקנה'}
            </button>
          </div>
        </section>
      ) : null}

      {loading ? <p className="muted">טוען נתונים…</p> : null}

      <div className="kpi-grid">
        <article className="kpi-card kpi-income">
          <span className="kpi-label">הכנסות החודש</span>
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
          <span className="kpi-label">הוצאות החודש</span>
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
          <span>יתרה צפויה</span>
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
          <p className="muted">בסיס התחזית: הרגלי החודשים האחרונים + החודש הקודם.</p>
        </div>
      </section>
      <section className="card expense-distribution">
        <h2 className="card-heading">חלוקת הוצאות לפי קטגוריה</h2>
        <div className="expense-pie-wrap">
          <div className="expense-pie" style={{ background: pieGradient }} aria-label="חלוקת הוצאות" />
          <div className="expense-legend" role="list">
            {expenseDistribution.rows.map((row) => (
              <div key={row.category} className="expense-legend-row" role="listitem">
                <span
                  className="expense-legend-swatch"
                  style={{ background: row.color }}
                  aria-hidden="true"
                />
                <div className="expense-legend-text">
                  <strong>{row.category}</strong>
                  <span>{formatIls(row.amount)}</span>
                  <small>
                    {formatPctOneDecimal(row.pctExpense)} מההוצאות · {formatPctOneDecimal(row.pctIncome)} מההכנסות
                  </small>
                </div>
              </div>
            ))}
            {!expenseDistribution.rows.length ? <p className="muted">אין הוצאות בפועל לחודש זה.</p> : null}
          </div>
        </div>
        {expenseDistribution.rows.length ? (
          <div className="expense-legend-total">
            <span>סך הכל ({expenseDistribution.rows.length} קטגוריות)</span>
            <strong>{formatIls(expenseDistribution.total)}</strong>
          </div>
        ) : null}
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
          <button
            type="button"
            className={advisorLoading ? 'btn-primary btn-xs btn-loading' : 'btn-primary btn-xs'}
            onClick={() => void runAdvisor()}
            disabled={advisorLoading}
            aria-busy={advisorLoading}
          >
            <span className="btn-label">
              {advisorLoading ? 'מנתח נתונים…' : 'יועץ AI — המלצות לחיסכון'}
            </span>
            {advisorLoading ? (
              <span className="btn-spinner thinking-dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            ) : null}
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
                {householdAccountPickLabel(account, currentUserId, householdMembers)}
              </option>
            ))}
          </select>
        </div>
        <div className="account-grid">
          {accountSummaries.map((account) => (
            <article key={account.id} className="account-card">
              <div className="account-title-row">
                <strong>{householdAccountPickLabel(account, currentUserId, householdMembers)}</strong>
                <span className="account-kind">{account.kind}</span>
              </div>
              <small>הכנסות: {account.income.toLocaleString()} ₪</small>
              <small>הוצאות: {account.expense.toLocaleString()} ₪</small>
              <small>תחזית בית חכמה: {(plannedIncome - plannedExpense).toLocaleString()} ₪</small>
              <strong className="account-balance">מאזן: {account.balance.toLocaleString()} ₪</strong>
            </article>
          ))}
        </div>
      </section>
      {showProfile ? (
        <div className="modal-backdrop" onClick={() => setShowProfile(false)}>
          <article className="card card-form modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-heading">הפרופיל שלי</h2>

            <section className="household-settings card" style={{ marginTop: 12, padding: 12 }}>
              <h3 className="card-heading" style={{ fontSize: '1rem', margin: '0 0 8px' }}>
                בית משפחתי
              </h3>
              <p className="muted small" style={{ margin: '0 0 10px' }}>
                כל חבר בית רואה את אותו שם. העתיקו את קוד ההזמנה למטה ושלחו למשתמש אחר — אחרי שהוא מדביק את
                הקוד ב«הצטרפות לבית אחר», שני החשבונות עובדים כמשפחה (אישי ומשותף).
              </p>
              <label className="stack">
                <span>שם הבית / המשפחה</span>
                <input
                  value={familyNameDraft}
                  onChange={(e) => {
                    setFamilyNameDraft(e.target.value)
                    setFamilyNameMessage(null)
                  }}
                  placeholder="למשל: משפחת כהן"
                  maxLength={120}
                />
              </label>
              <div className="row-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  disabled={familyNameSaving || !familyNameDraft.trim() || familyNameDraft.trim() === householdName}
                  onClick={() => {
                    setFamilyNameSaving(true)
                    setFamilyNameMessage(null)
                    void onRenameHousehold(familyNameDraft.trim()).then((r) => {
                      setFamilyNameSaving(false)
                      setFamilyNameMessage(r.message)
                    })
                  }}
                >
                  {familyNameSaving ? 'שומר…' : 'שמור שם בית'}
                </button>
              </div>
              {familyNameMessage ? (
                <p
                  className="inline-status"
                  style={
                    familyNameMessage.includes('נשמר')
                      ? undefined
                      : { color: 'var(--danger, #b91c1c)', marginTop: 8 }
                  }
                >
                  {familyNameMessage}
                </p>
              ) : null}

              <p className="muted small" style={{ margin: '14px 0 6px' }}>
                <strong>קוד הזמנה</strong> — מזהה הבית (העתקה לבן/בת הזוג):
              </p>
              <div className="row-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
                <code className="ltr-input" style={{ flex: 1, minWidth: 0, padding: '8px 10px', wordBreak: 'break-all' }}>
                  {householdId}
                </code>
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(householdId).then(
                      () => {
                        setCopyJoinHint('הועתק ללוח')
                        window.setTimeout(() => setCopyJoinHint(null), 2000)
                      },
                      () => setCopyJoinHint('העתקה נכשלה — סמן והעתק ידנית'),
                    )
                  }}
                >
                  העתק קוד
                </button>
              </div>
              {copyJoinHint ? <p className="inline-status">{copyJoinHint}</p> : null}

              <label className="stack" style={{ marginTop: 12 }}>
                <span>הצטרפות לבית אחר (הדבק את הקוד שקיבלת)</span>
                <input
                  className="ltr-input"
                  value={joinCodeInput}
                  onChange={(e) => {
                    setJoinCodeInput(e.target.value.trim())
                    setJoinMessage(null)
                  }}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="btn-secondary btn-xs"
                style={{ marginTop: 8 }}
                disabled={joinBusy || !joinCodeInput.trim()}
                onClick={() => {
                  if (!supabase) {
                    setJoinMessage('אין חיבור לשרת')
                    return
                  }
                  setJoinBusy(true)
                  setJoinMessage(null)
                  void supabase
                    .rpc('join_household_by_code', { p_household_code: joinCodeInput.trim() })
                    .then(({ error }) => {
                      setJoinBusy(false)
                      if (error) {
                        setJoinMessage(error.message)
                        return
                      }
                      setJoinMessage('הצטרפת בהצלחה. טוען את הבית החדש…')
                      onHouseholdJoined()
                      window.setTimeout(() => setShowProfile(false), 900)
                    })
                }}
              >
                {joinBusy ? 'מצטרף…' : 'הצטרף לבית זה'}
              </button>
              {joinMessage ? <p className="inline-status">{joinMessage}</p> : null}
            </section>

            <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)' }} />

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
            <label className="stack" style={{ marginTop: 8 }}>
              <span>או העלאת תמונה ישירות ל-Supabase</span>
              <input type="file" accept="image/*" onChange={(e) => void onPickProfilePhoto(e.target.files?.[0])} />
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
    </div>
  )
}
