import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { chatWithAssistant } from '../lib/assistantClient'
import type { AssistantAction, AssistantChatMessage } from '../lib/assistantClient'
import type { CompactLedger } from '../lib/assistantContext'
import type { AddExpensePrefill } from './AddExpenseSheet'

type AssistantViewProps = {
  householdId: string
  sessionUserId: string
  ledger: CompactLedger
  scopeMode: 'personal' | 'shared'
  onScopeModeChange: (scope: 'personal' | 'shared') => void
  onPrefillAddExpense: (type: 'expense' | 'income', prefill: AddExpensePrefill) => void
}

type DbMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  action?: AssistantAction
}

const QUICK_PROMPTS = [
  'מה ההוצאות הגדולות החודש?',
  'כמה הוצאתי על מזון החודש?',
  'איך אני עומד מול חודש קודם?',
  'תוסיף הוצאה של 120 שח על חשמל',
]

const HISTORY_LIMIT = 50

function actionFromAssistantContent(content: string): AssistantAction | undefined {
  const idx = content.lastIndexOf('\n\n[[action]]')
  if (idx < 0) return undefined
  const json = content.slice(idx + '\n\n[[action]]'.length).trim()
  try {
    const parsed = JSON.parse(json) as AssistantAction
    if (parsed?.type === 'add_transaction') return parsed
  } catch {
    /* ignore */
  }
  return undefined
}

function visibleAssistantContent(content: string): string {
  const idx = content.lastIndexOf('\n\n[[action]]')
  if (idx < 0) return content
  return content.slice(0, idx).trim()
}

export function AssistantView({
  householdId,
  sessionUserId,
  ledger,
  scopeMode,
  onScopeModeChange,
  onPrefillAddExpense,
}: AssistantViewProps) {
  const [messages, setMessages] = useState<DbMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const tempIdRef = useRef(0)
  const tempIdPrefix = useId()

  useEffect(() => {
    const load = async () => {
      if (!supabase) {
        setLoading(false)
        return
      }
      const { data, error: qErr } = await supabase
        .from('assistant_messages')
        .select('id,role,content,created_at')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT)
      if (qErr) {
        setError(qErr.message)
        setLoading(false)
        return
      }
      const list = ((data ?? []) as DbMessage[]).reverse()
      setMessages(
        list.map((m) =>
          m.role === 'assistant' ? { ...m, action: actionFromAssistantContent(m.content) } : m,
        ),
      )
      setLoading(false)
    }
    void load()
  }, [householdId])

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [messages.length, sending])

  const conversationForApi: AssistantChatMessage[] = useMemo(
    () =>
      messages.map((m) => ({
        role: m.role,
        content: m.role === 'assistant' ? visibleAssistantContent(m.content) : m.content,
      })),
    [messages],
  )

  const send = async (text: string) => {
    if (!supabase) return
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError(null)
    setDraft('')

    tempIdRef.current += 1
    const userTempId = `tmp-${tempIdPrefix}-${tempIdRef.current}`
    const userMessage: DbMessage = {
      id: userTempId,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMessage])

    const persistUser = supabase
      .from('assistant_messages')
      .insert({
        household_id: householdId,
        owner_id: sessionUserId,
        role: 'user',
        content: trimmed,
      })
      .select('id,role,content,created_at')
      .single()

    try {
      const apiMessages: AssistantChatMessage[] = [
        ...conversationForApi,
        { role: 'user', content: trimmed },
      ]
      const { reply, action } = await chatWithAssistant({ messages: apiMessages, ledger })
      const persisted = await persistUser
      if (persisted.error) throw new Error(persisted.error.message)
      const persistedUser = persisted.data as DbMessage

      const assistantContentForDb = action
        ? `${reply}\n\n[[action]]${JSON.stringify(action)}`
        : reply

      const { data: assistantInserted, error: asstErr } = await supabase
        .from('assistant_messages')
        .insert({
          household_id: householdId,
          owner_id: sessionUserId,
          role: 'assistant',
          content: assistantContentForDb,
        })
        .select('id,role,content,created_at')
        .single()
      if (asstErr) throw new Error(asstErr.message)
      const persistedAssistant = assistantInserted as DbMessage

      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== userTempId)
        return [
          ...withoutTemp,
          persistedUser,
          { ...persistedAssistant, action },
        ]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה')
      setMessages((prev) => prev.filter((m) => m.id !== userTempId))
    } finally {
      setSending(false)
    }
  }

  const clearHistory = async () => {
    if (!supabase) return
    if (!window.confirm('למחוק את כל ההיסטוריה של ההודעות שלך?')) return
    const { error: delErr } = await supabase
      .from('assistant_messages')
      .delete()
      .eq('household_id', householdId)
      .eq('owner_id', sessionUserId)
    if (delErr) {
      setError(delErr.message)
      return
    }
    setMessages([])
  }

  const onActionConfirm = (action: AssistantAction) => {
    onPrefillAddExpense(action.payload.type, {
      amount: action.payload.amount ? String(action.payload.amount) : '',
      note: action.payload.note ?? '',
      category: action.payload.category ?? '',
      customCategory: '',
    })
  }

  return (
    <div className="screen-pad assistant-screen">
      <div className="assistant-header card">
        <div className="card-heading-row">
          <h2 className="card-heading">עוזר אישי</h2>
          <div className="row-actions">
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => void clearHistory()}
              disabled={!messages.length}
            >
              נקה היסטוריה
            </button>
          </div>
        </div>
        <p className="muted small">{`חודש: ${ledger.current_month} · ${scopeMode === 'shared' ? 'משותף (כולם)' : 'אישי (רק שלי)'} · ${ledger.recent_transactions.length} תנועות אחרונות`}</p>
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

      <div className="chat-thread" ref={scrollerRef}>
        {loading ? <p className="muted">טוען היסטוריה…</p> : null}
        {!loading && !messages.length ? (
          <div className="chat-empty">
            <p className="muted">
              שלום! אני העוזר הפיננסי שלך. שאל אותי על ההוצאות, ההכנסות או הקבועים שלך, ואני אענה לפי הנתונים שלך
              במערכת.
            </p>
            <div className="chat-quick">
              {QUICK_PROMPTS.map((p) => (
                <button key={p} type="button" className="chat-chip" onClick={() => void send(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble chat-${m.role}`}>
            <div className="chat-content">
              {m.role === 'assistant' ? visibleAssistantContent(m.content) : m.content}
            </div>
            {m.role === 'assistant' && m.action ? (
              <div className="chat-action-row">
                <button
                  type="button"
                  className="btn-primary btn-xs"
                  onClick={() => onActionConfirm(m.action!)}
                >
                  פתח טופס לאישור
                </button>
              </div>
            ) : null}
          </div>
        ))}
        {sending ? (
          <div className="chat-bubble chat-assistant" aria-live="polite">
            <div className="chat-content muted chat-thinking">
              <span className="thinking-dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
              <span className="sr-only">חושב</span>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <p className="sheet-error">{error}</p> : null}

      <form
        className="chat-input-row card"
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
      >
        <textarea
          className="chat-input"
          value={draft}
          placeholder="כתוב שאלה או בקשה…"
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          disabled={sending}
        />
        <button
          type="submit"
          className={sending ? 'btn-primary chat-send btn-loading' : 'btn-primary chat-send'}
          disabled={sending || !draft.trim()}
          aria-busy={sending}
        >
          <span className="btn-label">שלח</span>
          {sending ? (
            <span className="btn-spinner thinking-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          ) : null}
        </button>
      </form>
    </div>
  )
}
