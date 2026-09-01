import type { FinancialAccount, HouseholdMemberBrief } from '../types'

export type MemberTint = {
  fg: string
  bg: string
}

export const SHARED_TINT: MemberTint = {
  fg: '#64748b',
  bg: 'color-mix(in srgb, #64748b 16%, transparent)',
}

const PALETTE: MemberTint[] = [
  { fg: '#4f46e5', bg: 'color-mix(in srgb, #4f46e5 18%, transparent)' },
  { fg: '#c2410c', bg: 'color-mix(in srgb, #c2410c 18%, transparent)' },
  { fg: '#0f766e', bg: 'color-mix(in srgb, #0f766e 18%, transparent)' },
  { fg: '#a21caf', bg: 'color-mix(in srgb, #a21caf 18%, transparent)' },
]

export function memberFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

export function orderedMemberIds(members: HouseholdMemberBrief[], currentUserId: string): string[] {
  return members
    .map((m) => m.userId)
    .slice()
    .sort((a, b) => {
      if (a === currentUserId) return -1
      if (b === currentUserId) return 1
      return a.localeCompare(b)
    })
}

export function colorForMember(
  userId: string | null | undefined,
  members: HouseholdMemberBrief[],
  currentUserId: string,
): MemberTint {
  if (!userId) return SHARED_TINT
  const ids = orderedMemberIds(members, currentUserId)
  const idx = ids.indexOf(userId)
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length]
}

export function colorForAccount(
  account: FinancialAccount | undefined,
  members: HouseholdMemberBrief[],
  currentUserId: string,
  fallbackOwnerId?: string | null,
): MemberTint {
  if (account?.is_shared) return SHARED_TINT
  return colorForMember(account?.owner_user_id ?? fallbackOwnerId, members, currentUserId)
}

export function identityLabelForAccount(
  account: FinancialAccount | undefined,
  members: HouseholdMemberBrief[],
  fallbackOwnerId?: string,
  fallbackOwnerName?: string | null,
): string {
  if (account?.is_shared) return 'משותף'
  const ownerId = account?.owner_user_id ?? fallbackOwnerId
  const member = members.find((m) => m.userId === ownerId)
  if (member) return memberFirstName(member.displayName)
  if (fallbackOwnerName?.trim()) return memberFirstName(fallbackOwnerName)
  return 'אישי'
}
