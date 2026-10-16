export type InsightSnapshot = {
  monthKey: string
  monthLabel: string
  scopeLabel: string
  household: { income: number; expense: number; remaining: number }
  people: Array<{
    name: string
    income: number
    expense: number
    remaining: number
    topExpenses: Array<{ category: string; amount: number }>
  }>
  shared: { income: number; expense: number; remaining: number; topExpenses: Array<{ category: string; amount: number }> }
  householdTopExpenses: Array<{ category: string; amount: number }>
}
