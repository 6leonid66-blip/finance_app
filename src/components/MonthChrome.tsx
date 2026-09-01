import { useMemo } from 'react'
import { getLocalMonthValue, shiftMonthValue } from '../lib/month'

type MonthChromeProps = {
  value: string
  onChange: (value: string) => void
}

function monthLabel(monthValue: string) {
  const [y, m] = monthValue.slice(0, 7).split('-').map(Number)
  if (!y || !m) return monthValue
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'short', year: 'numeric' })
}

export function MonthChrome({ value, onChange }: MonthChromeProps) {
  const options = useMemo(() => {
    const today = getLocalMonthValue()
    const list: string[] = []
    for (let i = -12; i <= 3; i++) list.push(shiftMonthValue(today, i))
    if (!list.includes(value.slice(0, 7))) list.unshift(value.slice(0, 7))
    return list
  }, [value])

  return (
    <div className="month-chrome">
      <button
        type="button"
        className="month-nav-btn"
        aria-label="חודש קודם"
        onClick={() => onChange(shiftMonthValue(value, -1))}
      >
        ›
      </button>
      <label className="month-chrome-select">
        <span className="month-chrome-label">{monthLabel(value)}</span>
        <select
          aria-label="חודש"
          value={value.slice(0, 7)}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((key) => (
            <option key={key} value={key}>
              {monthLabel(key)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="month-nav-btn"
        aria-label="חודש הבא"
        onClick={() => onChange(shiftMonthValue(value, 1))}
      >
        ‹
      </button>
    </div>
  )
}
