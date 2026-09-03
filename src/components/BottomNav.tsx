import { useRef } from 'react'
import type { AppScreen } from '../types'

type BottomNavProps = {
  active: AppScreen
  onChange: (screen: AppScreen) => void
  onAdd: () => void
  onVoiceStart: () => void
  onVoiceEnd: () => void
  recording?: boolean
}

const items: { id: AppScreen; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'דשבורד', icon: '⌂' },
  { id: 'transactions', label: 'תנועות', icon: '☰' },
]

const LONG_PRESS_MS = 550

export function BottomNav({
  active,
  onChange,
  onAdd,
  onVoiceStart,
  onVoiceEnd,
  recording = false,
}: BottomNavProps) {
  const timerRef = useRef<number | null>(null)
  const longRef = useRef(false)
  const suppressClickRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const beginPress = () => {
    longRef.current = false
    suppressClickRef.current = false
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      longRef.current = true
      suppressClickRef.current = true
      timerRef.current = null
      onVoiceStart()
    }, LONG_PRESS_MS)
  }

  const finishPress = () => {
    const wasLong = longRef.current
    clearTimer()
    if (wasLong) {
      longRef.current = false
      onVoiceEnd()
    }
  }

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
      <button
        type="button"
        className={recording ? 'bottom-nav-add is-recording' : 'bottom-nav-add'}
        aria-label={recording ? 'מקליט… שחררו כדי להוסיף' : 'הוספת תנועה. לחיצה ארוכה להקלטה'}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          beginPress()
        }}
        onPointerUp={finishPress}
        onPointerCancel={finishPress}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          if (longRef.current || recording) return
          onAdd()
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {recording ? '●' : '+'}
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
