import type { RecurringEndRule, RecurringMode } from '../types'

export interface RecurringPresetRow {
  category: string
  label: string
  amount: number
  mode: RecurringMode
  endRule: RecurringEndRule
}

export const DEFAULT_FIXED_EXPENSE_PRESET: RecurringPresetRow[] = [
  { category: 'הלוואה', label: 'הלוואה לימודים', amount: 550, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'הלוואה', label: 'הלוואה פועלים', amount: 660, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'הלוואה', label: 'הלוואת MAX', amount: 1200, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'הלוואה', label: 'הסדר חוב כפר', amount: 750, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'תקשורת ואינטרנט', label: 'חשבון סלולר', amount: 40, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'קופת חולים', label: 'מאוחדת', amount: 130, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'קופת חולים', label: 'מכבי', amount: 120, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'תקשורת ואינטרנט', label: 'אינטרנט בית', amount: 200, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'שכירות', label: 'שכירות', amount: 3800, mode: 'fixed_amount', endRule: 'unlimited' },
  { category: 'חשמל', label: 'חשמל', amount: 0, mode: 'variable_budget', endRule: 'unlimited' },
  { category: 'תחבורה ודלק', label: 'רכב', amount: 2250, mode: 'fixed_amount', endRule: 'unlimited' },
]
