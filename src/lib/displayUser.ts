/** חלק לפני @ — תווית עקבית ל"שם משתמש" בלי שם מלא. */
export function usernameFromEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim()
  if (!e) return ''
  const at = e.indexOf('@')
  return (at === -1 ? e : e.slice(0, at)).trim()
}

/** תווית לחבר בית: קודם local-part, אחרת מזהה קצר, אחרת טקסט ברירת מחדל. */
export function householdMemberUsernameLabel(
  email: string | null | undefined,
  userId: string,
  fallback = 'חבר בית',
): string {
  const u = usernameFromEmail(email)
  if (u) return u
  if (userId.length >= 8) return userId.slice(0, 8)
  return fallback
}

/** שם תצוגה ברשימת חברי בית: שם מלא מפרופיל, אחרת שם משתמש מהאימייל. */
export function memberProfileDisplayName(
  fullName: string | null | undefined,
  email: string | null | undefined,
  userId: string,
  fallback = 'חבר בית',
): string {
  const n = fullName?.trim()
  if (n) return n
  return householdMemberUsernameLabel(email, userId, fallback)
}
