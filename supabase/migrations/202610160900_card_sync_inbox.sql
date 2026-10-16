-- Financial credentials are never stored in this database.
create table public.card_import_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_key text not null check (source_key ~ '^[a-f0-9]{64}$'),
  provider text not null check (provider in ('max','visaCal','isracard','amex')),
  card_label text not null check (length(card_label) <= 4),
  amount numeric(12,2) not null check (amount > 0),
  type public.transaction_type not null,
  occurred_on date not null,
  description text not null check (length(description) <= 600),
  status text not null default 'pending' check (status in ('pending','imported','ignored')),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, owner_id, source_key),
  unique (transaction_id)
);
alter table public.card_import_items enable row level security;
create policy "Owner reads card inbox" on public.card_import_items for select to authenticated
using (owner_id = auth.uid() and public.auth_user_in_household(household_id));
create policy "Owner stages card charges" on public.card_import_items for insert to authenticated
with check (owner_id = auth.uid() and public.auth_user_in_household(household_id) and status = 'pending' and transaction_id is null);
grant select, insert on public.card_import_items to authenticated;
revoke update, delete on public.card_import_items from authenticated;

-- Locks make double-clicks and simultaneous reviews idempotent. A matched manual or
-- recurring transaction is linked, not added a second time or overwritten.
create or replace function public.review_card_import(p_id uuid, p_action text,
  p_account_id uuid default null, p_category text default 'אחר', p_match_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare item public.card_import_items; target public.transactions; result_id uuid;
begin
  select * into item from public.card_import_items where id = p_id for update;
  if not found or item.owner_id <> auth.uid() or auth.uid() is null
    or not public.auth_user_in_household(item.household_id) then
    raise exception 'Access denied';
  end if;
  if item.status <> 'pending' then return item.transaction_id; end if;
  if p_action = 'ignore' then
    update public.card_import_items set status = 'ignored' where id = p_id;
    return null;
  end if;
  if p_action <> 'import' or p_action is null then raise exception 'Invalid action'; end if;
  if p_match_id is not null then
    select * into target from public.transactions where id = p_match_id for update;
    if not found or target.household_id <> item.household_id or target.owner_id <> auth.uid()
      or target.planned or target.type <> item.type or target.amount <> item.amount then
      raise exception 'Transaction does not match';
    end if;
    result_id := target.id;
  else
    if p_category is null or length(trim(p_category)) = 0 or length(p_category) > 100 then raise exception 'Invalid category'; end if;
    if not exists (select 1 from public.financial_accounts where id = p_account_id
      and household_id = item.household_id and active
      and (owner_user_id = auth.uid() or is_shared)) then raise exception 'Invalid account'; end if;
    insert into public.transactions(household_id, owner_id, account_id, type, amount, category, note, occurred_on, planned)
    values(item.household_id, auth.uid(), p_account_id, item.type, item.amount, p_category, item.description, item.occurred_on, false)
    returning id into result_id;
  end if;
  update public.card_import_items set status = 'imported', transaction_id = result_id where id = p_id;
  return result_id;
end $$;
revoke all on function public.review_card_import(uuid,text,uuid,text,uuid) from public, anon;
grant execute on function public.review_card_import(uuid,text,uuid,text,uuid) to authenticated;
