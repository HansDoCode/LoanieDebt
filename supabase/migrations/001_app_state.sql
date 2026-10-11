create table if not exists public.app_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "owners can read their app state" on public.app_state;
create policy "owners can read their app state"
  on public.app_state for select
  using (auth.uid() = owner_id);

drop policy if exists "owners can insert their app state" on public.app_state;
create policy "owners can insert their app state"
  on public.app_state for insert
  with check (auth.uid() = owner_id);

drop policy if exists "owners can update their app state" on public.app_state;
create policy "owners can update their app state"
  on public.app_state for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- The MVP stores one owner’s ledger as one JSON document so each write is atomic.
-- Keep signature files in a private bucket when signature uploads are added.
