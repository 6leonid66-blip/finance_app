type ReceiptAnalysis = {
  amount?: number
  description?: string
  suggestedCategory?: string
}

type ProxySuccess = {
  ok: true
  amount?: number
  description?: string
  suggestedCategory?: string
  text?: string
}

type ProxyFailure = {
  ok: false
  status: number
  reason: string
  message: string
}

type ProxyResponse = ProxySuccess | ProxyFailure

const PROXY_PATH = '/api/gemini'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = reader.result
      if (typeof value !== 'string') {
        reject(new Error('לא הצלחתי לקרוא את הקובץ'))
        return
      }
      const base64 = value.includes(',') ? value.split(',')[1] : value
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('קריאת קובץ נכשלה'))
    reader.readAsDataURL(file)
  })
}

function describeProxyError(failure: ProxyFailure): Error {
  const reason = failure.reason || ''
  const message = failure.message || ''

  if (reason === 'MISSING_KEY') {
    return new Error('המפתח של Gemini לא מוגדר בשרת. עדכן GEMINI_API_KEY ב-Vercel ועשה Redeploy.')
  }
  if (reason === 'API_KEY_INVALID' || /key expired|invalid api key/i.test(message)) {
    return new Error('מפתח Gemini לא תקין או פג תוקף. צור API key חדש ועדכן GEMINI_API_KEY ב-Vercel.')
  }
  if (reason === 'SERVICE_DISABLED' || /api .* has not been used|not enabled/i.test(message)) {
    return new Error('Generative Language API לא מופעל בפרויקט הזה. הפעל אותו ב-Google Cloud ואז נסה שוב.')
  }
  if (reason === 'BILLING_DISABLED' || /billing/i.test(message)) {
    return new Error('Billing כבוי בפרויקט של Gemini. הפעל Billing כדי להשתמש ב-AI.')
  }
  if (reason === 'BAD_JSON' || reason === 'EMPTY_TEXT') {
    return new Error('Gemini לא החזיר תשובה תקינה. נסה שוב או מלא ידנית.')
  }
  if (failure.status === 403) {
    return new Error('Gemini חסום (403). בדוק שה-API key תקין, שהפעלת Gemini API ושיש הרשאות Billing.')
  }
  if (failure.status === 404) {
    return new Error('המודל לא זמין לפרויקט הזה כרגע (404).')
  }
  if (failure.status === 429) {
    return new Error('חריגה ממכסת Gemini. נסה שוב בעוד כמה דקות.')
  }
  if (message.trim()) {
    return new Error(`שגיאת Gemini (${failure.status}): ${message.trim()}`)
  }
  return new Error(`שגיאת Gemini (${failure.status})`)
}

async function callProxy(payload: Record<string, unknown>): Promise<ProxySuccess> {
  let response: Response
  try {
    response = await fetch(PROXY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error('לא הצלחתי להתחבר לשרת ה-AI. בדוק חיבור אינטרנט.')
  }

  let parsed: ProxyResponse | null = null
  try {
    parsed = (await response.json()) as ProxyResponse
  } catch {
    // Non-JSON proxy error body; we'll surface the HTTP status below.
  }

  if (!parsed) {
    throw new Error(`שגיאת Gemini (${response.status})`)
  }
  if (parsed.ok) return parsed
  throw describeProxyError(parsed)
}

export async function analyzeReceiptWithGemini(params: {
  file: File
  categories: readonly string[]
}): Promise<ReceiptAnalysis> {
  const imageBase64 = await fileToBase64(params.file)
  const result = await callProxy({
    kind: 'receipt',
    categories: params.categories,
    imageBase64,
    mimeType: params.file.type || 'image/jpeg',
  })
  return {
    amount: result.amount,
    description: result.description,
    suggestedCategory: result.suggestedCategory,
  }
}

export async function analyzeSpokenExpenseWithGemini(params: {
  spokenText: string
  categories: readonly string[]
}): Promise<ReceiptAnalysis> {
  const result = await callProxy({
    kind: 'voice',
    categories: params.categories,
    spokenText: params.spokenText,
  })
  return {
    amount: result.amount,
    description: result.description,
    suggestedCategory: result.suggestedCategory,
  }
}

export async function generateHouseholdAdviceWithGemini(params: {
  month: string
  summary: string
}): Promise<string> {
  const result = await callProxy({
    kind: 'advice',
    month: params.month,
    summary: params.summary,
  })
  if (!result.text) throw new Error('Gemini לא החזיר המלצה')
  return result.text
}
