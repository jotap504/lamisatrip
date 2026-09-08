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
