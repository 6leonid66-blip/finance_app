import { getLocalMonthValue, shiftMonthValue } from '../lib/month'

type MonthValuePickerProps = {
  value: string
  onChange: (value: string) => void
  className?: string
  yearSpan?: number
  compact?: boolean
}

const HEBREW_MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳']

function parseMonthValue(value: string) {
  const [y, m] = value.split('-').map(Number)
  const now = new Date()
  const safeYear = Number.isFinite(y) ? y : now.getFullYear()
  const safeMonth = Number.isFinite(m) && m >= 1 && m <= 12 ? m : now.getMonth() + 1
  return { year: safeYear, month: safeMonth }
}

function formatMonthValue(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function MonthValuePicker({
  value,
  onChange,
  className,
  yearSpan = 6,
  compact = false,
}: MonthValuePickerProps) {
  const { year, month } = parseMonthValue(value)
  const nowYear = new Date().getFullYear()
  const minYear = nowYear - yearSpan
  const maxYear = nowYear + yearSpan
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)
  const today = getLocalMonthValue()
  const isCurrent = value.slice(0, 7) === today

  return (
    <div className={className ? `month-picker month-picker-nav ${className}` : 'month-picker month-picker-nav'}>
      <button
        type="button"
        className="month-nav-btn"
        aria-label="חודש קודם"
        onClick={() => onChange(shiftMonthValue(value, -1))}
      >
        ›
      </button>
      <select
        aria-label="שנה"
        value={year}
        onChange={(e) => onChange(formatMonthValue(Number(e.target.value), month))}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        aria-label="חודש"
        value={month}
        onChange={(e) => onChange(formatMonthValue(year, Number(e.target.value)))}
      >
        {HEBREW_MONTHS.map((label, idx) => (
          <option key={label} value={idx + 1}>
            {label}
          </option>
        ))}
      </select>
      {!compact ? (
        <button
          type="button"
          className={isCurrent ? 'month-today-btn is-current' : 'month-today-btn'}
          disabled={isCurrent}
          onClick={() => onChange(today)}
        >
          היום
        </button>
      ) : null}
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
