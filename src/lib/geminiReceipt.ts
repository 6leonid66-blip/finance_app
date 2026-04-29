type ReceiptAnalysis = {
  amount?: number
  description?: string
  suggestedCategory?: string
}

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b']

function mapGeminiError(status: number) {
  if (status === 403) {
    return 'Gemini חסום (403). בדוק שה-API key תקין, שהפעלת Gemini API ושיש הרשאות Billing.'
  }
  if (status === 404) {
    return 'Gemini API error: 404. המודל לא זמין לפרויקט הזה כרגע.'
  }
  if (status === 429) {
    return 'חריגה ממכסת Gemini. נסה שוב בעוד כמה דקות.'
  }
  return `Gemini API error: ${status}`
}

async function callGeminiWithFallback(params: {
  apiKey: string
  body: string
}): Promise<{
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
}> {
  let lastErrorStatus: number | null = null
  for (const model of GEMINI_MODELS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${params.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: params.body,
      },
    )
    if (response.ok) {
      return (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> }
        }>
      }
    }
    lastErrorStatus = response.status
    if (response.status !== 404) {
      throw new Error(mapGeminiError(response.status))
    }
  }
  throw new Error(mapGeminiError(lastErrorStatus ?? 404))
}

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

function normalizeAmount(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw !== 'string') return undefined
  const sanitized = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  const num = Number(sanitized)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return num
}

export async function analyzeReceiptWithGemini(params: {
  file: File
  categories: readonly string[]
}): Promise<ReceiptAnalysis> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
  if (!apiKey) {
    throw new Error('חסר VITE_GEMINI_API_KEY בקובץ .env')
  }

  const base64 = await fileToBase64(params.file)
  const prompt = `Analyze this Hebrew receipt/check image and return only JSON.
JSON keys:
- amount: number (total amount in ILS)
- description: short Hebrew description (max 40 chars)
- suggestedCategory: choose one exact value from this list: ${params.categories.join(', ')}
If uncertain, set suggestedCategory to "אחר".`

  const data = await callGeminiWithFallback({
    apiKey,
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: params.file.type || 'image/jpeg',
                data: base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  })

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini לא החזיר תשובה תקינה')

  let parsed: { amount?: unknown; description?: unknown; suggestedCategory?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('לא הצלחתי לפענח תשובת Gemini כ-JSON')
  }

  const amount = normalizeAmount(parsed.amount)
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : undefined
  const suggestedCategory =
    typeof parsed.suggestedCategory === 'string' ? parsed.suggestedCategory.trim() : undefined

  return {
    amount,
    description: description || undefined,
    suggestedCategory: suggestedCategory || undefined,
  }
}

export async function analyzeSpokenExpenseWithGemini(params: {
  spokenText: string
  categories: readonly string[]
}): Promise<ReceiptAnalysis> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
  if (!apiKey) {
    throw new Error('חסר VITE_GEMINI_API_KEY בקובץ .env')
  }
  const prompt = `You are a Hebrew expense parser.
Convert the spoken text into strict JSON only.
JSON keys:
- amount: number (ILS, required if detectable)
- description: short Hebrew description (max 40 chars)
- suggestedCategory: one exact value from this list: ${params.categories.join(', ')}
If uncertain about category set "אחר".
Spoken text: """${params.spokenText}"""`

  const data = await callGeminiWithFallback({
    apiKey,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  })
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini לא החזיר תשובה תקינה')

  let parsed: { amount?: unknown; description?: unknown; suggestedCategory?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('לא הצלחתי לפענח תשובת Gemini כ-JSON')
  }

  const amount = normalizeAmount(parsed.amount)
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : undefined
  const suggestedCategory =
    typeof parsed.suggestedCategory === 'string' ? parsed.suggestedCategory.trim() : undefined

  return {
    amount,
    description: description || undefined,
    suggestedCategory: suggestedCategory || undefined,
  }
}

export async function generateHouseholdAdviceWithGemini(params: {
  month: string
  summary: string
}): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
  if (!apiKey) {
    throw new Error('חסר VITE_GEMINI_API_KEY בקובץ .env')
  }
  const prompt = `You are a household finance advisor for an Israeli family.
Write your response in Hebrew.
Keep it practical and short (4 bullet points max).
Data month: ${params.month}
Data summary:
${params.summary}
Return plain text only.`

  const data = await callGeminiWithFallback({
    apiKey,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  })
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) throw new Error('Gemini לא החזיר המלצה')
  return text
}

