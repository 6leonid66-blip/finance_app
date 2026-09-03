import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { AddExpenseSheet } from './components/AddExpenseSheet'
import type { AddExpensePrefill } from './components/AddExpenseSheet'
import { AppBootScreen } from './components/AppBootScreen'
import { BottomNav } from './components/BottomNav'
import { Dashboard } from './components/Dashboard'
import { RecurringTemplatesPanel } from './components/RecurringTemplatesPanel'
import { TransactionsView } from './components/TransactionsView'
import { AccountFilterBar } from './components/AccountFilterBar'
import { MonthChrome } from './components/MonthChrome'
import { SettingsSheet } from './components/SettingsSheet'
import { isSupabaseConfigured, supabase } from './supabase'
import type { AppScreen, FinanceEntry, FinancialAccount, Household, HouseholdMemberBrief, RecurringEndRule, RecurringTemplate, UserProfileView } from './types'
import { getReceiptPublicUrl } from './lib/receiptStorage'
import { uploadProfileImage } from './lib/profileStorage'
import { installmentProgressLabel } from './lib/recurringProgress'
import { getLocalMonthValue, monthValueToFirstDay } from './lib/month'
import { memberProfileDisplayName } from './lib/displayUser'
import { EXPENSE_CATEGORIES } from './constants/categories'
import {
  filterEntriesByMemberScope,
  filterTemplatesByMemberScope,
  preferredAccountIdForScope,
  type MemberScope,
} from './lib/memberScope'
import {
  getSpeechRecognitionCtor,
  parseVoiceTranscript,
  transcriptFromSpeechEvent,
  type SpeechRecognitionLike,
} from './lib/speech'
import { readStoredView, writeStoredView } from './lib/viewStorage'

function App() {
  const [screen, setScreen] = useState<AppScreen>('dashboard')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetType, setSheetType] = useState<'expense' | 'income'>('expense')
  const [sheetPrefill, setSheetPrefill] = useState<AddExpensePrefill>(null)
  const [addChooserOpen, setAddChooserOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [sessionUserEmail, setSessionUserEmail] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authInfo, setAuthInfo] = useState<string | null>(null)
  const [resendingVerification, setResendingVerification] = useState(false)
  const [sendingResetEmail, setSendingResetEmail] = useState(false)
  const [resetEmailSent, setResetEmailSent] = useState(false)
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const [updatingPassword, setUpdatingPassword] = useState(false)
  const [household, setHousehold] = useState<Household | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(() => getLocalMonthValue())
  const [loadingData, setLoadingData] = useState(false)
  const [entries, setEntries] = useState<FinanceEntry[]>([])
  const [historyEntries, setHistoryEntries] = useState<
    Array<{
      type: 'income' | 'expense'
      amount: number
      occurred_on: string
      planned: boolean
      account_id: string | null
      owner_id: string
    }>
  >([])
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [templates, setTemplates] = useState<RecurringTemplate[]>([])
  const [profile, setProfile] = useState<UserProfileView>({
    full_name: null,
    email: null,
    avatar_path: null,
    avatar_url: null,
  })
  const [selectedScope, setSelectedScope] = useState<MemberScope>('all')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [recurringRpcError, setRecurringRpcError] = useState<string | null>(null)
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMemberBrief[]>([])
  const [dockRecording, setDockRecording] = useState(false)
  const [dockTranscript, setDockTranscript] = useState('')
  const [dockVoiceHint, setDockVoiceHint] = useState<string | null>(null)
  const [sheetFull, setSheetFull] = useState(false)
  const voiceRecRef = useRef<SpeechRecognitionLike | null>(null)
  const voiceTranscriptRef = useRef('')
  const voiceStartedRef = useRef(false)
  const voiceFailedRef = useRef(false)
  const voiceFinishingRef = useRef(false)
  const voiceHintTimerRef = useRef<number | null>(null)

  const scopedEntries = useMemo(
    () => filterEntriesByMemberScope(entries, selectedScope, accounts),
    [entries, selectedScope, accounts],
  )
  const scopedHistoryEntries = useMemo(
    () => filterEntriesByMemberScope(historyEntries, selectedScope, accounts),
    [historyEntries, selectedScope, accounts],
  )
  const scopedTemplates = useMemo(
    () => filterTemplatesByMemberScope(templates, selectedScope),
    [templates, selectedScope],
  )
  const defaultAccountId = useMemo(
    () => preferredAccountIdForScope(selectedScope, accounts, sessionUserId),
    [selectedScope, accounts, sessionUserId],
  )

  const applyStoredView = (householdId: string) => {
    const stored = readStoredView(householdId)
    if (stored.scope) setSelectedScope(stored.scope)
    if (stored.month) setSelectedMonth(stored.month)
  }

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

  async function refreshHouseholdMembers(householdId: string) {
    if (!supabase) return
    const { data: memberRows, error: mErr } = await supabase
      .from('household_members')
      .select('user_id')
      .eq('household_id', householdId)

    const idsFromMembership =
      !mErr && memberRows?.length
        ? ([...new Set(memberRows.map((r) => r.user_id).filter(Boolean))] as string[])
        : []

    const { data: accountRows } = await supabase
      .from('financial_accounts')
      .select('owner_user_id')
      .eq('household_id', householdId)
      .eq('active', true)

    const idsFromAccounts = [
      ...new Set(
        ((accountRows ?? []) as Array<{ owner_user_id: string | null }>)
          .map((r) => r.owner_user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ]

    const userIds = [...new Set([...idsFromMembership, ...idsFromAccounts])]

    if (!userIds.length) {
      setHouseholdMembers([])
      return
    }

    const profRes = await supabase.from('profiles').select('id,email,full_name,avatar_url').in('id', userIds)
    let profs:
      | Array<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }>
      | null
      | undefined = profRes.data as typeof profs
    if (profRes.error?.code === '42703') {
      const fb = await supabase.from('profiles').select('id,email,full_name').in('id', userIds)
      if (fb.error) {
        setHouseholdMembers([])
        return
      }
      profs = ((fb.data ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>).map((p) => ({
        ...p,
        avatar_url: null as string | null,
      }))
    } else if (profRes.error) {
      setHouseholdMembers([])
      return
    }
    const list: HouseholdMemberBrief[] = userIds.map((uid) => {
      const p = profs?.find((x) => x.id === uid)
      const label = memberProfileDisplayName(p?.full_name, p?.email, uid)
      return {
        userId: uid,
        displayName: label,
        avatarUrl: p?.avatar_url ?? null,
      }
    })
    list.sort((a, b) => {
      if (a.userId === sessionUserId) return -1
      if (b.userId === sessionUserId) return 1
      return a.displayName.localeCompare(b.displayName, 'he')
    })
    setHouseholdMembers(list)
  }

  const getAuthRedirectTo = () => {
    if (typeof window === 'undefined') return undefined
    return window.location.origin
  }

  async function rpcEnsureAllHouseholdPersonalAccounts(householdId: string) {
    if (!supabase) return
    const { error } = await supabase.rpc('ensure_personal_accounts_for_household', {
      p_household_id: householdId,
    })
    if (error && error.code !== '42883') {
      console.warn('ensure_personal_accounts_for_household:', error.message)
    }
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
      return
    }

    const { error: createErr } = await supabase
      .from('financial_accounts')
      .insert({
        household_id: householdId,
        owner_user_id: userId,
        name: 'חשבון שלי',
        is_shared: false,
        active: true,
      })
    if (createErr) throw createErr
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
      const profileWithAvatar = await supabase
        .from('profiles')
        .select('full_name,avatar_url')
        .eq('id', userId)
        .maybeSingle()
      let profileRow = profileWithAvatar.data as { full_name?: string | null; avatar_url?: string | null } | null
      if (profileWithAvatar.error && profileWithAvatar.error.code === '42703') {
        const profileFallback = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
        profileRow = profileFallback.data as { full_name?: string | null } | null
      }
      setProfile((prev) => ({
        ...prev,
        full_name: profileRow?.full_name ?? null,
        avatar_url: profileRow?.avatar_url ?? prev.avatar_url,
        email: userEmail ?? prev.email,
      }))

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
        applyStoredView((householdRow as Household).id)
        setHousehold(householdRow as Household)
        await rpcEnsureAllHouseholdPersonalAccounts((householdRow as Household).id)
        await ensureUserAccount((householdRow as Household).id, userId)
        void refreshHouseholdMembers((householdRow as Household).id)
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
      applyStoredView(resolvedId)
      setHousehold({ id: resolvedId, name: resolvedName ?? 'הבית שלנו' })
      await rpcEnsureAllHouseholdPersonalAccounts(resolvedId)
      await ensureUserAccount(resolvedId, userId)
      void refreshHouseholdMembers(resolvedId)
      setStatusMessage('נוצר בית חדש. אפשר להתחיל.')
    } catch (error) {
      setStatusMessage(`שגיאה בטעינת המשתמש: ${describeError(error)}`)
    } finally {
      setLoadingData(false)
    }
  }

  async function loadMonthlyData(householdId: string, monthValue: string, opts?: { silent?: boolean }) {
    if (!supabase) return
    if (!opts?.silent) setLoadingData(true)
    setStatusMessage(null)
    const [yNum, mNum] = monthValue.split('-').map(Number)
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const lastDayCurrent = new Date(yNum, mNum, 0).getDate()
    const startDate = `${monthValue}-01`
    const endDate = `${monthValue}-${pad2(lastDayCurrent)}`
    const monthDate = startDate
    const historyStartLocal = new Date(yNum, mNum - 1 - 11, 1)
    const historyStart = `${historyStartLocal.getFullYear()}-${pad2(historyStartLocal.getMonth() + 1)}-01`
    const historyEnd = endDate
    const missingOptionalColumns = (error: unknown) => {
      if (!error || typeof error !== 'object') return false
      const e = error as { code?: string; message?: string }
      return (
        e.code === '42703' ||
        e.message?.includes('receipt_path') ||
        e.message?.includes('auto_post_template_id')
      )
    }

    try {
      await rpcEnsureAllHouseholdPersonalAccounts(householdId)

      const { error: autoPostError } = await supabase.rpc('ensure_auto_post_transactions_from_templates', {
        p_household: householdId,
        p_month: monthDate,
      })
      if (autoPostError) {
        if (autoPostError.message?.includes('function') || autoPostError.code === '42883') {
          setStatusMessage('פונקציית auto-post חסרה. הריצו את מיגרציית הקבועים ב-Supabase.')
        } else {
          throw autoPostError
        }
      }

      const txWithReceipts = await supabase
        .from('transactions')
        .select(
          'id,owner_id,account_id,receipt_path,receipt_filename,receipt_mime_type,receipt_size_bytes,auto_post_template_id,auto_post_month,manually_edited,type,amount,category,note,occurred_on,planned,created_at',
        )
        .eq('household_id', householdId)
        .gte('occurred_on', startDate)
        .lte('occurred_on', endDate)
        .order('created_at', { ascending: false })

      let txData = txWithReceipts.data as Array<Record<string, unknown>> | null
      let txError = txWithReceipts.error

      if (txError && missingOptionalColumns(txError)) {
        const txFallback = await supabase
          .from('transactions')
          .select('id,owner_id,account_id,type,amount,category,note,occurred_on,planned,created_at,auto_post_template_id,auto_post_month')
          .eq('household_id', householdId)
          .gte('occurred_on', startDate)
          .lte('occurred_on', endDate)
          .order('created_at', { ascending: false })
        txData = txFallback.data as Array<Record<string, unknown>> | null
        txError = txFallback.error
      }

      const [
        { data: accountData, error: accountError },
        { data: recurringData, error: recurringError },
        { data: historyData, error: historyError },
      ] = await Promise.all([
        supabase
          .from('financial_accounts')
          .select('id,household_id,owner_user_id,name,is_shared,active,created_at')
          .eq('household_id', householdId)
          .eq('active', true)
          .order('created_at', { ascending: true }),
        supabase
          .from('recurring_templates')
          .select(
            'id,household_id,direction,category,label,mode,default_amount,template_start_month,end_rule,end_month,max_installments,active,created_at,updated_at,owner_user_id',
          )
          .eq('household_id', householdId),
        supabase
          .from('transactions')
          .select('type,amount,occurred_on,planned,account_id,owner_id')
          .eq('household_id', householdId)
          .gte('occurred_on', historyStart)
          .lte('occurred_on', historyEnd)
          .order('occurred_on', { ascending: true }),
      ])
      if (txError) throw txError
      if (accountError) throw accountError
      const recurringOwnerMissing =
        recurringError?.code === '42703' || Boolean(recurringError?.message?.includes('owner_user_id'))
      if (recurringError && !recurringOwnerMissing) throw recurringError
      if (historyError) throw historyError

      let recurringRows = (recurringData ?? []) as RecurringTemplate[]
      if (recurringOwnerMissing) {
        const fb = await supabase
          .from('recurring_templates')
          .select(
            'id,household_id,direction,category,label,mode,default_amount,template_start_month,end_rule,end_month,max_installments,active,created_at,updated_at',
          )
          .eq('household_id', householdId)
        recurringRows = ((fb.data ?? []) as RecurringTemplate[]).map((row) => ({
          ...row,
          owner_user_id: null,
        }))
      }
      setTemplates(recurringRows)

      const rows = (txData ?? []).map((row) => ({
        ...(row as unknown as FinanceEntry),
        amount: Number((row as { amount: unknown }).amount),
        receipt_path: (row as { receipt_path?: string | null }).receipt_path ?? null,
        receipt_filename: (row as { receipt_filename?: string | null }).receipt_filename ?? null,
        receipt_mime_type: (row as { receipt_mime_type?: string | null }).receipt_mime_type ?? null,
        receipt_size_bytes: (row as { receipt_size_bytes?: number | null }).receipt_size_bytes ?? null,
        auto_post_template_id: (row as { auto_post_template_id?: string | null }).auto_post_template_id ?? null,
        auto_post_month: (row as { auto_post_month?: string | null }).auto_post_month ?? null,
        manually_edited: Boolean((row as { manually_edited?: boolean }).manually_edited),
      }))
      const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))]
      let profileMap = new Map<string, { email: string | null; full_name: string | null; avatar_url: string | null }>()
      if (ownerIds.length) {
        const profileWithAvatar = await supabase
          .from('profiles')
          .select('id,email,full_name,avatar_url')
          .in('id', ownerIds)
        let profs = profileWithAvatar.data as
          | Array<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }>
          | null
        if (profileWithAvatar.error && profileWithAvatar.error.code === '42703') {
          const profileFallback = await supabase.from('profiles').select('id,email,full_name').in('id', ownerIds)
          profs =
            (profileFallback.data as Array<{ id: string; email: string | null; full_name: string | null }> | null)?.map(
              (p) => ({ ...p, avatar_url: null }),
            ) ?? null
        }
        if (profs) {
          profileMap = new Map(
            profs.map((p) => [p.id, { email: p.email, full_name: p.full_name, avatar_url: p.avatar_url ?? null }]),
          )
        }
      }

      const accountRows = (accountData ?? []) as FinancialAccount[]
      setAccounts(accountRows)
      const accountMap = new Map(accountRows.map((a) => [a.id, a.name]))
      const recurringById = new Map(
        recurringRows.map((row) => [
          row.id,
          row as Pick<RecurringTemplate, 'template_start_month' | 'end_rule' | 'end_month' | 'max_installments'> & {
            end_rule: RecurringEndRule
          },
        ]),
      )
      setEntries(
        rows.map((row) => {
          const p = profileMap.get(row.owner_id)
          return {
            ...row,
            owner_email: p?.email ?? null,
            owner_name: p?.full_name ?? null,
            owner_avatar_url: p?.avatar_url ?? null,
            account_name: row.account_id ? accountMap.get(row.account_id) ?? null : null,
            receipt_url: getReceiptPublicUrl(row.receipt_path),
            is_auto_from_recurring: Boolean(row.auto_post_template_id),
            installment_progress_label: (() => {
              if (!row.auto_post_template_id) return null
              const template = recurringById.get(row.auto_post_template_id)
              if (!template) return null
              return installmentProgressLabel({
                asOfMonthKey: monthValue.slice(0, 7),
                template_start_month: template.template_start_month,
                end_rule: template.end_rule,
                end_month: template.end_month,
                max_installments: template.max_installments,
              })
            })(),
          }
        }),
      )
      setHistoryEntries(
        (
          (historyData ?? []) as Array<{
            type: 'income' | 'expense'
            amount: unknown
            occurred_on: string
            planned: boolean
            account_id: string | null
            owner_id: string
          }>
        ).map((row) => ({
          type: row.type,
          amount: Number(row.amount),
          occurred_on: row.occurred_on,
          planned: row.planned,
          account_id: row.account_id ?? null,
          owner_id: row.owner_id,
        })),
      )
      void refreshHouseholdMembers(householdId)
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
        const user = data.session?.user
        setSessionUserId(user?.id ?? null)
        setSessionUserEmail(user?.email ?? null)
        setProfile((prev) => ({
          ...prev,
          email: user?.email ?? null,
          avatar_path: typeof user?.user_metadata?.avatar_path === 'string' ? user.user_metadata.avatar_path : null,
          avatar_url: typeof user?.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null,
        }))
      })
      .finally(() => setAuthLoading(false))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryMode(true)
        setAuthError(null)
        setAuthInfo('הזן סיסמה חדשה ואשר כדי להשלים איפוס.')
      }
      const userId = session?.user.id ?? null
      setSessionUserId(userId)
      setSessionUserEmail(session?.user.email ?? null)
      setProfile((prev) => ({
        ...prev,
        email: session?.user.email ?? null,
        avatar_path:
          typeof session?.user.user_metadata?.avatar_path === 'string' ? session.user.user_metadata.avatar_path : null,
        avatar_url:
          typeof session?.user.user_metadata?.avatar_url === 'string' ? session.user.user_metadata.avatar_url : null,
      }))
      if (!userId) {
        setHousehold(null)
        setEntries([])
        setHistoryEntries([])
        setAccounts([])
        setTemplates([])
        setHouseholdMembers([])
        setProfile({ full_name: null, email: null, avatar_path: null, avatar_url: null })
        setSelectedScope('all')
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !sessionUserId) return
    void bootstrapUserData(sessionUserId, sessionUserEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId, sessionUserEmail])

  useEffect(() => {
    if (!household) return
    void loadMonthlyData(household.id, selectedMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household, selectedMonth])

  useEffect(() => {
    if (!household) return
    writeStoredView(household.id, selectedScope, selectedMonth)
  }, [household, selectedScope, selectedMonth])

  useEffect(() => {
    return () => {
      if (voiceHintTimerRef.current != null) window.clearTimeout(voiceHintTimerRef.current)
    }
  }, [])

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setAuthError(null)
    setAuthInfo(null)
    setAuthLoading(true)
    try {
      if (authMode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: getAuthRedirectTo() },
        })
        if (error) throw error
        setAuthInfo('נרשמת בהצלחה. נשלח מייל אימות. אם לא הגיע, לחץ "שלח שוב מייל אימות".')
        setAuthMode('signin')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'שגיאה בהתחברות.')
    } finally {
      setAuthLoading(false)
    }
  }

  const resendVerificationEmail = async () => {
    if (!supabase || !email.trim()) return
    setResendingVerification(true)
    setAuthError(null)
    setAuthInfo(null)
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: getAuthRedirectTo() },
    })
    if (error) setAuthError(error.message)
    else setAuthInfo('נשלח שוב מייל אימות. בדוק גם ספאם/קידומי מכירות.')
    setResendingVerification(false)
  }

  const sendPasswordResetEmail = async () => {
    if (!supabase || !email.trim()) {
      setAuthError('הזן אימייל כדי לשלוח קישור איפוס')
      return
    }
    setSendingResetEmail(true)
    setAuthError(null)
    setAuthInfo(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: getAuthRedirectTo(),
    })
    if (error) setAuthError(error.message)
    else {
      setResetEmailSent(true)
      setAuthInfo('נשלח מייל איפוס סיסמה. אם לא הגיע, לחץ שוב כדי לשלוח מחדש.')
    }
    setSendingResetEmail(false)
  }

  const completePasswordRecovery = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    if (resetPassword.length < 6) {
      setAuthError('סיסמה חדשה חייבת להכיל לפחות 6 תווים')
      return
    }
    if (resetPassword !== resetPasswordConfirm) {
      setAuthError('הסיסמאות אינן תואמות')
      return
    }
    setUpdatingPassword(true)
    setAuthError(null)
    const { error } = await supabase.auth.updateUser({ password: resetPassword })
    if (error) {
      setAuthError(error.message)
      setUpdatingPassword(false)
      return
    }
    await supabase.auth.signOut()
    setPasswordRecoveryMode(false)
    setResetPassword('')
    setResetPasswordConfirm('')
    setAuthMode('signin')
    setAuthInfo('הסיסמה עודכנה בהצלחה. אפשר להתחבר עם הסיסמה החדשה.')
    setUpdatingPassword(false)
  }

  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const showDockVoiceHint = (message: string) => {
    if (voiceHintTimerRef.current != null) {
      window.clearTimeout(voiceHintTimerRef.current)
      voiceHintTimerRef.current = null
    }
    setDockVoiceHint(message)
    voiceHintTimerRef.current = window.setTimeout(() => {
      setDockVoiceHint(null)
      voiceHintTimerRef.current = null
    }, 3200)
  }

  const openFab = (type: 'expense' | 'income', prefill: AddExpensePrefill = null, full = false) => {
    setSheetType(type)
    setSheetPrefill(prefill)
    setSheetFull(full)
    setSheetOpen(true)
  }

  const startDockVoice = () => {
    voiceStartedRef.current = false
    voiceFailedRef.current = false
    voiceFinishingRef.current = false
    voiceTranscriptRef.current = ''
    setDockTranscript('')
    setAddChooserOpen(false)
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      showDockVoiceHint('הדפדפן לא תומך בהקלטה קולית')
      return
    }
    try {
      voiceRecRef.current?.stop()
    } catch {
      /* already stopped */
    }
    const recognition = new Ctor()
    recognition.lang = 'he-IL'
    recognition.interimResults = true
    recognition.continuous = true
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = transcriptFromSpeechEvent(event)
      if (!transcript) return
      voiceTranscriptRef.current = transcript
      setDockTranscript(transcript)
    }
    recognition.onerror = (event) => {
      const err = event.error
      if (voiceFinishingRef.current || err === 'aborted' || err === 'no-speech') {
        setDockRecording(false)
        return
      }
      voiceFailedRef.current = true
      setDockRecording(false)
      showDockVoiceHint('הקלטה קולית נכשלה')
    }
    recognition.onend = () => setDockRecording(false)
    voiceRecRef.current = recognition
    try {
      recognition.start()
      voiceStartedRef.current = true
      setDockRecording(true)
    } catch {
      voiceFailedRef.current = true
      setDockRecording(false)
      showDockVoiceHint('לא ניתן להתחיל הקלטה')
    }
  }

  const finishDockVoice = () => {
    voiceFinishingRef.current = true
    const rec = voiceRecRef.current
    voiceRecRef.current = null
    try {
      rec?.stop()
    } catch {
      /* ignore */
    }
    const started = voiceStartedRef.current
    const failed = voiceFailedRef.current
    voiceStartedRef.current = false
    voiceFailedRef.current = false
    setDockRecording(false)
    setDockTranscript('')
    if (!started || failed) return
    const parsed = parseVoiceTranscript(voiceTranscriptRef.current, EXPENSE_CATEGORIES)
    openFab('expense', parsed.note || parsed.amount ? parsed : null, true)
  }

  const refreshMonth = () => {
    if (household) void loadMonthlyData(household.id, selectedMonth)
  }

  const handleTransactionSaved = async (saved: { month: string; entry?: FinanceEntry }) => {
    if (!household) return
    const key = saved.month.slice(0, 7)
    if (saved.entry && key === selectedMonth) {
      setEntries((prev) => [saved.entry!, ...prev.filter((e) => e.id !== saved.entry!.id)])
      void loadMonthlyData(household.id, selectedMonth, { silent: true })
      return
    }
    if (key !== selectedMonth) {
      setSelectedMonth(key)
      return
    }
    await loadMonthlyData(household.id, selectedMonth)
  }

  const refreshAfterTemplateChange = () => {
    if (!household || !supabase) return
    const householdId = household.id
    const currentMonthFirstDay = monthValueToFirstDay(getLocalMonthValue())
    const viewerMonthFirstDay = monthValueToFirstDay(selectedMonth)
    const monthsToSync = new Set<string>([viewerMonthFirstDay, currentMonthFirstDay])

    void (async () => {
      try {
        let firstErr: Error | null = null
        for (const p_month of monthsToSync) {
          const { error: rpcErr } = await supabase.rpc('ensure_auto_post_transactions_from_templates', {
            p_household: householdId,
            p_month,
          })
          if (rpcErr && !firstErr) firstErr = new Error(rpcErr.message ?? 'RPC failed')
        }
        setRecurringRpcError(firstErr ? firstErr.message : null)
      } catch (e) {
        setRecurringRpcError(e instanceof Error ? e.message : 'סנכרון תנועות מקבועים נכשל')
      }
      await loadMonthlyData(householdId, selectedMonth)
    })()
  }

  const uploadProfilePhoto = async (file: File) => {
    if (!supabase || !sessionUserId) return { ok: false, message: 'אין משתמש מחובר' }
    try {
      const uploaded = await uploadProfileImage({
        file,
        userId: sessionUserId,
        previousPath: profile.avatar_path,
      })
      setProfile((prev) => ({
        ...prev,
        avatar_path: uploaded.avatar_path,
        avatar_url: uploaded.avatar_url,
      }))
      return {
        ok: true,
        message: 'תמונת פרופיל הועלתה בהצלחה',
        avatar_path: uploaded.avatar_path,
        avatar_url: uploaded.avatar_url ?? '',
      }
    } catch (error) {
      return { ok: false, message: `העלאת תמונה נכשלה: ${describeError(error)}` }
    }
  }

  const saveProfile = async (next: { full_name: string; avatar_url: string; avatar_path: string }) => {
    if (!supabase || !sessionUserId) return { ok: false, message: 'אין משתמש מחובר' }
    try {
      const trimmedName = next.full_name.trim()
      const trimmedAvatar = next.avatar_url.trim()
      const trimmedAvatarPath = next.avatar_path.trim()
      let updateProfileError = (
        await supabase
          .from('profiles')
          .update({
            full_name: trimmedName || null,
            avatar_url: trimmedAvatar || null,
          })
          .eq('id', sessionUserId)
      ).error
      if (updateProfileError && updateProfileError.code === '42703') {
        updateProfileError = (
          await supabase
            .from('profiles')
            .update({
              full_name: trimmedName || null,
            })
            .eq('id', sessionUserId)
        ).error
      }
      if (updateProfileError) throw updateProfileError

      const { error: updateAuthError } = await supabase.auth.updateUser({
        data: {
          avatar_url: trimmedAvatar || null,
          avatar_path: trimmedAvatarPath || null,
        },
      })
      if (updateAuthError) throw updateAuthError

      setProfile((prev) => ({
        ...prev,
        full_name: trimmedName || null,
        avatar_path: trimmedAvatarPath || null,
        avatar_url: trimmedAvatar || null,
      }))
      if (household?.id) void refreshHouseholdMembers(household.id)
      return { ok: true, message: 'הפרופיל נשמר בהצלחה' }
    } catch (error) {
      return { ok: false, message: `שמירת פרופיל נכשלה: ${describeError(error)}` }
    }
  }

  async function renameHousehold(name: string): Promise<{ ok: boolean; message: string }> {
    if (!supabase || !household) return { ok: false, message: 'אין חיבור לשרת' }
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, message: 'הזן שם משפחה / בית' }
    try {
      const { error } = await supabase.rpc('rename_household', {
        p_household_id: household.id,
        p_name: trimmed,
      })
      if (error) throw error
      setHousehold((h) => (h ? { ...h, name: trimmed } : h))
      return { ok: true, message: 'שם הבית נשמר. כל חברי הבית יראו אותו.' }
    } catch (error) {
      return { ok: false, message: describeError(error) }
    }
  }

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

        {isSupabaseConfigured && passwordRecoveryMode ? (
          <section className="card auth-card">
            <h2>איפוס סיסמה</h2>
            <form onSubmit={completePasswordRecovery} className="stack">
              <label>
                סיסמה חדשה
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </label>
              <label>
                אימות סיסמה חדשה
                <input
                  type="password"
                  value={resetPasswordConfirm}
                  onChange={(e) => setResetPasswordConfirm(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </label>
              <button type="submit" className="btn-primary" disabled={updatingPassword}>
                {updatingPassword ? 'מעדכן…' : 'עדכן סיסמה'}
              </button>
            </form>
            {authError ? <p className="inline-status">{authError}</p> : null}
            {authInfo ? <p className="inline-status">{authInfo}</p> : null}
          </section>
        ) : null}

        {isSupabaseConfigured && !sessionUserId && !passwordRecoveryMode ? (
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
                setAuthInfo(null)
              }}
            >
              {authMode === 'signin' ? 'אין חשבון? הרשמה' : 'יש חשבון? התחברות'}
            </button>
            <button
              type="button"
              className="link-btn"
              disabled={resendingVerification || !email.trim()}
              onClick={() => void resendVerificationEmail()}
            >
              {resendingVerification ? 'שולח…' : 'שלח שוב מייל אימות'}
            </button>
            {authMode === 'signin' ? (
              <button
                type="button"
                className="link-btn"
                disabled={sendingResetEmail || !email.trim()}
                onClick={() => void sendPasswordResetEmail()}
              >
                {sendingResetEmail
                  ? 'שולח…'
                  : resetEmailSent
                    ? 'שלח שוב מייל איפוס סיסמה'
                    : 'שכחתי סיסמה — שלח מייל איפוס'}
              </button>
            ) : null}
            {authError ? <p className="inline-status">{authError}</p> : null}
            {authInfo ? <p className="inline-status">{authInfo}</p> : null}
          </section>
        ) : null}

        {sessionUserId && household && !passwordRecoveryMode ? (
          <>
            <header className="app-chrome">
              <div className="app-chrome-top">
                <span className="app-household-title">{household.name}</span>
                <MonthChrome value={selectedMonth} onChange={setSelectedMonth} />
                <button type="button" className="icon-btn" aria-label="הגדרות" onClick={() => setSettingsOpen(true)}>
                  ⚙
                </button>
              </div>
              {accounts.length ? (
                <AccountFilterBar
                  accounts={accounts}
                  members={householdMembers}
                  currentUserId={sessionUserId}
                  value={selectedScope}
                  onChange={setSelectedScope}
                />
              ) : null}
            </header>
            <div key={screen} className="screen-fade">
              {recurringRpcError ? (
                <p className="banner-msg banner-msg-warn">
                  לא סונכרנו תנועות מהקבוע לחודש הנוכחי: {recurringRpcError}{' '}
                  <button type="button" className="link-inline" onClick={() => setRecurringRpcError(null)}>
                    סגור
                  </button>
                </p>
              ) : null}
              {screen === 'dashboard' ? (
                <Dashboard
                  selectedMonth={selectedMonth}
                  entries={scopedEntries}
                  historyEntries={scopedHistoryEntries}
                  templates={scopedTemplates}
                  householdId={household.id}
                  loading={loadingData}
                  scope={selectedScope}
                  accounts={accounts}
                  members={householdMembers}
                  currentUserId={sessionUserId}
                />
              ) : null}

              {screen === 'transactions' ? (
                <TransactionsView
                  entries={scopedEntries}
                  selectedMonth={selectedMonth}
                  householdId={household.id}
                  sessionUserId={sessionUserId}
                  householdMembers={householdMembers}
                  accounts={accounts}
                  selectedAccountId={defaultAccountId}
                  loading={loadingData}
                  onRefresh={refreshMonth}
                  onOptimisticRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
                  onOptimisticRestore={(entry) => setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)])}
                  onOptimisticUpdate={(entry) =>
                    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...entry } : e)))
                  }
                />
              ) : null}

              {screen === 'recurring' ? (
                <RecurringTemplatesPanel
                  householdId={household.id}
                  selectedMonth={selectedMonth}
                  onTemplatesChanged={refreshAfterTemplateChange}
                  members={householdMembers}
                  currentUserId={sessionUserId}
                  scope={selectedScope}
                />
              ) : null}
            </div>
          </>
        ) : null}

        {sessionUserId && !household && !passwordRecoveryMode ? (
          <AppBootScreen statusMessage={statusMessage} />
        ) : null}

        {sessionUserId && household && statusMessage ? <p className="banner-msg">{statusMessage}</p> : null}

        {authLoading && !sessionUserId ? <p className="muted center">בודק משתמש…</p> : null}
      </main>

      {sessionUserId && household && !passwordRecoveryMode ? (
        <>
          <BottomNav
            active={screen === 'settings' ? 'dashboard' : screen}
            onChange={setScreen}
            onAdd={() => setAddChooserOpen(true)}
            onVoiceStart={startDockVoice}
            onVoiceEnd={finishDockVoice}
            recording={dockRecording}
          />
          {addChooserOpen ? (
            <div className="sheet-backdrop" onClick={() => setAddChooserOpen(false)}>
              <div className="add-chooser" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="add-chooser-btn add-chooser-expense"
                  onClick={() => {
                    setAddChooserOpen(false)
                    openFab('expense')
                  }}
                >
                  הוצאה
                </button>
                <button
                  type="button"
                  className="add-chooser-btn add-chooser-income"
                  onClick={() => {
                    setAddChooserOpen(false)
                    openFab('income')
                  }}
                >
                  הכנסה
                </button>
              </div>
            </div>
          ) : null}
          {dockRecording ? (
            <div className="voice-record-overlay" aria-live="polite" aria-busy="true">
              <div className="voice-record-card">
                <div className="voice-record-mic" aria-hidden>
                  <span className="voice-record-waves">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <p className="voice-record-title">מקליט…</p>
                <p className="voice-record-hint">שחררו כדי להוסיף</p>
                {dockTranscript ? <p className="voice-record-transcript">{dockTranscript}</p> : null}
              </div>
            </div>
          ) : null}
          {dockVoiceHint ? (
            <p className="dock-voice-hint" role="status">
              {dockVoiceHint}
            </p>
          ) : null}
          <AddExpenseSheet
            open={sheetOpen}
            onClose={() => {
              setSheetOpen(false)
              setSheetPrefill(null)
              setSheetFull(false)
            }}
            householdId={household.id}
            sessionUserId={sessionUserId}
            householdMembers={householdMembers}
            accounts={accounts}
            initialType={sheetType}
            prefill={sheetPrefill}
            defaultMonth={selectedMonth}
            fullScreen={sheetFull}
            onSaved={handleTransactionSaved}
          />
          <SettingsSheet
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            householdId={household.id}
            householdName={household.name}
            profile={profile}
            onSaveProfile={saveProfile}
            onUploadProfilePhoto={uploadProfilePhoto}
            onHouseholdJoined={() => {
              if (sessionUserId) void bootstrapUserData(sessionUserId, sessionUserEmail)
            }}
            onRenameHousehold={renameHousehold}
            onSignOut={signOut}
          />
        </>
      ) : null}
    </div>
  )
}

export default App
