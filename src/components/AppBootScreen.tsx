import { useEffect, useState } from 'react'

type AppBootScreenProps = {
  statusMessage: string | null
}

const BOOT_PHRASES = ['מסדר את התקציב שלך…', 'מחשב יתרות…', 'טוען תנועות…']

const HINT_DELAY_MS = 6000
const PHRASE_INTERVAL_MS = 1500

// Branded loading state shown while the user's first month of data is
// bootstrapping. The DB / RLS hint is intentionally suppressed for the
// first ~6 seconds so the typical happy-path boot looks clean and never
// flashes a scary "DB error" message at the user before things have
// even had a chance to load.
export function AppBootScreen({ statusMessage }: AppBootScreenProps) {
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPhraseIndex((idx) => (idx + 1) % BOOT_PHRASES.length)
    }, PHRASE_INTERVAL_MS)
    const hintTimer = window.setTimeout(() => setShowHint(true), HINT_DELAY_MS)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(hintTimer)
    }
  }, [])

  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <div className="boot-card">
        <div className="boot-mark" aria-hidden>
          💰
        </div>
        <h2 className="boot-title">הבית הפיננסי שלי</h2>
        <p className="boot-tagline" key={phraseIndex}>
          {BOOT_PHRASES[phraseIndex]}
        </p>
        <div className="boot-spinner" aria-hidden />
        <div className="boot-dots" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        {showHint ? (
          <p className="muted small boot-hint">
            לוקח יותר מהרגיל — אם זה ממשיך, ייתכן שיש בעיית DB/RLS. ודא שהרצת את כל המיגרציות.
          </p>
        ) : null}
        {showHint && statusMessage ? <p className="muted small boot-hint">{statusMessage}</p> : null}
      </div>
    </div>
  )
}
