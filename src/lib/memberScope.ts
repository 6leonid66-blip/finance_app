import type { FinanceEntry, FinancialAccount } from '../types'

/** הכל · משתמש ספציפי · משותף */
export type MemberScope = 'all' | 'shared' | `user:${string}`

export function memberScopeUserId(scope: MemberScope): string | null {
  return scope.startsWith('user:') ? scope.slice(5) : null
}

export function toUserScope(userId: string): MemberScope {
  return `user:${userId}`
}

export function filterEntriesByMemberScope<T extends Pick<FinanceEntry, 'account_id' | 'owner_id'>>(
  entries: T[],
  scope: MemberScope,
  accounts: FinancialAccount[],
): T[] {
  if (scope === 'all') return entries
  const sharedIds = new Set(accounts.filter((a) => a.is_shared).map((a) => a.id))
  if (scope === 'shared') {
    return entries.filter((entry) => {
      if (entry.account_id) return sharedIds.has(entry.account_id)
      return false
    })
  }
  const userId = memberScopeUserId(scope)
  if (!userId) return entries
  const personalIds = new Set(
    accounts.filter((a) => !a.is_shared && a.owner_user_id === userId).map((a) => a.id),
  )
  return entries.filter((entry) => {
    if (entry.account_id) {
      if (personalIds.has(entry.account_id)) return true
      if (sharedIds.has(entry.account_id)) return false
    }
    return entry.owner_id === userId
  })
}

export function preferredAccountIdForScope(
  scope: MemberScope,
  accounts: FinancialAccount[],
  sessionUserId: string | null,
): string {
  if (scope === 'shared') {
    return accounts.find((a) => a.is_shared)?.id ?? accounts[0]?.id ?? ''
  }
  const userId = memberScopeUserId(scope) ?? sessionUserId
  if (userId) {
    const personal = accounts.find((a) => !a.is_shared && a.owner_user_id === userId)
    if (personal) return personal.id
  }
  return accounts.find((a) => !a.is_shared && a.owner_user_id === sessionUserId)?.id ?? accounts[0]?.id ?? ''
}
