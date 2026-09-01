import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import type { UserProfileView } from '../types'

type SettingsSheetProps = {
  open: boolean
  onClose: () => void
  householdId: string
  householdName: string
  profile: UserProfileView
  onSaveProfile: (next: {
    full_name: string
    avatar_url: string
    avatar_path: string
  }) => Promise<{ ok: boolean; message: string }>
  onUploadProfilePhoto: (
    file: File,
  ) => Promise<{ ok: boolean; message: string; avatar_path?: string; avatar_url?: string }>
  onHouseholdJoined: () => void
  onRenameHousehold: (name: string) => Promise<{ ok: boolean; message: string }>
  onSignOut: () => void
}

export function SettingsSheet({
  open,
  onClose,
  householdId,
  householdName,
  profile,
  onSaveProfile,
  onUploadProfilePhoto,
  onHouseholdJoined,
  onRenameHousehold,
  onSignOut,
}: SettingsSheetProps) {
  const [profileName, setProfileName] = useState(profile.full_name ?? '')
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(profile.avatar_url ?? '')
  const [profileAvatarPath, setProfileAvatarPath] = useState(profile.avatar_path ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinMessage, setJoinMessage] = useState<string | null>(null)
  const [copyJoinHint, setCopyJoinHint] = useState<string | null>(null)
  const [familyNameDraft, setFamilyNameDraft] = useState(householdName)
  const [familyNameSaving, setFamilyNameSaving] = useState(false)
  const [familyNameMessage, setFamilyNameMessage] = useState<string | null>(null)

  const profileInitials = useMemo(() => {
    const source = (profile.full_name?.trim() || profile.email?.trim() || 'U').replace(/\s+/g, ' ')
    const pieces = source.split(' ')
    if (pieces.length >= 2) return `${pieces[0][0] ?? ''}${pieces[1][0] ?? ''}`.toUpperCase()
    return source.slice(0, 2).toUpperCase()
  }, [profile.full_name, profile.email])

  useEffect(() => {
    if (!open) return
    setProfileName(profile.full_name ?? '')
    setProfileAvatarUrl(profile.avatar_url ?? '')
    setProfileAvatarPath(profile.avatar_path ?? '')
    setFamilyNameDraft(householdName)
    setProfileMessage(null)
    setJoinMessage(null)
    setFamilyNameMessage(null)
    setJoinCodeInput('')
  }, [open, profile.full_name, profile.avatar_url, profile.avatar_path, householdName])

  if (!open) return null

  const submitProfile = async () => {
    setProfileSaving(true)
    setProfileMessage(null)
    setFamilyNameMessage(null)
    const trimmedHouse = familyNameDraft.trim()
    if (trimmedHouse && trimmedHouse !== householdName.trim()) {
      const hr = await onRenameHousehold(trimmedHouse)
      setFamilyNameMessage(hr.message)
      if (!hr.ok) {
        setProfileSaving(false)
        return
      }
    }
    const result = await onSaveProfile({
      full_name: profileName,
      avatar_url: profileAvatarUrl,
      avatar_path: profileAvatarPath,
    })
    setProfileMessage(result.message)
    setProfileSaving(false)
    if (result.ok) window.setTimeout(onClose, 500)
  }

  const onPickProfilePhoto = async (file?: File | null) => {
    if (!file) return
    setProfileSaving(true)
    const uploaded = await onUploadProfilePhoto(file)
    if (uploaded.ok) {
      setProfileAvatarPath(uploaded.avatar_path ?? '')
      setProfileAvatarUrl(uploaded.avatar_url ?? '')
      setProfileMessage('תמונה הועלתה בהצלחה')
    } else {
      setProfileMessage(uploaded.message)
    }
    setProfileSaving(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="card card-form modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-heading">הגדרות</h2>

        <section className="household-settings">
          <h3 className="card-heading settings-subhead">בית משפחתי</h3>
          <p className="muted small">
            כל חבר בית רואה את אותו שם. העתיקו את קוד ההזמנה ושלחו לבן/בת הזוג.
          </p>
          <label className="stack">
            <span>שם הבית / המשפחה</span>
            <input
              value={familyNameDraft}
              onChange={(e) => {
                setFamilyNameDraft(e.target.value)
                setFamilyNameMessage(null)
              }}
              placeholder="למשל: משפחת כהן"
              maxLength={120}
            />
          </label>
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={familyNameSaving || !familyNameDraft.trim() || familyNameDraft.trim() === householdName}
              onClick={() => {
                setFamilyNameSaving(true)
                setFamilyNameMessage(null)
                void onRenameHousehold(familyNameDraft.trim()).then((r) => {
                  setFamilyNameSaving(false)
                  setFamilyNameMessage(r.message)
                })
              }}
            >
              {familyNameSaving ? 'שומר…' : 'שמור שם בית'}
            </button>
          </div>
          {familyNameMessage ? <p className="inline-status">{familyNameMessage}</p> : null}

          <p className="muted small" style={{ margin: '14px 0 6px' }}>
            <strong>קוד הזמנה</strong>
          </p>
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
            <code className="ltr-input invite-code">{householdId}</code>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                void navigator.clipboard.writeText(householdId).then(
                  () => {
                    setCopyJoinHint('הועתק ללוח')
                    window.setTimeout(() => setCopyJoinHint(null), 2000)
                  },
                  () => setCopyJoinHint('העתקה נכשלה — סמן והעתק ידנית'),
                )
              }}
            >
              העתק קוד
            </button>
          </div>
          {copyJoinHint ? <p className="inline-status">{copyJoinHint}</p> : null}

          <label className="stack" style={{ marginTop: 12 }}>
            <span>הצטרפות לבית אחר</span>
            <input
              className="ltr-input"
              value={joinCodeInput}
              onChange={(e) => {
                setJoinCodeInput(e.target.value.trim())
                setJoinMessage(null)
              }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 8 }}
            disabled={joinBusy || !joinCodeInput.trim()}
            onClick={() => {
              if (!supabase) {
                setJoinMessage('אין חיבור לשרת')
                return
              }
              setJoinBusy(true)
              setJoinMessage(null)
              void supabase.rpc('join_household_by_code', { p_household_code: joinCodeInput.trim() }).then(({ error }) => {
                setJoinBusy(false)
                if (error) {
                  setJoinMessage(error.message)
                  return
                }
                setJoinMessage('הצטרפת בהצלחה. טוען את הבית החדש…')
                onHouseholdJoined()
                window.setTimeout(onClose, 800)
              })
            }}
          >
            {joinBusy ? 'מצטרף…' : 'הצטרף לבית זה'}
          </button>
          {joinMessage ? <p className="inline-status">{joinMessage}</p> : null}
        </section>

        <hr className="settings-divider" />

        <div className="profile-modal-preview">
          {profileAvatarUrl.trim() ? (
            <img src={profileAvatarUrl.trim()} alt="" className="profile-modal-avatar" />
          ) : (
            <span className="profile-chip-initials profile-modal-initials">{profileInitials}</span>
          )}
          <div>
            <strong>{profileName.trim() || 'ללא שם'}</strong>
            <p className="muted small">{profile.email || ''}</p>
          </div>
        </div>
        <label className="stack" style={{ marginTop: 8 }}>
          <span>שם תצוגה</span>
          <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="למשל: לאוניד" />
        </label>
        <label className="stack" style={{ marginTop: 8 }}>
          <span>קישור לתמונת פרופיל</span>
          <input
            type="url"
            value={profileAvatarUrl}
            onChange={(e) => setProfileAvatarUrl(e.target.value)}
            placeholder="https://..."
            className="ltr-input"
          />
        </label>
        <label className="stack" style={{ marginTop: 8 }}>
          <span>או העלאת תמונה</span>
          <input type="file" accept="image/*" onChange={(e) => void onPickProfilePhoto(e.target.files?.[0])} />
        </label>

        <div className="row-actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn-primary" disabled={profileSaving} onClick={() => void submitProfile()}>
            {profileSaving ? 'שומר…' : 'שמור'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            סגור
          </button>
          <button type="button" className="btn-ghost" onClick={() => void onSignOut()}>
            יציאה
          </button>
        </div>
        {profileMessage ? <p className="inline-status">{profileMessage}</p> : null}
      </article>
    </div>
  )
}
