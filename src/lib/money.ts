const ILS = new Intl.NumberFormat('he-IL', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

const ILS_WHOLE = new Intl.NumberFormat('he-IL', {
  maximumFractionDigits: 0,
})

/** סכום בשקלים עם מפרידי אלפים — אחיד בכל המערכת. */
export function formatIls(amount: number, opts?: { whole?: boolean }): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0 ₪'
  const formatted = opts?.whole ? ILS_WHOLE.format(Math.round(n)) : ILS.format(n)
  return `${formatted} ₪`
}

export function formatSignedIls(amount: number, opts?: { whole?: boolean }): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0 ₪'
  const abs = formatIls(Math.abs(n), opts)
  if (n > 0) return `+${abs}`
  if (n < 0) return `−${abs}`
  return abs
}
