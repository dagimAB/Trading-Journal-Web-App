-- ============================================================================
-- ICT BACKTEST JOURNAL - SUPABASE DATABASE SCHEMA & ROW-LEVEL SECURITY
-- ============================================================================

create extension if not exists "uuid-ossp";

-- 1. TRADES TABLE
create table if not exists public.trades (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  instrument text not null,
  date timestamptz not null default now(),
  session text,
  direction text check (direction in ('LONG', 'SHORT')),
  status text check (status in ('WIN', 'LOSS', 'BE', 'INCOMPLETE')),
  result numeric default 0,
  risk numeric default 1.0,
  
  -- 3-Way SL Optimization
  wick_sl numeric,
  body_sl numeric,
  spc_sl numeric,
  
  -- Exit & Partials
  rem_exit_r numeric,
  exit_plan text,
  partials jsonb default '[]'::jsonb,
  
  -- Analytics & Filter Metadata
  setup text,
  quality text,
  batch text,
  target_hits jsonb default '[]'::jsonb,
  mfe numeric,
  mae numeric,
  
  -- Price Levels
  entry_price numeric,
  stop_price numeric,
  tp_price numeric,
  
  -- Screenshots & Notes
  htf_chart_url text,
  ltf_chart_url text,
  notes text,
  
  -- Catch-all JSONB for any additional custom trade fields (tradeNumber, time, killzone, etc.)
  extra_data jsonb default '{}'::jsonb,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. MISSED TRADES TABLE
create table if not exists public.missed_trades (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  date timestamptz not null default now(),
  instrument text not null,
  session text,
  direction text check (direction in ('LONG', 'SHORT')),
  potential_r numeric not null default 0,
  reason text not null,
  setup text,
  batch text,
  notes text,
  htf_chart_url text,
  ltf_chart_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. EXIT PLANS TABLE
create table if not exists public.exit_plans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  name text not null,
  plan_string text not null,
  tiers jsonb default '[]'::jsonb,
  is_default boolean default false,
  created_at timestamptz default now()
);

-- 4. USER SETTINGS & PREFERENCES TABLE (1:1 with auth.users)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  account_balance numeric default 10000,
  default_risk_pct numeric default 1.0,
  visible_columns jsonb default '[]'::jsonb,
  thresholds jsonb default '{}'::jsonb,
  missed_reasons jsonb default '["Hesitation", "Fear of Loss", "Missed Alert", "HTF Doubt", "Away from Desk", "News/Spread"]'::jsonb,
  custom_setups jsonb default '[]'::jsonb,
  custom_batches jsonb default '[]'::jsonb,
  theme text default 'light',
  imgbb_api_key text,
  updated_at timestamptz default now()
);

-- ENABLE ROW LEVEL SECURITY
alter table public.trades enable row level security;
alter table public.missed_trades enable row level security;
alter table public.exit_plans enable row level security;
alter table public.user_settings enable row level security;

-- DROP EXISTING POLICIES (to allow safe re-running)
drop policy if exists "Users manage own trades" on public.trades;
drop policy if exists "Users manage own missed trades" on public.missed_trades;
drop policy if exists "Users manage own exit plans" on public.exit_plans;
drop policy if exists "Users manage own settings" on public.user_settings;

-- RLS POLICIES (Strict per-user isolation)
create policy "Users manage own trades" on public.trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own missed trades" on public.missed_trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own exit plans" on public.exit_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- AUTOMATIC PROFILE / SETTINGS TRIGGER ON USER SIGNUP (Optional convenience)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

