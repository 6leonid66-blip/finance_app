import type { RecurringEndRule } from '../types'

/** תווית חודש קצרה לתצוגה (מחודש YYYY-MM לפי לוח שנה עברי) */
export function monthKeyToShortHe(monthKey: string): string {
  const [y, m] = monthKey.slice(0, 7).split('-').map(Number)
  if (!y || !m) return monthKey.slice(0, 7)
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'short', year: 'numeric' })
}

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
  asOfMonthKey: string,
  totalMonthlyPayments: number,
): number {
  const startMk = templateStartMonth.slice(0, 7)
  const mk = asOfMonthKey.slice(0, 7)
  const span = inclusiveMonthSpan(startMk, mk)
  if (span <= 0) return 1
  return Math.min(totalMonthlyPayments, span)
}

/**
 * טקסט לפיד תנועות: נקודת מבט = החודש שבוחרים בפיקר (לא רק התאריך בשורה).
 * מציג: החודש בפיקר, תשלום X מתוך Y מתוך מה שהוגדר מההתחלה, והתחלה בפועל, וכמה חודשים נשארו עד הסיום.
 */
export function installmentProgressLabel({
  /** חודש YYYY-MM — המסך הנבחר (למשל אפריל ⇒ חישוב "עד" אפריל) */
  asOfMonthKey,
  template_start_month,
  end_rule,
  end_month,
  max_installments,
}: {
  asOfMonthKey: string
  template_start_month: string
  end_rule: RecurringEndRule
  end_month: string | null
  max_installments: number | null
}): string | null {
  const startMk = template_start_month.slice(0, 7)
  const curMk = asOfMonthKey.slice(0, 7)
  const viewHe = monthKeyToShortHe(curMk)
  const startHe = monthKeyToShortHe(startMk)

  if (end_rule === 'fixed_installments' && max_installments != null && max_installments > 0) {
    const total = max_installments
    const idx = installmentIndex(template_start_month, curMk, total)
    const remaining = Math.max(0, total - idx)
    return `ב-${viewHe}: תשלום ${idx} מתוך ${total} · התחלה ${startHe} · עוד ${remaining} חודשים`
  }

  if (end_rule === 'until_month' && end_month) {
    const endMk = end_month.slice(0, 7)
    const total = inclusiveMonthSpan(startMk, endMk)
    if (total <= 0) return null
    const idx = installmentIndex(template_start_month, curMk, total)
    const remaining = Math.max(0, total - idx)
    return `ב-${viewHe}: תשלום ${idx} מתוך ${total} · התחלה ${startHe} · עוד ${remaining} חודשים`
  }

  return null
}
