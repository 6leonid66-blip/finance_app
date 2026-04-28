import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { AddExpenseSheet } from './components/AddExpenseSheet'
import { BottomNav } from './components/BottomNav'
import { Dashboard } from './components/Dashboard'
import { PlanningView } from './components/PlanningView'
import { RecurringTemplatesPanel } from './components/RecurringTemplatesPanel'
import { TransactionsView } from './components/TransactionsView'
import { isSupabaseConfigured, supabase } from './supabase'
import type { AppScreen, FinanceEntry, FinancialAccount, Household, MonthlyPlan } from './types'
import { monthValueToRange } from './lib/month'
import { getReceiptPublicUrl } from './lib/receiptStorage'

function App() {
  const [screen, setScreen] = useState<AppScreen>('dashboard')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetType, setSheetType] = useState<'expense' | 'income'>('expense')
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [sessionUserEmail, setSessionUserEmail] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [loadingData, setLoadingData] = useState(false)
  const [entries, setEntries] = useState<FinanceEntry[]>([])
  const [plans, setPlans] = useState<MonthlyPlan[]>([])
  const [recurringKeys, setRecurringKeys] = useState<string[]>([])
  const [historyEntries, setHistoryEntries] = useState<
    Array<{ type: 'income' | 'expense'; amount: number; occurred_on: string; planned: boolean }>
  >([])
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const actualIncome = useMemo(
    () => entries.filter((e) => e.type === 'income' && !e.planned).reduce((s, e) => s + e.amount, 0),
    [entries],
  )
  const actualExpense = useMemo(
    () => entries.filter((e) => e.type === 'expense' && !e.planned).reduce((s, e) => s + e.amount, 0),
    [entries],
  )
  const plannedIncome = useMemo(() => plans.reduce((s, p) => s + p.planned_income, 0), [plans])
  const plannedExpense = useMemo(() => plans.reduce((s, p) => s + p.planned_expense, 0), [plans])

  const describeError = (error: unknown) => {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
      const maybeMessage = (error as { message?: unknown }).message
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage
      try {
        return JSON.stringify(error)
      } catch {
        return 'שגיאה לא צפויה'
      }
    }
    return typeof error === 'string' ? error : 'שגיאה לא צפויה'
  }

  async function ensureUserAccount(householdId: string, userId: string) {
    if (!supabase) return
    const { data: ownAccount, error: ownErr } = await supabase
      .from('financial_accounts')
      .select('id,name')
      .eq('household_id', householdId)
      .eq('owner_user_id', userId)
      .eq('active', true)
      .maybeSingle()
    if (ownErr) throw ownErr
    if (ownAccount?.id) {
      setSelectedAccountId(ownAccount.id)
      return
    }

    const { data: created, error: createErr } = await supabase
      .from('financial_accounts')
      .insert({
        household_id: householdId,
        owner_user_id: userId,
        name: 'חשבון שלי',
        is_shared: false,
        active: true,
      })
      .select('id,name')
      .single()
    if (createErr) throw createErr
    if (created?.id) setSelectedAccountId(created.id)
  }

  async function bootstrapUserData(userId: string, userEmail: string | null) {
    if (!supabase) return
    setLoadingData(true)
    setStatusMessage(null)
    try {
      const emailAddress = userEmail?.trim() || `${userId}@local.invalid`
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ id: userId, email: emailAddress }, { onConflict: 'id' })
      if (profileError) throw profileError

      const { data: memberRow, error: memberError } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (memberError) throw memberError

      if (memberRow?.household_id) {
        const { data: householdRow, error: existingHouseholdError } = await supabase
          .from('households')
          .select('id,name')
          .eq('id', memberRow.household_id)
          .single()
        if (existingHouseholdError) throw existingHouseholdError
        setHousehold(householdRow as Household)
        await ensureUserAccount((householdRow as Household).id, userId)
        return
      }

      const { data: bootstrapRows, error: bootstrapError } = await supabase.rpc('bootstrap_household', {
        p_name: 'הבית שלנו',
      })
      if (bootstrapError) throw bootstrapError
      const bootstrapRow = Array.isArray(bootstrapRows) ? bootstrapRows[0] : null
      const resolvedId =
        (bootstrapRow as { out_household_id?: string; household_id?: string } | null)?.out_household_id ??
        (bootstrapRow as { out_household_id?: string; household_id?: string } | null)?.household_id
      const resolvedName =
        (bootstrapRow as { out_household_name?: string; household_name?: string } | null)?.out_household_name ??
        (bootstrapRow as { out_household_name?: string; household_name?: string } | null)?.household_name

      if (!resolvedId) throw new Error('לא הצלחתי ליצור בית חדש')
      setHousehold({ id: resolvedId, name: resolvedName ?? 'הבית שלנו' })
      await ensureUserAccount(resolvedId, userId)
      setStatusMessage('נוצר בית חדש. אפשר להתחיל.')
    } catch (error) {
      setStatusMessage(`שגיאה בטעינת המשתמש: ${describeError(error)}`)
    } finally {
      setLoadingData(false)
    }
  }

  async function loadMonthlyData(householdId: string, monthValue: string) {
    if (!supabase) return
    setLoadingData(true)
    setStatusMessage(null)
    const { startDate, endDate, monthDate } = monthValueToRange(monthValue)
    const historyStartDate = new Date(`${monthValue}-01T00:00:00`)
    historyStartDate.setMonth(historyStartDate.getMonth() - 11)
    const historyStart = new Date(historyStartDate.getFullYear(), historyStartDate.getMonth(), 1)
      .toISOString()
      .slice(0, 10)
    const historyEnd = new Date(`${monthValue}-01T00:00:00`)
    historyEnd.setMonth(historyEnd.getMonth() + 1)
    historyEnd.setDate(0)
    const missingOptionalColumns = (error: unknown) => {
      if (!error || typeof error !== 'object') return false
      const e = error as { code?: string; message?: string }
      return (
        e.code === '42703' ||
        e.message?.includes('receipt_path') ||
        e.message?.includes('receipt_filename') ||
        e.message?.includes('receipt_mime_type') ||
        e.message?.includes('receipt_size_bytes') ||
        e.message?.includes('auto_post_template_id') ||
        e.message?.includes('auto_post_month')
      )
    }

    try {
      const { error: rpcError } = await supabase.rpc('ensure_month_plans_from_templates', {
        p_household: householdId,
        p_month: monthDate,
      })
      if (rpcError) {
        if (rpcError.message?.includes('function') || rpcError.code === '42883') {
          setStatusMessage('הרץ את מיגרציית recurring ב-Supabase (ensure_month_plans_from_templates).')
        } else {
          throw rpcError
        }
      }
      const { error: autoPostError } = await supabase.rpc('ensure_auto_post_transactions_from_templates', {
        p_household: householdId,
        p_month: monthDate,
      })
      if (autoPostError) {
        if (autoPostError.message?.includes('function') || autoPostError.code === '42883') {
          setStatusMessage('פונקציית auto-post חסרה. הרץ מיגרציה: 202604290230_recurring_auto_post_transactions.sql')
        } else {
          throw autoPostError
        }
      }

      const txWithReceipts = await supabase
        .from('transactions')
        .select(
          'id,owner_id,account_id,receipt_path,receipt_filename,receipt_mime_type,receipt_size_bytes,auto_post_template_id,auto_post_month,type,amount,category,note,occurred_on,planned,created_at',
        )
        .eq('household_id', householdId)
        .gte('occurred_on', startDate)
        .lte('occurred_on', endDate)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })

      let txData = txWithReceipts.data as Array<Record<string, unknown>> | null
      let txError = txWithReceipts.error

      if (txError && missingOptionalColumns(txError)) {
        setStatusMessage(
          'עמודות אופציונליות עדיין חסרות ב-DB. הרץ מיגרציות receipts + auto-post.',
        )
        const txFallback = await supabase
          .from('transactions')
          .select('id,owner_id,account_id,type,amount,category,note,occurred_on,planned,created_at')
          .eq('household_id', householdId)
          .gte('occurred_on', startDate)
          .lte('occurred_on', endDate)
          .order('occurred_on', { ascending: false })
          .order('created_at', { ascending: false })
        txData = txFallback.data as Array<Record<string, unknown>> | null
        txError = txFallback.error
      }

      const [
        { data: planData, error: planError },
        { data: accountData, error: accountError },
        { data: recurringData, error: recurringError },
        { data: historyData, error: historyError },
      ] =
        await Promise.all([
          supabase
          .from('monthly_plans')
          .select('id,category,planned_income,planned_expense')
          .eq('household_id', householdId)
          .eq('month_date', monthDate)
          .order('category', { ascending: true }),
          supabase
          .from('financial_accounts')
          .select('id,household_id,owner_user_id,name,is_shared,active,created_at')
          .eq('household_id', householdId)
          .eq('active', true)
          .order('created_at', { ascending: true }),
          supabase
          .from('recurring_templates')
          .select('direction,category,active')
          .eq('household_id', householdId)
          .eq('active', true),
          supabase
            .from('transactions')
            .select('type,amount,occurred_on,planned')
            .eq('household_id', householdId)
            .gte('occurred_on', historyStart)
            .lte('occurred_on', historyEnd.toISOString().slice(0, 10))
            .order('occurred_on', { ascending: true }),
        ])
      if (txError) throw txError
      if (planError) throw planError
      if (accountError) throw accountError
      if (recurringError) throw recurringError
      if (historyError) throw historyError

      const rows = (txData ?? []).map((row) => ({
        ...(row as unknown as FinanceEntry),
        amount: Number((row as { amount: unknown }).amount),
        receipt_path: (row as { receipt_path?: string | null }).receipt_path ?? null,
        receipt_filename: (row as { receipt_filename?: string | null }).receipt_filename ?? null,
        receipt_mime_type: (row as { receipt_mime_type?: string | null }).receipt_mime_type ?? null,
        receipt_size_bytes: (row as { receipt_size_bytes?: number | null }).receipt_size_bytes ?? null,
        auto_post_template_id: (row as { auto_post_template_id?: string | null }).auto_post_template_id ?? null,
        auto_post_month: (row as { auto_post_month?: string | null }).auto_post_month ?? null,
      }))
      const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))]
      let profileMap = new Map<string, { email: string | null; full_name: string | null }>()
      if (ownerIds.length) {
        const { data: profs, error: pErr } = await supabase
          .from('profiles')
          .select('id,email,full_name')
          .in('id', ownerIds)
        if (!pErr && profs) {
          profileMap = new Map(
            profs.map((p: { id: string; email: string | null; full_name: string | null }) => [
              p.id,
              { email: p.email, full_name: p.full_name },
            ]),
          )
        }
      }

      const accountRows = (accountData ?? []) as FinancialAccount[]
      setAccounts(accountRows)
      if (!selectedAccountId && accountRows[0]?.id) {
        setSelectedAccountId(accountRows[0].id)
      }
      const accountMap = new Map(accountRows.map((a) => [a.id, a.name]))
      const recurringKey = new Set(
        ((recurringData ?? []) as Array<{ direction: 'income' | 'expense'; category: string }>).map(
          (row) => `${row.direction}__${row.category}`,
        ),
      )
      setRecurringKeys(Array.from(recurringKey))

      setEntries(
        rows.map((row) => {
          const p = profileMap.get(row.owner_id)
          return {
            ...row,
            owner_email: p?.email ?? null,
            owner_name: p?.full_name ?? null,
            account_name: row.account_id ? accountMap.get(row.account_id) ?? null : null,
            receipt_url: getReceiptPublicUrl(row.receipt_path),
            is_fixed: recurringKey.has(`${row.type}__${row.category}`),
            is_auto_from_recurring: Boolean(row.auto_post_template_id),
          }
        }),
      )
      setPlans(
        (planData ?? []).map((p) => ({
          ...(p as MonthlyPlan),
          planned_income: Number((p as { planned_income: unknown }).planned_income),
          planned_expense: Number((p as { planned_expense: unknown }).planned_expense),
        })),
      )
      setHistoryEntries(
        ((historyData ?? []) as Array<{ type: 'income' | 'expense'; amount: unknown; occurred_on: string; planned: boolean }>).map(
          (row) => ({
            type: row.type,
            amount: Number(row.amount),
            occurred_on: row.occurred_on,
            planned: row.planned,
          }),
        ),
      )
    } catch (error) {
      setStatusMessage(`שגיאה בטעינת החודש: ${describeError(error)}`)
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    if (!supabase) return
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSessionUserId(data.session?.user.id ?? null)
        setSessionUserEmail(data.session?.user.email ?? null)
      })
      .finally(() => setAuthLoading(false))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null
      setSessionUserId(userId)
      setSessionUserEmail(session?.user.email ?? null)
      if (!userId) {
        setHousehold(null)
        setEntries([])
        setPlans([])
        setRecurringKeys([])
        setHistoryEntries([])
        setAccounts([])
        setSelectedAccountId('')
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !sessionUserId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void bootstrapUserData(sessionUserId, sessionUserEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId, sessionUserEmail])

  useEffect(() => {
    if (!household) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMonthlyData(household.id, selectedMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household, selectedMonth])

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setAuthError(null)
    setAuthLoading(true)
    try {
      if (authMode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setAuthError('נרשמת בהצלחה. אם יש אימות מייל, יש לאשר לפני כניסה.')
        setAuthMode('signin')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'שגיאה בהתחברות.')
    } finally {
      setAuthLoading(false)
    }
  }

  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const openFab = (type: 'expense' | 'income') => {
    setSheetType(type)
    setSheetOpen(true)
  }

  const refreshMonth = () => {
    if (household) void loadMonthlyData(household.id, selectedMonth)
  }

  const showFab = screen === 'dashboard' || screen === 'transactions'

  return (
    <div className="app-root" dir="rtl">
      <main className="app-main">
        {!isSupabaseConfigured ? (
          <section className="card warning">
            <h2>חסר חיבור ל-Supabase</h2>
            <p>
              הגדר <code>VITE_SUPABASE_URL</code> ו-<code>VITE_SUPABASE_ANON_KEY</code> בקובץ <code>.env</code>.
            </p>
          </section>
        ) : null}

        {isSupabaseConfigured && !sessionUserId ? (
          <section className="card auth-card">
            <h2>{authMode === 'signin' ? 'התחברות' : 'הרשמה'}</h2>
            <form onSubmit={handleAuth} className="stack">
              <label>
                אימייל
                <input
                  type="email"
                  className="ltr-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label>
                סיסמה
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                />
              </label>
              <button type="submit" className="btn-primary" disabled={authLoading}>
                {authLoading ? 'טוען…' : authMode === 'signin' ? 'כניסה' : 'יצירת חשבון'}
              </button>
            </form>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setAuthMode((m) => (m === 'signin' ? 'signup' : 'signin'))
                setAuthError(null)
              }}
            >
              {authMode === 'signin' ? 'אין חשבון? הרשמה' : 'יש חשבון? התחברות'}
            </button>
            {authError ? <p className="inline-status">{authError}</p> : null}
          </section>
        ) : null}

        {sessionUserId && household ? (
          <>
            {screen === 'dashboard' ? (
              <Dashboard
                selectedMonth={selectedMonth}
                onMonthChange={setSelectedMonth}
                actualIncome={actualIncome}
                actualExpense={actualExpense}
                plannedIncome={plannedIncome}
                plannedExpense={plannedExpense}
                entries={entries}
                historyEntries={historyEntries}
                accounts={accounts}
                selectedAccountId={selectedAccountId}
                onSelectAccount={setSelectedAccountId}
                loading={loadingData}
                onSignOut={signOut}
              />
            ) : null}

            {screen === 'transactions' ? (
              <TransactionsView
                entries={entries}
                plans={plans}
                recurringKeys={recurringKeys}
                selectedMonth={selectedMonth}
                householdId={household.id}
                sessionUserId={sessionUserId}
                accounts={accounts}
                selectedAccountId={selectedAccountId}
                onSelectedAccountIdChange={setSelectedAccountId}
                loading={loadingData}
                onRefresh={refreshMonth}
              />
            ) : null}

            {screen === 'planning' ? (
              <PlanningView
                plans={plans}
                householdId={household.id}
                selectedMonth={selectedMonth}
                loading={loadingData}
                onRefresh={refreshMonth}
              />
            ) : null}

            {screen === 'recurring' ? (
              <RecurringTemplatesPanel
                householdId={household.id}
                selectedMonth={selectedMonth}
                onTemplatesChanged={refreshMonth}
              />
            ) : null}

          </>
        ) : null}

        {sessionUserId && !household ? (
          <section className="card">
            <h2>טוען את הבית שלך…</h2>
            <p className="muted">
              אם זה נשאר הרבה זמן, כנראה שיש בעיית DB/RLS. בדוק שהרצת את כל המיגרציות ב-Supabase.
            </p>
            {statusMessage ? <p className="inline-status">{statusMessage}</p> : null}
          </section>
        ) : null}

        {statusMessage ? <p className="banner-msg">{statusMessage}</p> : null}

        {authLoading && !sessionUserId ? <p className="muted center">בודק משתמש…</p> : null}
      </main>

      {sessionUserId && household ? (
        <>
          <BottomNav active={screen} onChange={setScreen} />
          {showFab ? (
            <div className="fab-wrap">
              <button type="button" className="fab fab-secondary" onClick={() => openFab('income')}>
                + הכנסה
              </button>
              <button type="button" className="fab" onClick={() => openFab('expense')}>
                + הוצאה
              </button>
            </div>
          ) : null}
          <AddExpenseSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            householdId={household.id}
            sessionUserId={sessionUserId}
            selectedMonth={selectedMonth}
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onSelectedAccountIdChange={setSelectedAccountId}
            initialType={sheetType}
            onSaved={refreshMonth}
          />
        </>
      ) : null}
    </div>
  )
}

export default App
