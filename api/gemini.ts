export const config = {
  runtime: 'edge',
}

const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest',
]

type GeminiResponseShape = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
}

type GoogleErrorPayload = {
  error?: {
    status?: string
    message?: string
    details?: Array<{ reason?: string }>
  }
}

type ProxyError = {
  ok: false
  status: number
  reason: string
  message: string
}

type ProxyResultJson = {
  ok: true
  kind: 'receipt' | 'voice'
  amount?: number
  description?: string
  suggestedCategory?: string
}

type ProxyResultText = {
  ok: true
  kind: 'advice'
  text: string
}

type ParsedStatementRow = {
  occurred_on: string
  amount: number
  type: 'expense' | 'income'
  description?: string
}

type ProxyResultStatement = {
  ok: true
  kind: 'statement'
  items: ParsedStatementRow[]
  truncated?: boolean
}

type AssistantAction = {
  type: 'add_transaction'
  payload: {
    type: 'expense' | 'income'
    amount?: number
    note?: string
    category?: string
  }
}

type ProxyResultChat = {
  ok: true
  kind: 'chat'
  reply: string
  action?: AssistantAction
  grounded?: boolean
}

type ProxyResult = ProxyResultJson | ProxyResultText | ProxyResultStatement | ProxyResultChat | ProxyError

function jsonResponse(body: ProxyResult, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function clampString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

function normalizeAmount(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw !== 'string') return undefined
  const sanitized = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  const num = Number(sanitized)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return num
}

function isToolUnsupportedError(failure: { status: number; reason: string; message: string }): boolean {
  if (failure.status !== 400) return false
  const haystack = `${failure.reason} ${failure.message}`.toLowerCase()
  return (
    haystack.includes('googlesearch') ||
    haystack.includes('google_search') ||
    haystack.includes('grounding') ||
    (haystack.includes('tool') && (haystack.includes('not supported') || haystack.includes('unsupported') || haystack.includes('unknown')))
  )
}

async function callGemini(params: {
  apiKey: string
  body: string
}): Promise<{ ok: true; data: GeminiResponseShape } | { ok: false; status: number; reason: string; message: string }> {
  let lastStatus = 0
  let lastReason = ''
  let lastMessage = ''
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${params.apiKey}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: params.body,
    })
    if (response.ok) {
      const data = (await response.json()) as GeminiResponseShape
      return { ok: true, data }
    }
    lastStatus = response.status
    let payload: GoogleErrorPayload | null = null
    try {
      payload = (await response.json()) as GoogleErrorPayload
    } catch {
      // Ignore non-JSON Google error bodies and keep payload as null.
    }
    lastReason = payload?.error?.details?.[0]?.reason ?? payload?.error?.status ?? ''
    lastMessage = payload?.error?.message ?? ''
    console.error('[gemini-proxy]', model, response.status, lastReason || lastMessage)
    if (response.status !== 404) {
      return { ok: false, status: response.status, reason: lastReason, message: lastMessage }
    }
  }
  return { ok: false, status: lastStatus || 404, reason: lastReason || 'MODEL_NOT_FOUND', message: lastMessage || 'No supported Gemini model is available for this key.' }
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseStrictJsonText(text: string): { amount?: unknown; description?: unknown; suggestedCategory?: unknown } | null {
  try {
    return JSON.parse(text) as { amount?: unknown; description?: unknown; suggestedCategory?: unknown }
  } catch {
    return null
  }
}

function buildReceiptPrompt(categories: readonly string[]): string {
  return `Analyze this Hebrew receipt / check / income document image and return only JSON.\nJSON keys:\n- amount: number (total amount in ILS)\n- description: informative Hebrew description (up to 90 chars) explaining what this is. Include the store/payer name and the main items or service. Examples: "שופרסל - חלב, לחם, פירות", "משכורת מ-Acme בעמ", "תדלוק בסונול 30 ליטר".\n- suggestedCategory: choose one exact value from this list: ${categories.join(', ')}\nIf uncertain, set suggestedCategory to "אחר".`
}

function buildVoicePrompt(spokenText: string, categories: readonly string[]): string {
  return `You are a Hebrew finance entry parser. The user dictated either an expense or an income.\nConvert the spoken text into strict JSON only.\nJSON keys:\n- amount: number (ILS, required if detectable)\n- description: informative Hebrew description (up to 90 chars) summarizing what the user said: who/where + what. Keep wording close to the user's intent. Example: "קניתי גבינות וגלידה ברמי לוי", "קיבלתי החזר ביטוח לאומי".\n- suggestedCategory: one exact value from this list: ${categories.join(', ')}\nIf uncertain about category set "אחר".\nSpoken text: """${spokenText}"""`
}

function buildAdvicePrompt(month: string, summary: string): string {
  return `You are a household finance advisor for an Israeli family.\nWrite your response in Hebrew.\nKeep it practical and short (4 bullet points max).\nData month: ${month}\nData summary:\n${summary}\nReturn plain text only.`
}

const STATEMENT_JSON_SCHEMA_HINT =
  'Return a single JSON object: { "items": ParsedRow[] }. Each ParsedRow: { "occurred_on": "YYYY-MM-DD", "amount": positive number (no sign), "type": "expense" | "income", "description": short Hebrew string (up to 80 chars) }. Hebrew column hints: תאריך / תאריך עסקה / תאריך חיוב → occurred_on. סכום / חיוב / זכות → amount; if value or column indicates חובה / negative / -123.45 the type is "expense"; if זכות / positive the type is "income". תיאור / פירוט / שם בית עסק / שם העסק → description. Skip header rows, balance-only rows, totals rows. Output JSON only.'

function buildStatementMapPrompt(rows: unknown[]): string {
  return `You are an Israeli bank / credit-card statement parser.\n${STATEMENT_JSON_SCHEMA_HINT}\nRaw rows (first ${rows.length}):\n${JSON.stringify(rows).slice(0, 60_000)}`
}

function buildStatementImagePrompt(): string {
  return `You are an Israeli bank / credit-card statement parser. Read the attached file (PDF or image) and extract every transaction line you can identify.\n${STATEMENT_JSON_SCHEMA_HINT}`
}

function buildChatSystemPrompt(): string {
  return [
    'אתה עוזר פיננסי אישי למשפחה ישראלית. ענה תמיד בעברית, קצר וברור.',
    'חוק ברזל: לעולם אל תמציא מספרים, שמות, קטגוריות או תאריכים. כל נתון פיננסי אישי חייב להגיע אך ורק מ-JSON של הקלסר (ledger) שצורף.',
    'אם המשתמש שואל שאלה שדורשת נתון שאינו מופיע בקלסר, ענה במפורש: "אני לא רואה את הנתון הזה בקלסר שלך — אם תרצה, אני יכול להציע איך למצוא אותו", והצע כיוון או שאלת המשך ממוקדת. אל תיתן מספר מנוחש.',
    'אל תיתן תשובות סתמיות שמסיימות את השיחה. תמיד הצע כיוון, סיכום, או שאלת המשך קצרה כדי להמשיך לעזור — גם כשאתה מבקש הבהרה.',
    'אם השאלה לא ברורה (למשל "איזה חודש?", "אישי או משותף?"), שאל שאלת הבהרה אחת קצרה, אבל גם תן מיד את הניתוח הטוב ביותר שאתה יכול על בסיס הנתונים הקיימים — אל תדחה את כל התשובה לבירור.',
    'לשאלות מסוג "ההוצאה הכי נמוכה / הכי גבוהה החודש": בדוק קודם את ledger.month_min_expense ו-ledger.month_max_expense. אם השדה קיים, השתמש בו מילולית וצטט את התנועה התואמת (סכום, קטגוריה, תאריך, הערה). רק אם השדה null, סרוק את ledger.month_transactions.',
    'אם המשתמש מתקן אותך או מציין פריט שלא הזכרת ("אבל יש לי אינטרנט ב-40 ש\\"ח"), אל תסכים אוטומטית עם המספר שהוא נקב. בדוק שוב ב-ledger.month_transactions וב-ledger.recent_transactions, ועדכן את התשובה רק אם הפריט באמת קיים שם בדיוק. אם הוא לא נמצא, אמור זאת בעדינות.',
    'לשאלות חיצוניות / עכשוויות (שערי מטבע, מחירים, חדשות, ידע כללי, הגדרות) — מותר לך להשתמש בכלי החיפוש googleSearch שסופק לך כדי להביא מידע עדכני. אל תשתמש בחיפוש אינטרנט עבור הנתונים האישיים של המשתמש; הם תמיד באים מ-ledger בלבד.',
    'כשהמשתמש מבקש להוסיף הוצאה או הכנסה, החזר *בסוף* התשובה בלבד בלוק JSON אחד בפורמט הבא, בתוך ```json ... ```:',
    '{ "action": "add_transaction", "type": "expense"|"income", "amount": number, "category": string, "note": string }',
    'בכל מקרה אחר אל תכלול בלוק JSON. אל תוסיף הסברים על ה-JSON.',
  ].join('\n')
}

const ACTION_BLOCK_REGEX = /```json\s*([\s\S]+?)```\s*$/i

function parseAssistantAction(reply: string): { reply: string; action?: AssistantAction } {
  const match = reply.match(ACTION_BLOCK_REGEX)
  if (!match) return { reply: reply.trim() }
  const jsonText = match[1].trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { reply: reply.trim() }
  }
  if (!parsed || typeof parsed !== 'object') return { reply: reply.trim() }
  const obj = parsed as Record<string, unknown>
  if (obj.action !== 'add_transaction') return { reply: reply.trim() }
  const txnType = obj.type === 'income' ? 'income' : obj.type === 'expense' ? 'expense' : null
  if (!txnType) return { reply: reply.trim() }
  const cleanReply = reply.replace(ACTION_BLOCK_REGEX, '').trim()
  return {
    reply: cleanReply,
    action: {
      type: 'add_transaction',
      payload: {
        type: txnType,
        amount: normalizeAmount(obj.amount),
        category: clampString(obj.category, 40),
        note: clampString(obj.note, 200),
      },
    },
  }
}

function parseStatementItems(text: string): ParsedStatementRow[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const list = (parsed as { items?: unknown }).items
  if (!Array.isArray(list)) return null
  const out: ParsedStatementRow[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const occurred = typeof row.occurred_on === 'string' ? row.occurred_on.trim().slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred)) continue
    const amt = normalizeAmount(row.amount)
    if (typeof amt !== 'number') continue
    const type = row.type === 'income' ? 'income' : row.type === 'expense' ? 'expense' : null
    if (!type) continue
    const description = clampString(row.description, 120)
    out.push({ occurred_on: occurred, amount: amt, type, description })
  }
  return out
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, status: 405, reason: 'METHOD_NOT_ALLOWED', message: 'Use POST' }, 405)
  }

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    return jsonResponse({ ok: false, status: 500, reason: 'MISSING_KEY', message: 'GEMINI_API_KEY is not set on the server.' }, 500)
  }

  const body = (await readBody(request)) as
    | {
        kind?: string
        categories?: unknown
        imageBase64?: unknown
        mimeType?: unknown
        spokenText?: unknown
        month?: unknown
        summary?: unknown
        rows?: unknown
        fileBase64?: unknown
        messages?: unknown
        ledger?: unknown
      }
    | null

  if (!body || typeof body !== 'object') {
    return jsonResponse({ ok: false, status: 400, reason: 'BAD_BODY', message: 'Missing JSON body' }, 400)
  }

  const kind = body.kind
  console.log('[gemini-proxy] request kind:', kind)

  if (kind === 'receipt') {
    const categories = Array.isArray(body.categories) ? (body.categories.filter((c) => typeof c === 'string') as string[]) : []
    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
    const mimeType = typeof body.mimeType === 'string' && body.mimeType ? body.mimeType : 'image/jpeg'
    if (!imageBase64) {
      return jsonResponse({ ok: false, status: 400, reason: 'BAD_IMAGE', message: 'imageBase64 is required' }, 400)
    }
    const prompt = buildReceiptPrompt(categories)
    const result = await callGemini({
      apiKey,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    })
    if (!result.ok) {
      return jsonResponse({ ok: false, status: result.status, reason: result.reason, message: result.message }, result.status >= 400 && result.status < 600 ? result.status : 502)
    }
    const text = result.data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const parsed = parseStrictJsonText(text)
    if (!parsed) {
      return jsonResponse({ ok: false, status: 502, reason: 'BAD_JSON', message: 'Gemini did not return valid JSON' }, 502)
    }
    return jsonResponse(
      {
        ok: true,
        kind: 'receipt',
        amount: normalizeAmount(parsed.amount),
        description: clampString(parsed.description, 100),
        suggestedCategory: clampString(parsed.suggestedCategory, 40),
      },
      200,
    )
  }

  if (kind === 'voice') {
    const categories = Array.isArray(body.categories) ? (body.categories.filter((c) => typeof c === 'string') as string[]) : []
    const spokenText = typeof body.spokenText === 'string' ? body.spokenText.trim() : ''
    if (!spokenText) {
      return jsonResponse({ ok: false, status: 400, reason: 'BAD_VOICE', message: 'spokenText is required' }, 400)
    }
    const prompt = buildVoicePrompt(spokenText, categories)
    const result = await callGemini({
      apiKey,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    })
    if (!result.ok) {
      return jsonResponse({ ok: false, status: result.status, reason: result.reason, message: result.message }, result.status >= 400 && result.status < 600 ? result.status : 502)
    }
    const text = result.data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const parsed = parseStrictJsonText(text)
    if (!parsed) {
      return jsonResponse({ ok: false, status: 502, reason: 'BAD_JSON', message: 'Gemini did not return valid JSON' }, 502)
    }
    return jsonResponse(
      {
        ok: true,
        kind: 'voice',
        amount: normalizeAmount(parsed.amount),
        description: clampString(parsed.description, 100),
        suggestedCategory: clampString(parsed.suggestedCategory, 40),
      },
      200,
    )
  }

  if (kind === 'advice') {
    const month = typeof body.month === 'string' ? body.month : ''
    const summary = typeof body.summary === 'string' ? body.summary : ''
    if (!month || !summary) {
      return jsonResponse({ ok: false, status: 400, reason: 'BAD_ADVICE', message: 'month and summary are required' }, 400)
    }
    const prompt = buildAdvicePrompt(month, summary)
    const result = await callGemini({
      apiKey,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    })
    if (!result.ok) {
      return jsonResponse({ ok: false, status: result.status, reason: result.reason, message: result.message }, result.status >= 400 && result.status < 600 ? result.status : 502)
    }
    const text = result.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    if (!text) {
      return jsonResponse({ ok: false, status: 502, reason: 'EMPTY_TEXT', message: 'Gemini did not return text' }, 502)
    }
    return jsonResponse({ ok: true, kind: 'advice', text }, 200)
  }

  if (kind === 'statement-map') {
    const rawRows = Array.isArray(body.rows) ? (body.rows as unknown[]) : null
    if (!rawRows || !rawRows.length) {
      return jsonResponse({ ok: false, status: 400, reason: 'BAD_ROWS', message: 'rows must be a non-empty array' }, 400)
    }
    const truncated = rawRows.length > 500
    const rows = truncated ? rawRows.slice(0, 500) : rawRows
    const prompt = buildStatementMapPrompt(rows)
    const result = await callGemini({
      apiKey,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.0 },
      }),
    })
    if (!result.ok) {
      return jsonResponse(
        { ok: false, status: result.status, reason: result.reason, message: result.message },
        result.status >= 400 && result.status < 600 ? result.status : 502,
      )
    }
    const text = result.data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const items = parseStatementItems(text)
    if (!items) {
      return jsonResponse({ ok: false, status: 502, reason: 'BAD_JSON', message: 'Gemini did not return valid statement JSON' }, 502)
    }
    return jsonResponse({ ok: true, kind: 'statement', items, truncated }, 200)
  }

  if (kind === 'statement-image') {
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' && body.mimeType ? body.mimeType : ''
    if (!fileBase64 || !mimeType) {
      return jsonResponse({ ok: false, status: 400, reason: 'BAD_FILE', message: 'fileBase64 and mimeType are required' }, 400)
    }
    const prompt = buildStatementImagePrompt()
    const result = await callGemini({
      apiKey,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: fileBase64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.0 },
      }),
    })
    if (!result.ok) {
      return jsonResponse(
        { ok: false, status: result.status, reason: result.reason, message: result.message },
        result.status >= 400 && result.status < 600 ? result.status : 502,
      )
    }
    const text = result.data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const items = parseStatementItems(text)
    if (!items) {
      return jsonResponse({ ok: false, status: 502, reason: 'BAD_JSON', message: 'Gemini did not return valid statement JSON' }, 502)
    }
    return jsonResponse({ ok: true, kind: 'statement', items }, 200)
  }

  if (kind === 'chat') {
    const ledger = body.ledger
    const messagesIn = Array.isArray(body.messages) ? (body.messages as unknown[]) : []
    if (!ledger || typeof ledger !== 'object') {
      return jsonResponse({ ok: false, status: 400, reason: 'BAD_LEDGER', message: 'ledger object is required' }, 400)
    }
    if (!messagesIn.length) {
      return jsonResponse({ ok: false, status: 400, reason: 'BAD_MESSAGES', message: 'messages array required' }, 400)
    }
    const trimmed = messagesIn.slice(-16)
    const ledgerText = JSON.stringify(ledger).slice(0, 16_000)
    const systemPrompt = buildChatSystemPrompt()
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []
    contents.push({
      role: 'user',
      parts: [
        { text: systemPrompt },
        { text: `קלסר (ledger) JSON:\n${ledgerText}` },
      ],
    })
    contents.push({ role: 'model', parts: [{ text: 'הבנתי, הקלסר נטען. אני מוכן לעזור.' }] })
    for (const raw of trimmed) {
      if (!raw || typeof raw !== 'object') continue
      const m = raw as { role?: unknown; content?: unknown }
      const role = m.role === 'assistant' ? 'model' : m.role === 'user' ? 'user' : null
      const content = typeof m.content === 'string' ? m.content : ''
      if (!role || !content) continue
      contents.push({ role, parts: [{ text: content }] })
    }
    if (!contents.some((c) => c.role === 'user' && c.parts[0]?.text !== systemPrompt && c.parts[0]?.text?.startsWith('קלסר') !== true)) {
      return jsonResponse({ ok: false, status: 400, reason: 'BAD_MESSAGES', message: 'no user message found' }, 400)
    }
    const baseRequest = {
      contents,
      generationConfig: { temperature: 0.2 },
    }
    let grounded = true
    let result = await callGemini({
      apiKey,
      body: JSON.stringify({ ...baseRequest, tools: [{ googleSearch: {} }] }),
    })
    if (!result.ok && isToolUnsupportedError(result)) {
      console.warn('[gemini-proxy] googleSearch tool rejected, retrying without grounding')
      grounded = false
      result = await callGemini({
        apiKey,
        body: JSON.stringify(baseRequest),
      })
    }
    if (!result.ok) {
      return jsonResponse(
        { ok: false, status: result.status, reason: result.reason, message: result.message },
        result.status >= 400 && result.status < 600 ? result.status : 502,
      )
    }
    const text = result.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    if (!text) {
      return jsonResponse({ ok: false, status: 502, reason: 'EMPTY_TEXT', message: 'Gemini did not return text' }, 502)
    }
    const { reply, action } = parseAssistantAction(text)
    return jsonResponse({ ok: true, kind: 'chat', reply, action, grounded }, 200)
  }

  return jsonResponse({ ok: false, status: 400, reason: 'BAD_KIND', message: 'kind must be receipt | voice | advice | statement-map | statement-image | chat' }, 400)
}
