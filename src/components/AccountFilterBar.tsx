import type { CSSProperties } from 'react'
import type { FinancialAccount, HouseholdMemberBrief } from '../types'
import { colorForMember, memberFirstName, SHARED_TINT } from '../lib/memberColor'
import type { MemberScope } from '../lib/memberScope'
import { toUserScope } from '../lib/memberScope'

type AccountFilterBarProps = {
  accounts: FinancialAccount[]
  members: HouseholdMemberBrief[]
  currentUserId: string
  value: MemberScope
  onChange: (scope: MemberScope) => void
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
  const togetherActive = value === 'all'

  return (
    <div className="member-filter account-filter" role="tablist" aria-label="בחירת תצוגה">
      <button
        type="button"
        role="tab"
        className={togetherActive ? 'member-chip member-chip-together active' : 'member-chip member-chip-together'}
        onClick={() => onChange('all')}
      >
        <span className="member-chip-initials">⊕</span>
        <span>ביחד</span>
      </button>
      {personal.map((account) => {
        const member = members.find((m) => m.userId === account.owner_user_id)
        const raw = member?.displayName || (account.owner_user_id === currentUserId ? 'אני' : 'אישי')
        const label = memberFirstName(raw)
        const tint = colorForMember(account.owner_user_id, members, currentUserId)
        const scope = toUserScope(account.owner_user_id!)
        return (
          <button
            key={account.id}
            type="button"
            role="tab"
            className={value === scope ? 'member-chip active' : 'member-chip'}
            style={{ '--member-fg': tint.fg, '--member-bg': tint.bg } as CSSProperties}
            onClick={() => onChange(scope)}
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
          className={value === 'shared' ? 'member-chip active' : 'member-chip'}
          style={{ '--member-fg': SHARED_TINT.fg, '--member-bg': SHARED_TINT.bg } as CSSProperties}
          onClick={() => onChange('shared')}
        >
          <span className="member-chip-initials">⌂</span>
          <span>משותף</span>
        </button>
      ))}
    </div>
  )
}
