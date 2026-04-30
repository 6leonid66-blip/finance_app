export type EntryType = 'income' | 'expense'

export type RecurringDirection = 'income' | 'expense'
export type RecurringMode = 'fixed_amount' | 'variable_budget'
export type RecurringEndRule = 'unlimited' | 'until_month' | 'fixed_installments'

export interface Household {
  id: string
  name: string
}

/** חבר בית לרצועת "המשפחה שלנו" — נטען מ-household_members + profiles. */
export type HouseholdMemberBrief = {
  userId: string
  displayName: string
  avatarUrl: string | null
}

export interface FinanceEntry {
  id: string
  owner_id: string
  account_id: string | null
  receipt_path: string | null
  receipt_filename: string | null
  receipt_mime_type: string | null
  receipt_size_bytes: number | null
  auto_post_template_id?: string | null
  auto_post_month?: string | null
  type: EntryType
  amount: number
  category: string
  note: string | null
  occurred_on: string
  planned: boolean
  created_at: string
  owner_email?: string | null
  owner_name?: string | null
  owner_avatar_url?: string | null
  account_name?: string | null
  receipt_url?: string | null
  is_fixed?: boolean
  is_auto_from_recurring?: boolean
  installment_progress_label?: string | null
}

export interface MonthlyPlan {
  id: string
  category: string
  planned_income: number
  planned_expense: number
}

export interface RecurringTemplate {
  id: string
  household_id: string
  direction: RecurringDirection
  category: string
  label: string | null
  mode: RecurringMode
  default_amount: number
  template_start_month: string
  end_rule: RecurringEndRule
  end_month: string | null
  max_installments: number | null
  auto_post_as_actual?: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface FinancialAccount {
  id: string
  household_id: string
  owner_user_id: string | null
  name: string
  is_shared: boolean
  active: boolean
  created_at: string
}

export interface UserProfileView {
  full_name: string | null
  email: string | null
  avatar_path: string | null
  avatar_url: string | null
}

export type AppScreen = 'dashboard' | 'transactions' | 'recurring' | 'reconcile' | 'assistant'
