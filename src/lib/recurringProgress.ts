import type { RecurringEndRule } from '../types'

/** מספר חודשים (כולל קצה) בין שני תאריכי חודש YYYY-MM, כשנקודות יציבות בסדר צד — אחרת נחזיר 0. */
export function inclusiveMonthSpan(monthKeyStart: string, monthKeyEnd: string): number {
  const a = monthKeyStart.slice(0, 7)
  const b = monthKeyEnd.slice(0, 7)
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  if (!ay || !am || !by || !bm) return 0
  const raw = (by - ay) * 12 + (bm - am) + 1
  return Math.max(0, raw)
}

/** באיזה תשלום חודשי אנחנו (מ־1) ביחס לתחילה ולאורך הקבוע הנקוב בחודשים */
export function installmentIndex(
  templateStartMonth: string,
  occurredOrViewMonthKey: string,
  totalMonthlyPayments: number,
): number {
  const startMk = templateStartMonth.slice(0, 7)
  const mk = occurredOrViewMonthKey.slice(0, 7)
  const span = inclusiveMonthSpan(startMk, mk)
  if (span <= 0) return 1
  return Math.min(totalMonthlyPayments, span)
}

/**
 * טקסט קצר לפיד התנועות: "תשלום X מתוך Y · נשארו Z חודשים"
 * מתאים למספר תשלומים קבוע או לטווח "עד חודש סיום".
 */
export function installmentProgressLabel({
  occurredOnMonthKey,
  template_start_month,
  end_rule,
  end_month,
  max_installments,
}: {
  occurredOnMonthKey: string
  template_start_month: string
  end_rule: RecurringEndRule
  end_month: string | null
  max_installments: number | null
}): string | null {
  const startMk = template_start_month.slice(0, 7)
  const curMk = occurredOnMonthKey.slice(0, 7)

  if (end_rule === 'fixed_installments' && max_installments != null && max_installments > 0) {
    const total = max_installments
    const idx = installmentIndex(template_start_month, curMk, total)
    const remaining = Math.max(0, total - idx)
    return `תשלום ${idx} מתוך ${total} · נשארו ${remaining} חודשים`
  }

  if (end_rule === 'until_month' && end_month) {
    const endMk = end_month.slice(0, 7)
    const total = inclusiveMonthSpan(startMk, endMk)
    if (total <= 0) return null
    const idx = installmentIndex(template_start_month, curMk, total)
    const remaining = Math.max(0, total - idx)
    return `תשלום ${idx} מתוך ${total} · נשארו ${remaining} חודשים`
  }

  return null
}
