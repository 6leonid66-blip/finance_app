import type { FinancialAccount, HouseholdMemberBrief } from '../types'

type AccountFilterBarProps = {
  accounts: FinancialAccount[]
  members: HouseholdMemberBrief[]
  currentUserId: string
  value: string
  onChange: (accountId: string) => void
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function AccountFilterBar({ accounts, members, currentUserId, value, onChange }: AccountFilterBarProps) {
  const personal = accounts
    .filter((a) => !a.is_shared && a.owner_user_id)
    .slice()
    .sort((a, b) => {
      if (a.owner_user_id === currentUserId) return -1
      if (b.owner_user_id === currentUserId) return 1
      return 0
    })
  const shared = accounts.filter((a) => a.is_shared)

  return (
    <div className="member-filter account-filter" role="tablist" aria-label="בחירת חשבון">
      {personal.map((account) => {
        const member = members.find((m) => m.userId === account.owner_user_id)
        const raw = member?.displayName || (account.owner_user_id === currentUserId ? 'אני' : 'אישי')
        const label = firstName(raw)
        return (
          <button
            key={account.id}
            type="button"
            role="tab"
            className={value === account.id ? 'member-chip active' : 'member-chip'}
            onClick={() => onChange(account.id)}
          >
            {member?.avatarUrl ? (
              <img src={member.avatarUrl} alt="" className="member-chip-avatar" />
            ) : (
              <span className="member-chip-initials">{initials(raw)}</span>
            )}
            <span>{label}</span>
          </button>
        )
      })}
      {shared.map((account) => (
        <button
          key={account.id}
          type="button"
          role="tab"
          className={value === account.id ? 'member-chip active' : 'member-chip'}
          onClick={() => onChange(account.id)}
        >
          <span className="member-chip-initials">⌂</span>
          <span>משותף</span>
        </button>
      ))}
    </div>
  )
}
