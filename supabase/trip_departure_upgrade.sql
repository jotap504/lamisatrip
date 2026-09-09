alter table public.app_trips
add column if not exists departure_at timestamptz;

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
