import { isMemberScope, type MemberScope } from './memberScope'

const storageKey = (householdId: string) => `finance-view:${householdId}`

export function readStoredView(householdId: string): { scope?: MemberScope; month?: string } {
  try {
    const raw = localStorage.getItem(storageKey(householdId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { scope?: string; month?: string }
    const scope = parsed.scope && isMemberScope(parsed.scope) ? parsed.scope : undefined
    const month = parsed.month && /^\d{4}-\d{2}$/.test(parsed.month) ? parsed.month : undefined
    return { scope, month }
  } catch {
    return {}
  }
}

export function writeStoredView(householdId: string, scope: MemberScope, month: string) {
  try {
    localStorage.setItem(storageKey(householdId), JSON.stringify({ scope, month }))
  } catch {
    /* ignore quota / private mode */
  }
}
