/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'http'
import { createClient } from '@supabase/supabase-js'
import type { InsightSnapshot } from '../src/lib/insightSnapshot.ts'

export type { InsightSnapshot }

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if ('body' in req && req.body != null) {
    const existing = (req as IncomingMessage & { body: unknown }).body
    if (typeof existing === 'string') {
      try {
        return Promise.resolve(JSON.parse(existing))
      } catch {
        return Promise.resolve(null)
      }
    }
    return Promise.resolve(existing)
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      if (!chunks.length) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export function buildAdvisorPrompt(snapshot: InsightSnapshot): string {
  const peopleBlock = snapshot.people
    .map((p) => {
      const tops = p.topExpenses.map((c) => `${c.category} ${Math.round(c.amount)}`).join(', ') || 'אין פירוט'
      return `- ${p.name}: הכנסות ${Math.round(p.income)} ₪, הוצאות ${Math.round(p.expense)} ₪, נשאר ${Math.round(p.remaining)} ₪. קטגוריות כבדות: ${tops}`
    })
    .join('\n')
  const sharedTops = snapshot.shared.topExpenses.map((c) => `${c.category} ${Math.round(c.amount)}`).join(', ') || 'אין'
  const houseTops = snapshot.householdTopExpenses.map((c) => `${c.category} ${Math.round(c.amount)}`).join(', ') || 'אין'

  return `אתה יועץ מקצועי לניהול משק בית, הוצאות והכנסות של זוג/משפחה בישראל.
כתוב בעברית ברורה, תמציתית ומעשית. בלי הקדמות מיותרות ובלי סימני markdown כבדים.
התייחס בשמות האנשים כפי שמופיעים בנתונים. אל תמציא סכומים.

חודש: ${snapshot.monthLabel} (${snapshot.monthKey})
הקשר צפייה: ${snapshot.scopeLabel}

כל הבית: הכנסות ${Math.round(snapshot.household.income)} ₪, הוצאות ${Math.round(snapshot.household.expense)} ₪, נשאר ${Math.round(snapshot.household.remaining)} ₪
קטגוריות הוצאה מובילות בבית: ${houseTops}

לפי אדם:
${peopleBlock}

משותף: הכנסות ${Math.round(snapshot.shared.income)} ₪, הוצאות ${Math.round(snapshot.shared.expense)} ₪, נשאר ${Math.round(snapshot.shared.remaining)} ₪. קטגוריות: ${sharedTops}

הפק מסמך קצר במבנה הבא:
1) סיכום החודש ב-2 משפטים
2) תובנה לכל אדם בשם
3) מסקנה עיקרית אחת
4) 3 המלצות מעשיות לשבוע הקרוב`
}

export async function generateMonthInsights(apiKey: string, snapshot: InsightSnapshot): Promise<string> {
  const prompt = buildAdvisorPrompt(snapshot)
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash']
  let lastError = 'Gemini לא החזיר תשובה'
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 900 },
      }),
    })
    const data = (await response.json()) as {
      error?: { message?: string }
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    if (!response.ok) {
      lastError = data.error?.message || `Gemini ${response.status}`
      continue
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('\n').trim()
    if (text) return text
  }
  throw new Error(lastError)
}

export async function handleInsights(req: IncomingMessage, res: ServerResponse, config: { apiKey?: string; supabaseUrl?: string; anonKey?: string }) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'Method not allowed' })
    return
  }
  const apiKey = config.apiKey
  if (!apiKey) {
    writeJson(res, 501, { error: 'חסר GEMINI_API_KEY בשרת' })
    return
  }
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token || !config.supabaseUrl || !config.anonKey) {
      writeJson(res, 401, { error: 'נדרשת התחברות כדי ליצור תובנות' })
      return
    }
    const client = createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: user, error: authError } = await client.auth.getUser(token)
    if (authError || !user.user) {
      writeJson(res, 401, { error: 'ההתחברות פגה. התחברו מחדש.' })
      return
    }
    const body = (await readJsonBody(req)) as { snapshot?: InsightSnapshot } | null
    const snapshot = body?.snapshot
    if (!snapshot?.monthKey) {
      writeJson(res, 400, { error: 'חסר snapshot' })
      return
    }
    const text = await generateMonthInsights(apiKey, snapshot)
    writeJson(res, 200, { text })
  } catch {
    writeJson(res, 500, { error: 'לא ניתן ליצור תובנות כרגע. נסו שוב מאוחר יותר.' })
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleInsights(req, res, { apiKey: process.env.GEMINI_API_KEY,
    supabaseUrl: process.env.VITE_SUPABASE_URL, anonKey: process.env.VITE_SUPABASE_ANON_KEY })
}
