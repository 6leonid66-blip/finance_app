import type { AppScreen } from '../types'

type BottomNavProps = {
  active: AppScreen
  onChange: (screen: AppScreen) => void
}

const items: { id: AppScreen; label: string }[] = [
  { id: 'dashboard', label: 'דשבורד' },
  { id: 'transactions', label: 'תנועות' },
  { id: 'recurring', label: 'קבועים' },
  { id: 'reconcile', label: 'השוואה' },
  { id: 'assistant', label: 'עוזר' },
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
          {item.label}
        </button>
      ))}
    </nav>
  )
}
