import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('card inbox migration enforces ownership, idempotency and explicit reconciliation', async () => {
  const db = new PGlite()
  const user = '00000000-0000-0000-0000-000000000001'
  const other = '00000000-0000-0000-0000-000000000002'
  const home = '00000000-0000-0000-0000-000000000003'
  const account = '00000000-0000-0000-0000-000000000004'
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.households(id uuid primary key);
      create table public.household_members(household_id uuid, user_id uuid);
      create function public.auth_user_in_household(h uuid) returns boolean language sql stable security definer
        as $$ select exists(select 1 from public.household_members where household_id=h and user_id=auth.uid()) $$;
      create type public.transaction_type as enum ('income','expense');
      create table public.financial_accounts(id uuid primary key, household_id uuid, owner_user_id uuid, is_shared boolean, active boolean);
      create table public.transactions(id uuid primary key default gen_random_uuid(), household_id uuid, owner_id uuid,
        account_id uuid, type public.transaction_type, amount numeric(12,2), category text, note text, occurred_on date, planned boolean);
      insert into auth.users values ('${user}'),('${other}');
      insert into public.households values ('${home}');
      insert into public.household_members values ('${home}','${user}'),('${home}','${other}');
      insert into public.financial_accounts values ('${account}','${home}','${user}',false,true);
      grant usage on schema public,auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      set test.uid='${user}';
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/202610160900_card_sync_inbox.sql', import.meta.url), 'utf8'))
    await db.exec('set role authenticated')
    const add = async (key: string, amount = 50) => {
      const response = await db.query<{ id: string }>(`insert into card_import_items(household_id, source_key, provider, card_label, amount, type, occurred_on, description)
        values($1,$2,'max','1234',$3,'expense','2026-10-01','test') returning id`, [home, key.repeat(64), amount])
      return response.rows[0].id
    }
    const id = await add('a')
    await db.query(`insert into card_import_items(household_id, source_key, provider, card_label, amount, type, occurred_on, description)
      values($1,$2,'max','1234',50,'expense','2026-10-01','test') on conflict(household_id,owner_id,source_key) do nothing`, [home, 'a'.repeat(64)])
    assert.equal((await db.query('select * from card_import_items')).rows.length, 1)
    await db.exec(`set test.uid='${other}'`)
    assert.equal((await db.query('select * from card_import_items')).rows.length, 0)
    await assert.rejects(db.query("select review_card_import($1,'import',$2)", [id, account]), /Access denied/)
    await db.exec(`set test.uid='${user}'`)
    await assert.rejects(db.query("select review_card_import($1,'import',null)", [id]), /Invalid account/)
    const first = await db.query<{ review_card_import: string }>("select review_card_import($1,'import',$2,'מזון')", [id, account])
    const repeated = await db.query("select review_card_import($1,'import',$2,'מזון')", [id, account])
    assert.deepEqual(first.rows, repeated.rows)
    await assert.rejects(db.query("update card_import_items set status='pending' where id=$1", [id]), /permission denied/)
    const ignored = await add('b')
    await db.query("select review_card_import($1,'ignore')", [ignored])
    const ignoredAgain = await db.query<{ review_card_import: null }>("select review_card_import($1,'import',$2)", [ignored, account])
    assert.equal(ignoredAgain.rows[0].review_card_import, null)
    await db.exec('reset role')
    assert.equal((await db.query('select * from transactions')).rows.length, 1)
    const manual = await db.query<{ id: string }>(`insert into transactions(household_id,owner_id,account_id,type,amount,category,occurred_on,planned)
      values($1,$2,$3,'expense',70,'מזון','2026-10-01',false) returning id`, [home,user,account])
    await db.exec('set role authenticated')
    const match = await add('c', 70)
    await db.query("select review_card_import($1,'import',null,'אחר',$2)", [match, manual.rows[0].id])
    const wrongAmount = await add('d', 90)
    await assert.rejects(db.query("select review_card_import($1,'import',null,'אחר',$2)", [wrongAmount, manual.rows[0].id]), /does not match/)
    const doubleMatch = await add('e', 70)
    await assert.rejects(db.query("select review_card_import($1,'import',null,'אחר',$2)", [doubleMatch, manual.rows[0].id]), /unique constraint/)
    await db.exec('reset role')
    assert.equal((await db.query('select * from transactions')).rows.length, 2)
  } finally { await db.close() }
})
