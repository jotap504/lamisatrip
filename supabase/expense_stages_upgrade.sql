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

alter table public.app_expense_stages enable row level security;

create index if not exists app_expenses_stage_id_idx on public.app_expenses(stage_id);
create index if not exists app_expense_stages_trip_id_idx on public.app_expense_stages(trip_id);
create unique index if not exists app_expense_stages_one_open_per_trip_idx
on public.app_expense_stages(trip_id)
where status = 'open';

grant select, insert, update, delete on table public.app_expenses to authenticated;
grant select, insert, update, delete on table public.app_expense_splits to authenticated;

drop policy if exists "member stages select" on public.app_expense_stages;
drop policy if exists "member stages insert" on public.app_expense_stages;
drop policy if exists "member stages update" on public.app_expense_stages;

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

drop policy if exists "member expenses insert" on public.app_expenses;
drop policy if exists "member expenses update" on public.app_expenses;
drop policy if exists "member expenses delete" on public.app_expenses;
drop policy if exists "member splits delete" on public.app_expense_splits;

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
  and exists (
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

create or replace function public.app_update_expense(
  target_expense_id uuid,
  new_title text,
  new_amount numeric,
  new_payer_member_id uuid,
  new_participant_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_trip_id uuid;
  target_stage_id uuid;
  participant_id uuid;
  share_amount numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if trim(coalesce(new_title, '')) = '' then
    raise exception 'expense title is required';
  end if;

  if new_amount <= 0 then
    raise exception 'expense amount must be greater than zero';
  end if;

  if coalesce(array_length(new_participant_ids, 1), 0) = 0 then
    raise exception 'at least one participant is required';
  end if;

  select app_expenses.trip_id, app_expenses.stage_id
  into target_trip_id, target_stage_id
  from public.app_expenses
  join public.app_expense_stages on app_expense_stages.id = app_expenses.stage_id
  where app_expenses.id = target_expense_id
    and app_expense_stages.status = 'open';

  if target_trip_id is null then
    raise exception 'expense not found or stage is closed';
  end if;

  if not public.app_is_trip_member(target_trip_id) then
    raise exception 'not a trip member';
  end if;

  if not exists (
    select 1
    from public.app_trip_members
    where app_trip_members.id = new_payer_member_id
      and app_trip_members.trip_id = target_trip_id
  ) then
    raise exception 'payer is not a trip member';
  end if;

  foreach participant_id in array new_participant_ids loop
    if not exists (
      select 1
      from public.app_trip_members
      where app_trip_members.id = participant_id
        and app_trip_members.trip_id = target_trip_id
    ) then
      raise exception 'participant is not a trip member';
    end if;
  end loop;

  update public.app_expenses
  set title = trim(new_title),
      amount = new_amount,
      payer_member_id = new_payer_member_id
  where id = target_expense_id
    and trip_id = target_trip_id
    and stage_id = target_stage_id;

  delete from public.app_expense_splits
  where expense_id = target_expense_id;

  share_amount := new_amount / array_length(new_participant_ids, 1);

  insert into public.app_expense_splits (expense_id, member_id, share_amount)
  select target_expense_id, participant_id, share_amount
  from unnest(new_participant_ids) as participant_id;
end;
$$;

create or replace function public.app_delete_expense(target_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_trip_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select app_expenses.trip_id
  into target_trip_id
  from public.app_expenses
  join public.app_expense_stages on app_expense_stages.id = app_expenses.stage_id
  where app_expenses.id = target_expense_id
    and app_expense_stages.status = 'open';

  if target_trip_id is null then
    raise exception 'expense not found or stage is closed';
  end if;

  if not public.app_is_trip_member(target_trip_id) then
    raise exception 'not a trip member';
  end if;

  delete from public.app_expenses
  where id = target_expense_id
    and trip_id = target_trip_id;
end;
$$;

grant execute on function public.app_update_expense(uuid, text, numeric, uuid, uuid[]) to authenticated;
grant execute on function public.app_delete_expense(uuid) to authenticated;

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

grant execute on function public.app_create_trip(text, text, text) to authenticated;

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
