-- Accounts support: allow selecting account per transaction.

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete set null,
  name text not null,
  is_shared boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create index if not exists idx_financial_accounts_household_active
  on public.financial_accounts (household_id, active);

alter table public.financial_accounts enable row level security;

create policy "Members can read financial accounts"
  on public.financial_accounts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = financial_accounts.household_id
        and hm.user_id = auth.uid()
    )
  );

create policy "Members can create financial accounts"
  on public.financial_accounts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = financial_accounts.household_id
        and hm.user_id = auth.uid()
    )
  );

create policy "Members can update financial accounts"
  on public.financial_accounts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = financial_accounts.household_id
        and hm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = financial_accounts.household_id
        and hm.user_id = auth.uid()
    )
  );

alter table public.transactions
  add column if not exists account_id uuid references public.financial_accounts (id) on delete set null;

create index if not exists idx_transactions_account_id on public.transactions (account_id);

