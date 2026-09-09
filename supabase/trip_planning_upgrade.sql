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

alter table public.app_trip_checklist_items enable row level security;

create index if not exists app_trip_checklist_items_trip_id_idx
on public.app_trip_checklist_items(trip_id);

grant select, insert, update on table public.app_trip_checklist_items to authenticated;

drop policy if exists "member checklist select" on public.app_trip_checklist_items;
drop policy if exists "member checklist insert" on public.app_trip_checklist_items;
drop policy if exists "member checklist update" on public.app_trip_checklist_items;

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
