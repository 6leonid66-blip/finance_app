/** monthValue: YYYY-MM from <input type="month"> */
export function monthValueToFirstDay(monthValue: string) {
  const [y, m] = monthValue.split('-').map(Number)
  return new Date(y, m - 1, 1).toISOString().slice(0, 10)
}

export function monthValueToRange(monthValue: string) {
  const [y, m] = monthValue.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    monthDate: start.toISOString().slice(0, 10),
  }
}
