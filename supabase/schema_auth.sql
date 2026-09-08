create extension if not exists pgcrypto;

create table if not exists public.app_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  payment_alias text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  trip_key_hash text not null,
  owner_id uuid not null references public.app_profiles(id) on delete restrict,
  currency text not null default 'ARS',
  status text not null default 'active' check (status in ('active', 'closed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.app_trips(id) on delete cascade,
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  role text not null default 'participant' check (role in ('organizer', 'participant', 'readonly')),
  joined_at timestamptz not null default now(),
  unique (trip_id, profile_id)
);

create table if not exists public.app_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.app_trips(id) on delete cascade,
  title text not null,
  amount numeric(12,2) not null check (amount > 0),
  payer_member_id uuid not null references public.app_trip_members(id) on delete restrict,
  created_by_member_id uuid not null references public.app_trip_members(id) on delete restrict,
  category text,
  created_at timestamptz not null default now()
);

create table if not exists public.app_expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.app_expenses(id) on delete cascade,
  member_id uuid not null references public.app_trip_members(id) on delete cascade,
  share_amount numeric(12,2) not null check (share_amount >= 0),
  unique (expense_id, member_id)
);

alter table public.app_profiles enable row level security;
alter table public.app_trips enable row level security;
alter table public.app_trip_members enable row level security;
alter table public.app_expenses enable row level security;
alter table public.app_expense_splits enable row level security;

create index if not exists app_trip_members_trip_id_idx on public.app_trip_members(trip_id);
create index if not exists app_trip_members_profile_id_idx on public.app_trip_members(profile_id);
create index if not exists app_expenses_trip_id_idx on public.app_expenses(trip_id);
create index if not exists app_expense_splits_expense_id_idx on public.app_expense_splits(expense_id);

create or replace function public.app_hash_trip_key(raw_key text)
returns text
language sql
stable
as $$
  select encode(digest(trim(raw_key), 'sha256'), 'hex')
$$;

create or replace function public.app_create_trip(trip_name text, trip_key text, display_name text)
returns table (trip_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_trip_id uuid;
  new_invite_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.app_profiles (id, email, display_name)
  values (auth.uid(), coalesce(auth.email(), ''), display_name)
  on conflict (id) do update
  set display_name = excluded.display_name,
      email = excluded.email,
      updated_at = now();

  new_invite_code := lower(encode(gen_random_bytes(5), 'hex'));

  insert into public.app_trips (name, invite_code, trip_key_hash, owner_id)
  values (trip_name, new_invite_code, public.app_hash_trip_key(trip_key), auth.uid())
  returning id into new_trip_id;

  insert into public.app_trip_members (trip_id, profile_id, role)
  values (new_trip_id, auth.uid(), 'organizer');

  return query select new_trip_id, new_invite_code;
end;
$$;

create or replace function public.app_join_trip(invite text, trip_key text, display_name text)
returns table (trip_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  found_trip public.app_trips%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into found_trip
  from public.app_trips
  where app_trips.invite_code = trim(invite)
    and app_trips.trip_key_hash = public.app_hash_trip_key(trip_key);

  if found_trip.id is null then
    raise exception 'trip not found';
  end if;

  insert into public.app_profiles (id, email, display_name)
  values (auth.uid(), coalesce(auth.email(), ''), display_name)
  on conflict (id) do update
  set display_name = excluded.display_name,
      email = excluded.email,
      updated_at = now();

  insert into public.app_trip_members (trip_id, profile_id, role)
  values (found_trip.id, auth.uid(), 'participant')
  on conflict (trip_id, profile_id) do nothing;

  return query select found_trip.id, found_trip.invite_code;
end;
$$;

grant execute on function public.app_create_trip(text, text, text) to authenticated;
grant execute on function public.app_join_trip(text, text, text) to authenticated;

create policy "own profile select" on public.app_profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.app_trip_members mine
    join public.app_trip_members other_member on other_member.trip_id = mine.trip_id
    where mine.profile_id = (select auth.uid())
      and other_member.profile_id = app_profiles.id
  )
);

create policy "own profile update" on public.app_profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "member trips select" on public.app_trips
for select to authenticated
using (
  exists (
    select 1 from public.app_trip_members
    where app_trip_members.trip_id = app_trips.id
      and app_trip_members.profile_id = (select auth.uid())
  )
);

create policy "member rows select" on public.app_trip_members
for select to authenticated
using (
  exists (
    select 1 from public.app_trip_members mine
    where mine.trip_id = app_trip_members.trip_id
      and mine.profile_id = (select auth.uid())
  )
);

create policy "member expenses select" on public.app_expenses
for select to authenticated
using (
  exists (
    select 1 from public.app_trip_members
    where app_trip_members.trip_id = app_expenses.trip_id
      and app_trip_members.profile_id = (select auth.uid())
  )
);

create policy "member expenses insert" on public.app_expenses
for insert to authenticated
with check (
  exists (
    select 1 from public.app_trip_members
    where app_trip_members.trip_id = app_expenses.trip_id
      and app_trip_members.profile_id = (select auth.uid())
      and app_trip_members.id = app_expenses.created_by_member_id
  )
  and exists (
    select 1 from public.app_trip_members payer
    where payer.trip_id = app_expenses.trip_id
      and payer.id = app_expenses.payer_member_id
  )
);

create policy "member splits select" on public.app_expense_splits
for select to authenticated
using (
  exists (
    select 1
    from public.app_expenses
    join public.app_trip_members on app_trip_members.trip_id = app_expenses.trip_id
    where app_expenses.id = app_expense_splits.expense_id
      and app_trip_members.profile_id = (select auth.uid())
  )
);

create policy "member splits insert" on public.app_expense_splits
for insert to authenticated
with check (
  exists (
    select 1
    from public.app_expenses
    join public.app_trip_members on app_trip_members.trip_id = app_expenses.trip_id
    where app_expenses.id = app_expense_splits.expense_id
      and app_trip_members.profile_id = (select auth.uid())
  )
);
