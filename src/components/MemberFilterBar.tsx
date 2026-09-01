import type { HouseholdMemberBrief } from '../types'
import type { MemberScope } from '../lib/memberScope'
import { toUserScope } from '../lib/memberScope'

type MemberFilterBarProps = {
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

export function MemberFilterBar({ members, currentUserId, value, onChange }: MemberFilterBarProps) {
  return (
    <div className="member-filter" role="tablist" aria-label="סינון לפי בן משפחה">
      <button
        type="button"
        role="tab"
        className={value === 'all' ? 'member-chip active' : 'member-chip'}
        onClick={() => onChange('all')}
      >
        הכל
      </button>
      {members.map((member) => {
        const scope = toUserScope(member.userId)
        const label = member.userId === currentUserId ? member.displayName || 'אני' : member.displayName
        return (
          <button
            key={member.userId}
            type="button"
            role="tab"
            className={value === scope ? 'member-chip active' : 'member-chip'}
            onClick={() => onChange(scope)}
          >
            {member.avatarUrl ? (
              <img src={member.avatarUrl} alt="" className="member-chip-avatar" />
            ) : (
              <span className="member-chip-initials">{initials(label)}</span>
            )}
            <span>{label}</span>
          </button>
        )
      })}
      <button
        type="button"
        role="tab"
        className={value === 'shared' ? 'member-chip active' : 'member-chip'}
        onClick={() => onChange('shared')}
      >
        משותף
      </button>
    </div>
  )
}
