import type { FinanceEntry } from '../types'

export type ParsedBankRow = {
  occurred_on: string // YYYY-MM-DD
  amount: number // positive
  type: 'expense' | 'income'
  description?: string
}

export type MatchedPair = {
  bank: ParsedBankRow
  app: FinanceEntry
  score: number
}

export type MatchResult = {
  matched: MatchedPair[]
  missingInApp: ParsedBankRow[]
  extraInApp: FinanceEntry[]
}

const AMOUNT_TOLERANCE_ILS = 1
const DATE_TOLERANCE_DAYS = 3
const MIN_SCORE = 1

function dateDays(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return Number.NaN
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

function dayDiff(a: string, b: string): number {
  const da = dateDays(a)
  const db = dateDays(b)
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY
  return Math.abs(da - db)
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return ''
  return value.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function jaccardish(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(' ').filter(Boolean))
  const tb = new Set(normalizeText(b).split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union ? inter / union : 0
}

function score(bank: ParsedBankRow, app: FinanceEntry): number {
  if (bank.type !== app.type) return 0
  if (Math.abs(bank.amount - app.amount) > AMOUNT_TOLERANCE_ILS) return 0
  const dd = dayDiff(bank.occurred_on, app.occurred_on)
  if (dd > DATE_TOLERANCE_DAYS) return 0
  let s = 1
  if (Math.round(bank.amount * 100) === Math.round(app.amount * 100)) s += 0.4
  if (dd === 0) s += 0.4
  if (bank.description && app.note && jaccardish(bank.description, app.note) > 0.4) s += 0.4
  return s
}

export function reconcile(bankRows: ParsedBankRow[], appTransactions: FinanceEntry[]): MatchResult {
  const usedAppIds = new Set<string>()
  const matched: MatchedPair[] = []
  const missingInApp: ParsedBankRow[] = []

  for (const bank of bankRows) {
    let bestApp: FinanceEntry | null = null
    let bestScore = 0
    for (const app of appTransactions) {
      if (usedAppIds.has(app.id)) continue
      const s = score(bank, app)
      if (s > bestScore) {
        bestScore = s
        bestApp = app
      }
    }
    if (bestApp && bestScore >= MIN_SCORE) {
      usedAppIds.add(bestApp.id)
      matched.push({ bank, app: bestApp, score: bestScore })
    } else {
      missingInApp.push(bank)
    }
  }

  const extraInApp = appTransactions.filter((app) => !usedAppIds.has(app.id))

  return { matched, missingInApp, extraInApp }
}
