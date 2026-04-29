-- Fix ON CONFLICT inference for auto-post transactions.
-- Previous partial unique index cannot always be inferred by ON CONFLICT clause.

drop index if exists public.idx_transactions_auto_post_unique;

create unique index if not exists idx_transactions_auto_post_unique_full
  on public.transactions (household_id, auto_post_template_id, auto_post_month);

