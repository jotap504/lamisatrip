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
