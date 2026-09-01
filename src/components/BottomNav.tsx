import type { AppScreen } from '../types'

type BottomNavProps = {
  active: AppScreen
  onChange: (screen: AppScreen) => void
}

const items: { id: AppScreen; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'דשבורד', icon: '⌂' },
  { id: 'transactions', label: 'תנועות', icon: '☰' },
  { id: 'recurring', label: 'קבועים', icon: '↻' },
]

export function BottomNav({ active, onChange }: BottomNavProps) {
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
    </nav>
  )
}
