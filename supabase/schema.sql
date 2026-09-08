create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  phone text,
  payment_alias text,
  cbu text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  trip_key_hash text not null,
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  currency text not null default 'ARS',
  status text not null default 'active' check (status in ('active', 'closed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'participant' check (role in ('organizer', 'participant', 'readonly')),
  joined_at timestamptz not null default now(),
  unique (trip_id, profile_id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  amount numeric(12,2) not null check (amount > 0),
  payer_member_id uuid not null references public.trip_members(id) on delete restrict,
  created_by_member_id uuid not null references public.trip_members(id) on delete restrict,
  category text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.trip_members(id) on delete cascade,
  share_amount numeric(12,2) not null check (share_amount >= 0),
  unique (expense_id, member_id)
);

create table if not exists public.settlement_payments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_member_id uuid not null references public.trip_members(id) on delete restrict,
  to_member_id uuid not null references public.trip_members(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  proof_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.random_draws (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  created_by_member_id uuid not null references public.trip_members(id) on delete restrict,
  draw_type text not null check (draw_type in ('task', 'pairs', 'rooms')),
  title text,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlement_payments enable row level security;
alter table public.random_draws enable row level security;

create index if not exists trip_members_trip_id_idx on public.trip_members(trip_id);
create index if not exists expenses_trip_id_idx on public.expenses(trip_id);
create index if not exists expense_splits_expense_id_idx on public.expense_splits(expense_id);
create index if not exists settlement_payments_trip_id_idx on public.settlement_payments(trip_id);
