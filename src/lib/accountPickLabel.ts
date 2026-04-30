import type { FinancialAccount, HouseholdMemberBrief } from '../types'

/** תווית ייחודית לרשימת בחירה כשכל אחד מקבל מהשרת באותו שם (למשל "חשבון שלי"). */
export function householdAccountPickLabel(
  account: FinancialAccount,
  sessionUserId: string | null,
  members: HouseholdMemberBrief[],
): string {
  const base = account.name.trim()
  if (account.is_shared) return `${base} · משותף`

  const owner = account.owner_user_id
  if (!sessionUserId || !owner) return base
  if (owner === sessionUserId) return `${base} · אני`

  const peer = members.find((m) => m.userId === owner)?.displayName?.trim()
  return peer ? `${base} · ${peer}` : `${base} · בן/בת זוג בבית`
}
