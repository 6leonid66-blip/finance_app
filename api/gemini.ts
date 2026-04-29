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

type ProxyResult = ProxyResultJson | ProxyResultText | ProxyError

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

  return jsonResponse({ ok: false, status: 400, reason: 'BAD_KIND', message: 'kind must be receipt | voice | advice' }, 400)
}
