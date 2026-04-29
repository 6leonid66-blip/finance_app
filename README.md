# Finance App (Family Budget)

MVP לאפליקציית ניהול כספים משפחתית עם:
- התחברות משתמשים (Supabase Auth)
- דשבורד מובייל-פרסט + ניווט תחתון
- הוספת הוצאה/הכנסה מהירה (FAB + גיליון)
- תכנון חודשי לפי קטגוריות (רשימת קטגוריות בעברית)
- תבניות חוזרות (סכום קבוע / תקציב משתנה) ומילוי אוטומטי ל־`monthly_plans`
- השוואה בין מתוכנן לפועל, כולל מי הזין כל תנועה

## Stack

- React + TypeScript + Vite
- Supabase (Auth + Postgres + RLS)
- מוכן לפריסה ב-Vercel

## התחלה מהירה

1. התקנת תלויות:

```bash
npm install
```

2. יצירת קובץ סביבה:

```powershell
Copy-Item .env.example .env
```

3. עדכון ערכים ב-`.env`:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY` — צד שרת בלבד, ללא תחילית `VITE_`. נטען רק על ידי הפונקציה `api/gemini.ts` ב-Vercel ולא נחשף לדפדפן. החלפת המפתח דורשת רק עדכון ב-Vercel + Redeploy אחד, בלי לבנות מחדש את ה-frontend.

4. הרצת פיתוח:

```bash
# Frontend בלבד (אבל אז קריאות /api/gemini לא יעבדו מקומית):
npm run dev

# מומלץ: פיתוח שמכיל גם את הפונקציה /api/gemini (דורש Vercel CLI):
npx vercel dev
```

> בפריסה ב-Vercel: הוסף את `GEMINI_API_KEY` ב-Project Settings → Environment Variables (Production + Preview) ועשה Redeploy.

## מיגרציה ל-Supabase (פרויקט חדש וריק)

קבצי מיגרציה (להריץ לפי הסדר):
- `supabase/migrations/202604282255_init_finance_app.sql` — טבלאות בסיס + RLS
- `supabase/migrations/202604290000_recurring_templates.sql` — תבניות חוזרות + פונקציה `ensure_month_plans_from_templates`
- `supabase/migrations/202604290030_recurring_template_end_rules.sql` — תאריך סיום / מספר תשלומים / ללא הגבלה לקבועים
- `supabase/migrations/202604290045_fix_household_members_rls.sql` — תיקון RLS לקריאת membership של המשתמש
- `supabase/migrations/202604290055_fix_household_insert_rls.sql` — תיקון יצירת household לפי `auth.uid()`
- `supabase/migrations/202604290105_bootstrap_household_rpc.sql` — RPC יציב ליצירה/שליפה של household ראשוני
- `supabase/migrations/202604290120_fix_bootstrap_household_ambiguous.sql` — תיקון שגיאת `household_id is ambiguous` ב-RPC
- `supabase/migrations/202604290140_financial_accounts.sql` — תמיכה בחשבונות (בחירה לכל תנועה)
- `supabase/migrations/202604290145_transactions_account_guard.sql` — בדיקת התאמה בין `account_id` ל־`household`
- `supabase/migrations/202604290235_fix_auto_post_conflict_index.sql` — תיקון unique index ל-auto-post
- `supabase/migrations/202604290240_fix_auto_post_function_conflict.sql` — תיקון פונקציית auto-post למניעת שגיאת ON CONFLICT
- `supabase/migrations/202604290200_receipts_storage.sql` — קבצים מצורפים לתנועות + bucket/policies ב-Storage
- `supabase/migrations/202604290230_recurring_auto_post_transactions.sql` — דגל auto-post לקבועים + יצירת transactions אוטומטית (ללא כפילויות) לכל חודש
- `supabase/migrations/202604300100_assistant_messages.sql` — היסטוריית הצ׳אט של העוזר האישי (per-household, per-user RLS)

אפשרות 1 (SQL Editor ב-Supabase):
- לפתוח את SQL Editor
- להדביק את תוכן הקובץ
- להריץ

אפשרות 2 (Supabase CLI):

```bash
supabase link --project-ref qtaotqswcxhqhcefosar
supabase db push
```

> אם אין לך CLI מקומית:
> `npm install -g supabase`

## מה נבנה כרגע

- משתמש נרשם/מתחבר
- אם אין לו בית, נוצר אוטומטית `הבית שלנו`
- דשבורד + תנועות + תכנון + מסך קבועים
- FAB להוספת הוצאה/הכנסה; טופס מפורט במסך תנועות
- אחרי הרצת מיגרציית recurring: בכל טעינת חודש נקראת `ensure_month_plans_from_templates` ומתעדכן התכנון לפי התבניות
- ניתן לצלם/להעלות קבלה, לנתח ב-AI למילוי אוטומטי, ולשמור קובץ מצורף לתנועה עם אפשרות עריכה/החלפה
- מסך **השוואה לבנק**: העלאת דף תנועות (CSV / Excel / PDF / תמונה) לטווח חודשים, ניתוח אוטומטי (CSV/Excel נפתח בצד הלקוח עם SheetJS, PDF/תמונה נשלח ל-Gemini), השוואה מול התנועות הקיימות, והוספה מרובה / מחיקה
- מסך **עוזר אישי** (Gemini Chat): צ׳אט בעברית מבוסס נתוני הקלסר שלך (חודש נוכחי, 3 חודשים אחרונים, קטגוריות מובילות, 30 תנועות אחרונות). בקשה להוסיף הוצאה/הכנסה פותחת את טופס ההוספה עם שדות מולאים מראש לאישור

## המשך מומלץ

- הזמנת בן/בת זוג לבית קיים (invite by email)
- קטגוריזציה אוטומטית לפי תיאור עסקה
- יבוא אוטומטי מחברות אשראי/בנק (job יומי)
- התאמות חכמות בין תכנון לפועל + התראות
