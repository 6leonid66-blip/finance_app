/** monthValue: YYYY-MM from <input type="month"> */

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Local calendar month key for `d` (no UTC shift). */
export function getLocalMonthValue(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** Local calendar date as YYYY-MM-DD (do not use toISOString — it shifts the day in non-UTC zones). */
export function formatLocalYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** First calendar day YYYY-MM-01 — never uses toISOString() (avoids UTC shifting the calendar day vs local). */
export function monthValueToFirstDay(monthValue: string) {
  const key = monthValue.trim().slice(0, 7)
  const [y, m] = key.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return key.length >= 7 ? `${key}-01` : `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-01`
  }
  return `${y}-${pad2(m)}-01`
}

/**
 * inclusive start/end calendar dates for a month picker value.
 * Dates are formatted as local yyyy-mm-dd (no UTC edge shift via toISOString).
 */
export function monthValueToRange(monthValue: string) {
  const startDate = monthValueToFirstDay(monthValue).slice(0, 10)
  const matched = startDate.match(/^(\d{4})-(\d{2})-01$/)
  if (!matched) {
    return { startDate, endDate: startDate, monthDate: startDate }
  }
  const y = Number(matched[1])
  const mNum = Number(matched[2])
  const last = new Date(y, mNum, 0)
  const endDate = `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`
  return {
    startDate,
    endDate,
    monthDate: startDate,
  }
}
