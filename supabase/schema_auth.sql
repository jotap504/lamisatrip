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
  departure_at timestamptz,
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

create table if not exists public.app_expense_stages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.app_trips(id) on delete cascade,
  name text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by_member_id uuid references public.app_trip_members(id) on delete set null,
  closed_by_member_id uuid references public.app_trip_members(id) on delete set null,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_expenses
add column if not exists stage_id uuid references public.app_expense_stages(id) on delete set null;

alter table public.app_trips
add column if not exists departure_at timestamptz;

create table if not exists public.app_expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.app_expenses(id) on delete cascade,
  member_id uuid not null references public.app_trip_members(id) on delete cascade,
  share_amount numeric(12,2) not null check (share_amount >= 0),
  unique (expense_id, member_id)
);

create table if not exists public.app_trip_checklist_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.app_trips(id) on delete cascade,
  title text not null,
  note text,
  created_by_member_id uuid references public.app_trip_members(id) on delete set null,
  claimed_by_member_id uuid references public.app_trip_members(id) on delete set null,
  claimed_by_text text,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_trip_checklist_items
add column if not exists claimed_by_text text;

alter table public.app_profiles enable row level security;
alter table public.app_trips enable row level security;
alter table public.app_trip_members enable row level security;
alter table public.app_expenses enable row level security;
alter table public.app_expense_stages enable row level security;
alter table public.app_expense_splits enable row level security;
alter table public.app_trip_checklist_items enable row level security;

create index if not exists app_trip_members_trip_id_idx on public.app_trip_members(trip_id);
create index if not exists app_trip_members_profile_id_idx on public.app_trip_members(profile_id);
create index if not exists app_expenses_trip_id_idx on public.app_expenses(trip_id);
create index if not exists app_expenses_stage_id_idx on public.app_expenses(stage_id);
create index if not exists app_expense_stages_trip_id_idx on public.app_expense_stages(trip_id);
create unique index if not exists app_expense_stages_one_open_per_trip_idx
on public.app_expense_stages(trip_id)
where status = 'open';
create index if not exists app_expense_splits_expense_id_idx on public.app_expense_splits(expense_id);
create index if not exists app_trip_checklist_items_trip_id_idx on public.app_trip_checklist_items(trip_id);

grant select, insert, update, delete on table public.app_expenses to authenticated;
grant select, insert, update, delete on table public.app_expense_splits to authenticated;
grant select, insert, update on table public.app_trip_checklist_items to authenticated;

create or replace function public.app_hash_trip_key(raw_key text)
returns text
language sql
stable
as $$
  select encode(extensions.digest(trim(raw_key), 'sha256'), 'hex')
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

  new_invite_code := lower(encode(extensions.gen_random_bytes(5), 'hex'));

  insert into public.app_trips (name, invite_code, trip_key_hash, owner_id)
  values (trip_name, new_invite_code, public.app_hash_trip_key(trip_key), auth.uid())
  returning id into new_trip_id;

  insert into public.app_trip_members (trip_id, profile_id, role)
  values (new_trip_id, auth.uid(), 'organizer');

  insert into public.app_expense_stages (trip_id, name, created_by_member_id)
  select new_trip_id, 'Etapa 1', app_trip_members.id
  from public.app_trip_members
  where app_trip_members.trip_id = new_trip_id
    and app_trip_members.profile_id = auth.uid();

  return query select new_trip_id as trip_id, new_invite_code as invite_code;
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
  on conflict on constraint app_trip_members_trip_id_profile_id_key do nothing;

  return query select found_trip.id as trip_id, found_trip.invite_code as invite_code;
end;
$$;

grant execute on function public.app_create_trip(text, text, text) to authenticated;
grant execute on function public.app_join_trip(text, text, text) to authenticated;

create or replace function public.app_claim_invited_trips(display_name text)
returns table (
  trip_id uuid,
  trip_name text,
  invite_code text,
  trip_status text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
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

  if auth.email() is not null then
    delete from public.app_trip_members
    where app_trip_members.profile_id is null
      and lower(app_trip_members.guest_email) = lower(auth.email())
      and exists (
        select 1
        from public.app_trip_members existing_member
        where existing_member.trip_id = app_trip_members.trip_id
          and existing_member.profile_id = auth.uid()
      );

    update public.app_trip_members
    set profile_id = auth.uid(),
        guest_name = coalesce(app_trip_members.guest_name, display_name),
        guest_email = coalesce(app_trip_members.guest_email, lower(auth.email()))
    where app_trip_members.profile_id is null
      and lower(app_trip_members.guest_email) = lower(auth.email());
  end if;

  return query
  select
    app_trips.id as trip_id,
    app_trips.name as trip_name,
    app_trips.invite_code,
    app_trips.status as trip_status,
    app_trip_members.joined_at
  from public.app_trip_members
  join public.app_trips on app_trips.id = app_trip_members.trip_id
  where app_trip_members.profile_id = auth.uid()
  order by app_trip_members.joined_at desc;
end;
$$;

grant execute on function public.app_claim_invited_trips(text) to authenticated;

create or replace function public.app_update_trip_departure(target_trip_id uuid, departure_at_value timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.app_trip_members
    where app_trip_members.trip_id = target_trip_id
      and app_trip_members.profile_id = auth.uid()
  ) then
    raise exception 'not a trip member';
  end if;

  update public.app_trips
  set departure_at = departure_at_value,
      updated_at = now()
  where app_trips.id = target_trip_id;
end;
$$;

grant execute on function public.app_update_trip_departure(uuid, timestamptz) to authenticated;

create or replace function public.app_reset_trip_records(target_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.app_trips
    where app_trips.id = target_trip_id
      and app_trips.owner_id = auth.uid()
  ) then
    raise exception 'only the trip owner can reset records';
  end if;

  select app_trip_members.id into owner_member_id
  from public.app_trip_members
  where app_trip_members.trip_id = target_trip_id
    and app_trip_members.profile_id = auth.uid()
  limit 1;

  delete from public.app_expenses
  where app_expenses.trip_id = target_trip_id;

  delete from public.app_expense_stages
  where app_expense_stages.trip_id = target_trip_id;

  insert into public.app_expense_stages (trip_id, name, created_by_member_id)
  values (target_trip_id, 'Etapa 1', owner_member_id);
end;
$$;

grant execute on function public.app_reset_trip_records(uuid) to authenticated;

create or replace function public.app_is_trip_member(check_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_trip_members
    where app_trip_members.trip_id = check_trip_id
      and app_trip_members.profile_id = auth.uid()
  )
$$;

revoke all on function public.app_is_trip_member(uuid) from public;
grant execute on function public.app_is_trip_member(uuid) to authenticated;

drop policy if exists "own profile select" on public.app_profiles;
drop policy if exists "own profile update" on public.app_profiles;
drop policy if exists "member trips select" on public.app_trips;
drop policy if exists "member rows select" on public.app_trip_members;
drop policy if exists "member expenses select" on public.app_expenses;
drop policy if exists "member expenses insert" on public.app_expenses;
drop policy if exists "member expenses update" on public.app_expenses;
drop policy if exists "member expenses delete" on public.app_expenses;
drop policy if exists "member stages select" on public.app_expense_stages;
drop policy if exists "member stages insert" on public.app_expense_stages;
drop policy if exists "member stages update" on public.app_expense_stages;
drop policy if exists "member splits select" on public.app_expense_splits;
drop policy if exists "member splits insert" on public.app_expense_splits;
drop policy if exists "member splits delete" on public.app_expense_splits;
drop policy if exists "member checklist select" on public.app_trip_checklist_items;
drop policy if exists "member checklist insert" on public.app_trip_checklist_items;
drop policy if exists "member checklist update" on public.app_trip_checklist_items;

create policy "own profile select" on public.app_profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.app_trip_members other_member
    where other_member.profile_id = app_profiles.id
      and public.app_is_trip_member(other_member.trip_id)
  )
);

create policy "own profile update" on public.app_profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "member trips select" on public.app_trips
for select to authenticated
using (public.app_is_trip_member(app_trips.id));

create policy "member rows select" on public.app_trip_members
for select to authenticated
using (public.app_is_trip_member(app_trip_members.trip_id));

create policy "member expenses select" on public.app_expenses
for select to authenticated
using (public.app_is_trip_member(app_expenses.trip_id));

create policy "member expenses insert" on public.app_expenses
for insert to authenticated
with check (
  public.app_is_trip_member(app_expenses.trip_id)
  and (
    app_expenses.stage_id is null
    or exists (
      select 1 from public.app_expense_stages
      where app_expense_stages.id = app_expenses.stage_id
        and app_expense_stages.trip_id = app_expenses.trip_id
        and app_expense_stages.status = 'open'
    )
  )
  and
  exists (
    select 1 from public.app_trip_members
    where app_trip_members.trip_id = app_expenses.trip_id
      and app_trip_members.id = app_expenses.created_by_member_id
      and app_trip_members.profile_id = (select auth.uid())
  )
  and exists (
    select 1 from public.app_trip_members payer
    where payer.trip_id = app_expenses.trip_id
      and payer.id = app_expenses.payer_member_id
  )
);

create policy "member expenses update" on public.app_expenses
for update to authenticated
using (
  public.app_is_trip_member(app_expenses.trip_id)
  and exists (
    select 1 from public.app_expense_stages
    where app_expense_stages.id = app_expenses.stage_id
      and app_expense_stages.trip_id = app_expenses.trip_id
      and app_expense_stages.status = 'open'
  )
)
with check (
  public.app_is_trip_member(app_expenses.trip_id)
  and exists (
    select 1 from public.app_expense_stages
    where app_expense_stages.id = app_expenses.stage_id
      and app_expense_stages.trip_id = app_expenses.trip_id
      and app_expense_stages.status = 'open'
  )
  and exists (
    select 1 from public.app_trip_members payer
    where payer.trip_id = app_expenses.trip_id
      and payer.id = app_expenses.payer_member_id
  )
);

create policy "member expenses delete" on public.app_expenses
for delete to authenticated
using (
  public.app_is_trip_member(app_expenses.trip_id)
  and exists (
    select 1 from public.app_expense_stages
    where app_expense_stages.id = app_expenses.stage_id
      and app_expense_stages.trip_id = app_expenses.trip_id
      and app_expense_stages.status = 'open'
  )
);

create policy "member stages select" on public.app_expense_stages
for select to authenticated
using (public.app_is_trip_member(app_expense_stages.trip_id));

create policy "member stages insert" on public.app_expense_stages
for insert to authenticated
with check (public.app_is_trip_member(app_expense_stages.trip_id));

create policy "member stages update" on public.app_expense_stages
for update to authenticated
using (public.app_is_trip_member(app_expense_stages.trip_id))
with check (public.app_is_trip_member(app_expense_stages.trip_id));

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

create policy "member splits delete" on public.app_expense_splits
for delete to authenticated
using (
  exists (
    select 1
    from public.app_expenses
    join public.app_expense_stages on app_expense_stages.id = app_expenses.stage_id
    where app_expenses.id = app_expense_splits.expense_id
      and public.app_is_trip_member(app_expenses.trip_id)
      and app_expense_stages.trip_id = app_expenses.trip_id
      and app_expense_stages.status = 'open'
  )
);

create policy "member checklist select" on public.app_trip_checklist_items
for select to authenticated
using (public.app_is_trip_member(app_trip_checklist_items.trip_id));

create policy "member checklist insert" on public.app_trip_checklist_items
for insert to authenticated
with check (
  public.app_is_trip_member(app_trip_checklist_items.trip_id)
  and (
    app_trip_checklist_items.created_by_member_id is null
    or exists (
      select 1
      from public.app_trip_members
      where app_trip_members.id = app_trip_checklist_items.created_by_member_id
        and app_trip_members.trip_id = app_trip_checklist_items.trip_id
        and app_trip_members.profile_id = (select auth.uid())
    )
  )
);

create policy "member checklist update" on public.app_trip_checklist_items
for update to authenticated
using (public.app_is_trip_member(app_trip_checklist_items.trip_id))
with check (
  public.app_is_trip_member(app_trip_checklist_items.trip_id)
  and (
    app_trip_checklist_items.claimed_by_member_id is null
    or exists (
      select 1
      from public.app_trip_members
      where app_trip_members.id = app_trip_checklist_items.claimed_by_member_id
        and app_trip_members.trip_id = app_trip_checklist_items.trip_id
    )
  )
);

insert into public.app_expense_stages (trip_id, name)
select app_trips.id, 'Etapa 1'
from public.app_trips
where not exists (
  select 1
  from public.app_expense_stages
  where app_expense_stages.trip_id = app_trips.id
);

update public.app_expenses
set stage_id = first_stage.id
from (
  select distinct on (trip_id) id, trip_id
  from public.app_expense_stages
  order by trip_id, opened_at
) as first_stage
where app_expenses.trip_id = first_stage.trip_id
  and app_expenses.stage_id is null;

alter table public.app_trip_members
alter column profile_id drop not null;

alter table public.app_trip_members
add column if not exists guest_name text,
add column if not exists guest_email text,
add column if not exists guest_alias text;

create unique index if not exists app_trip_members_trip_guest_email_key
on public.app_trip_members(trip_id, lower(guest_email))
where guest_email is not null;

create or replace function public.app_add_planned_members(target_trip_id uuid, planned_members jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  guest_name_value text;
  guest_email_value text;
  guest_alias_value text;
  matched_profile_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.app_trip_members
    where app_trip_members.trip_id = target_trip_id
      and app_trip_members.profile_id = auth.uid()
      and app_trip_members.role = 'organizer'
  ) then
    raise exception 'only organizer can add planned members';
  end if;

  for item in select * from jsonb_array_elements(coalesce(planned_members, '[]'::jsonb))
  loop
    guest_name_value := nullif(trim(coalesce(item->>'name', '')), '');
    guest_email_value := lower(nullif(trim(coalesce(item->>'email', '')), ''));
    guest_alias_value := nullif(trim(coalesce(item->>'alias', '')), '');

    if guest_name_value is null and guest_email_value is null then
      continue;
    end if;

    matched_profile_id := null;
    if guest_email_value is not null then
      select app_profiles.id into matched_profile_id
      from public.app_profiles
      where lower(app_profiles.email) = guest_email_value
      limit 1;
    end if;

    if matched_profile_id is not null then
      insert into public.app_trip_members (trip_id, profile_id, role, guest_name, guest_email, guest_alias)
      values (target_trip_id, matched_profile_id, 'participant', guest_name_value, guest_email_value, guest_alias_value)
      on conflict on constraint app_trip_members_trip_id_profile_id_key do update
      set guest_name = coalesce(excluded.guest_name, app_trip_members.guest_name),
          guest_email = coalesce(excluded.guest_email, app_trip_members.guest_email),
          guest_alias = coalesce(excluded.guest_alias, app_trip_members.guest_alias);
    elsif guest_email_value is not null then
      update public.app_trip_members
      set guest_name = coalesce(guest_name_value, app_trip_members.guest_name),
          guest_alias = coalesce(guest_alias_value, app_trip_members.guest_alias)
      where app_trip_members.trip_id = target_trip_id
        and lower(app_trip_members.guest_email) = guest_email_value
        and app_trip_members.profile_id is null;

      if not found then
        insert into public.app_trip_members (trip_id, profile_id, role, guest_name, guest_email, guest_alias)
        values (target_trip_id, null, 'participant', coalesce(guest_name_value, guest_email_value), guest_email_value, guest_alias_value);
      end if;
    else
      insert into public.app_trip_members (trip_id, profile_id, role, guest_name, guest_alias)
      values (target_trip_id, null, 'participant', guest_name_value, guest_alias_value);
    end if;
  end loop;
end;
$$;

grant execute on function public.app_add_planned_members(uuid, jsonb) to authenticated;

create or replace function public.app_create_trip(trip_name text, trip_key text, display_name text, planned_members jsonb)
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

  new_invite_code := lower(encode(extensions.gen_random_bytes(5), 'hex'));

  insert into public.app_trips (name, invite_code, trip_key_hash, owner_id)
  values (trip_name, new_invite_code, public.app_hash_trip_key(trip_key), auth.uid())
  returning id into new_trip_id;

  insert into public.app_trip_members (trip_id, profile_id, role)
  values (new_trip_id, auth.uid(), 'organizer');

  perform public.app_add_planned_members(new_trip_id, planned_members);

  insert into public.app_expense_stages (trip_id, name, created_by_member_id)
  select new_trip_id, 'Etapa 1', app_trip_members.id
  from public.app_trip_members
  where app_trip_members.trip_id = new_trip_id
    and app_trip_members.profile_id = auth.uid();

  return query select new_trip_id as trip_id, new_invite_code as invite_code;
end;
$$;

create or replace function public.app_create_trip(trip_name text, trip_key text, display_name text)
returns table (trip_id uuid, invite_code text)
language sql
security definer
set search_path = public
as $$
  select * from public.app_create_trip(trip_name, trip_key, display_name, '[]'::jsonb);
$$;

grant execute on function public.app_create_trip(text, text, text, jsonb) to authenticated;
grant execute on function public.app_create_trip(text, text, text) to authenticated;

create or replace function public.app_join_trip(invite text, trip_key text, display_name text)
returns table (trip_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  found_trip public.app_trips%rowtype;
  claimed_count integer;
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

  if auth.email() is not null then
    delete from public.app_trip_members
    where app_trip_members.trip_id = found_trip.id
      and app_trip_members.profile_id is null
      and lower(app_trip_members.guest_email) = lower(auth.email())
      and exists (
        select 1
        from public.app_trip_members existing_member
        where existing_member.trip_id = found_trip.id
          and existing_member.profile_id = auth.uid()
      );

    update public.app_trip_members
    set profile_id = auth.uid(),
        guest_name = coalesce(app_trip_members.guest_name, display_name),
        guest_email = coalesce(app_trip_members.guest_email, lower(auth.email()))
    where app_trip_members.trip_id = found_trip.id
      and app_trip_members.profile_id is null
      and lower(app_trip_members.guest_email) = lower(auth.email());

    get diagnostics claimed_count = row_count;
  else
    claimed_count := 0;
  end if;

  if claimed_count = 0 then
    insert into public.app_trip_members (trip_id, profile_id, role)
    values (found_trip.id, auth.uid(), 'participant')
    on conflict on constraint app_trip_members_trip_id_profile_id_key do nothing;
  end if;

  return query select found_trip.id as trip_id, found_trip.invite_code as invite_code;
end;
$$;

grant execute on function public.app_join_trip(text, text, text) to authenticated;
