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
