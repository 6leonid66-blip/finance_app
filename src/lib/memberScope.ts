import type { FinanceEntry, FinancialAccount, RecurringTemplate } from '../types'

/** ביחד · משתמש ספציפי · משותף */
export type MemberScope = 'all' | 'shared' | `user:${string}`

export function isMemberScope(value: string): value is MemberScope {
  return value === 'all' || value === 'shared' || value.startsWith('user:')
}

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

export function filterTemplatesByMemberScope<T extends Pick<RecurringTemplate, 'owner_user_id'>>(
  templates: T[],
  scope: MemberScope,
): T[] {
  if (scope === 'all') return templates
  if (scope === 'shared') return templates.filter((row) => !row.owner_user_id)
  const userId = memberScopeUserId(scope)
  if (!userId) return templates
  return templates.filter((row) => row.owner_user_id === userId)
}

export function preferredAccountIdForOwner(
  accounts: FinancialAccount[],
  ownerUserId: string | null,
): string {
  if (ownerUserId) {
    const personal = accounts.find((a) => !a.is_shared && a.owner_user_id === ownerUserId)
    if (personal) return personal.id
  }
  return accounts.find((a) => a.is_shared)?.id ?? accounts[0]?.id ?? ''
}

export function preferredAccountIdForScope(
  scope: MemberScope,
  accounts: FinancialAccount[],
  sessionUserId: string | null,
): string {
  if (scope === 'all' || scope === 'shared') {
    return accounts.find((a) => a.is_shared)?.id ?? accounts[0]?.id ?? ''
  }
  return preferredAccountIdForOwner(accounts, memberScopeUserId(scope) ?? sessionUserId)
}

export function defaultSharedAccountId(accounts: FinancialAccount[]): string {
  return accounts.find((a) => a.is_shared)?.id ?? accounts[0]?.id ?? ''
}

export function filterEntriesByAccount<T extends { account_id: string | null }>(
  entries: T[],
  accountId: string,
): T[] {
  if (!accountId) return entries
  return entries.filter((entry) => entry.account_id === accountId)
}
