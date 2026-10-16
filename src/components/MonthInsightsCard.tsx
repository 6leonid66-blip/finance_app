import { useMemo, useState } from 'react'
import type { FinanceEntry, FinancialAccount, HouseholdMemberBrief } from '../types'
import type { MemberScope } from '../lib/memberScope'
import {
  computeTogetherBreakdown,
  localAdvisorSummary,
  monthLabelHe,
} from '../lib/togetherBreakdown'
import type { InsightSnapshot } from '../lib/insightSnapshot'
import { supabase } from '../supabase'

type MonthInsightsCardProps = {
  selectedMonth: string
  entries: FinanceEntry[]
  accounts: FinancialAccount[]
  members: HouseholdMemberBrief[]
  currentUserId: string
  scope: MemberScope
}

function scopeLabel(scope: MemberScope, members: HouseholdMemberBrief[]): string {
  if (scope === 'all') return 'ביחד — כל הבית'
  if (scope === 'shared') return 'חשבון משותף'
  const id = scope.startsWith('user:') ? scope.slice(5) : ''
  const name = members.find((m) => m.userId === id)?.displayName
  return name ? `תצוגה של ${name}` : 'תצוגה אישית'
}

export function MonthInsightsCard({
  selectedMonth,
  entries,
  accounts,
  members,
  currentUserId,
  scope,
}: MonthInsightsCardProps) {
  const breakdown = useMemo(
    () => computeTogetherBreakdown(entries, accounts, members, currentUserId),
    [entries, accounts, members, currentUserId],
  )
  const [text, setText] = useState('')
  const [source, setSource] = useState<'ai' | 'local' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const snapshot: InsightSnapshot = {
    monthKey: selectedMonth.slice(0, 7),
    monthLabel: monthLabelHe(selectedMonth),
    scopeLabel: scopeLabel(scope, members),
    household: {
      income: breakdown.household.income,
      expense: breakdown.household.expense,
      remaining: breakdown.household.remaining,
    },
    people: breakdown.people.map((p) => ({
      name: p.name,
      income: p.income,
      expense: p.expense,
      remaining: p.remaining,
      topExpenses: p.topExpenses,
    })),
    shared: {
      income: breakdown.shared.income,
      expense: breakdown.shared.expense,
      remaining: breakdown.shared.remaining,
      topExpenses: breakdown.shared.topExpenses,
    },
    householdTopExpenses: breakdown.household.topExpenses,
  }

  const generate = async () => {
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      const session = await supabase?.auth.getSession()
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.data.session?.access_token ?? ''}` },
        body: JSON.stringify({ snapshot }),
        signal: AbortSignal.timeout(40_000),
      })
      const data = (await response.json()) as { text?: string; error?: string }
      if (response.ok && data.text?.trim()) {
        setText(data.text.trim())
        setSource('ai')
        return
      }
      const fallback = localAdvisorSummary(selectedMonth, breakdown)
      setText(fallback)
      setSource('local')
      setError(data.error || 'יצירת תובנות ה-AI לא הושלמה. מוצג סיכום מקומי מהנתונים.')
    } catch {
      setText(localAdvisorSummary(selectedMonth, breakdown))
      setSource('local')
      setError('אין חיבור ל-AI. הוצג סיכום מקומי מהחודש הנבחר.')
    } finally {
      setLoading(false)
    }
  }

  const copyText = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('ההעתקה נכשלה')
    }
  }

  const downloadText = () => {
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `תובנות-משק-בית-${selectedMonth.slice(0, 7)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card month-insights-card">
      <h2 className="card-heading">תובנות והמלצות</h2>
      <p className="muted small">
        יועץ משק בית לפי {monthLabelHe(selectedMonth)}
        {members.length ? ` · ${members.map((m) => m.displayName).join(' ו')}` : ''}
      </p>
      <button type="button" className="btn-primary insights-generate-btn" disabled={loading} onClick={() => void generate()}>
        {loading ? 'מייצר תובנות…' : 'יצירת המלצות ותובנות מ-AI'}
      </button>
      {loading && <p role="status" className="banner-msg">מנתחים את נתוני החודש… הפעולה עשויה להימשך עד 40 שניות.</p>}
      {error ? <p role="alert" className="banner-msg">{error}</p> : null}
      {text ? (
        <>
          <pre className="insights-output">{text}</pre>
          <div className="insights-actions">
            <button type="button" className="btn-secondary" onClick={() => void copyText()}>
              {copied ? 'הועתק' : 'העתק טקסט'}
            </button>
            <button type="button" className="btn-secondary" onClick={downloadText}>
              הורד מסמך
            </button>
            {source === 'ai' ? <span className="muted small">נוצר מ-AI</span> : <span className="muted small">סיכום מהנתונים</span>}
          </div>
        </>
      ) : null}
    </section>
  )
}
