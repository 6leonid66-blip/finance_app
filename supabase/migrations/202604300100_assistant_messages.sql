-- Persistent chat history for the household assistant.

create extension if not exists "pgcrypto";

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_household_created_idx
  on public.assistant_messages (household_id, created_at desc);

alter table public.assistant_messages enable row level security;

drop policy if exists "Members can read household chat" on public.assistant_messages;
create policy "Members can read household chat"
  on public.assistant_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = assistant_messages.household_id
        and hm.user_id = auth.uid()
    )
  );

drop policy if exists "Members can insert own chat messages" on public.assistant_messages;
create policy "Members can insert own chat messages"
  on public.assistant_messages
  for insert
  to authenticated
  with check (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id = assistant_messages.household_id
        and hm.user_id = auth.uid()
    )
  );

drop policy if exists "Members can delete own chat messages" on public.assistant_messages;
create policy "Members can delete own chat messages"
  on public.assistant_messages
  for delete
  to authenticated
  using (auth.uid() = owner_id);
