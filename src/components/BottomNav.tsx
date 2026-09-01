import type { AppScreen } from '../types'

type BottomNavProps = {
  active: AppScreen
  onChange: (screen: AppScreen) => void
  onAdd: () => void
}

const items: { id: AppScreen; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'דשבורד', icon: '⌂' },
  { id: 'transactions', label: 'תנועות', icon: '☰' },
]

export function BottomNav({ active, onChange, onAdd }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === active ? 'bottom-nav-item active' : 'bottom-nav-item'}
          onClick={() => onChange(item.id)}
        >
          <span className="bottom-nav-icon" aria-hidden>
            {item.icon}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
      <button type="button" className="bottom-nav-add" onClick={onAdd} aria-label="הוספת תנועה">
        +
      </button>
      <button
        type="button"
        className={active === 'recurring' ? 'bottom-nav-item active' : 'bottom-nav-item'}
        onClick={() => onChange('recurring')}
      >
        <span className="bottom-nav-icon" aria-hidden>
          ↻
        </span>
        <span>קבועים</span>
      </button>
    </nav>
  )
}
