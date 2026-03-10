-- Groopa MVP schema
-- Safe foundation for:
-- - Lovable frontend
-- - Chrome extension
-- - Telegram connection flow

create extension if not exists pgcrypto;

-- 1) profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) extension installs
create table if not exists public.extension_installs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_key text not null unique,
  browser_name text,
  extension_version text,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) telegram connections
create table if not exists public.telegram_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id uuid references public.extension_installs(id) on delete set null,
  telegram_chat_id text,
  telegram_username text,
  status text not null default 'disconnected',
  connection_token text unique,
  connection_token_expires_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_connections_status_check
    check (status in ('disconnected', 'pending', 'connected', 'error'))
);

-- 4) tracked keywords
create table if not exists public.tracked_keywords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  keyword text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5) tracked groups
create table if not exists public.tracked_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  facebook_group_id text not null,
  group_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, facebook_group_id)
);

-- 6) helper function for updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 7) updated_at triggers
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists set_extension_installs_updated_at on public.extension_installs;
create trigger set_extension_installs_updated_at
before update on public.extension_installs
for each row execute procedure public.set_updated_at();

drop trigger if exists set_telegram_connections_updated_at on public.telegram_connections;
create trigger set_telegram_connections_updated_at
before update on public.telegram_connections
for each row execute procedure public.set_updated_at();

drop trigger if exists set_tracked_keywords_updated_at on public.tracked_keywords;
create trigger set_tracked_keywords_updated_at
before update on public.tracked_keywords
for each row execute procedure public.set_updated_at();

drop trigger if exists set_tracked_groups_updated_at on public.tracked_groups;
create trigger set_tracked_groups_updated_at
before update on public.tracked_groups
for each row execute procedure public.set_updated_at();

-- 8) create profile on new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 9) enable RLS
alter table public.profiles enable row level security;
alter table public.extension_installs enable row level security;
alter table public.telegram_connections enable row level security;
alter table public.tracked_keywords enable row level security;
alter table public.tracked_groups enable row level security;

-- 10) profiles policies
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id);

-- 11) extension_installs policies
drop policy if exists "Users can view own installs" on public.extension_installs;
create policy "Users can view own installs"
on public.extension_installs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own installs" on public.extension_installs;
create policy "Users can insert own installs"
on public.extension_installs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own installs" on public.extension_installs;
create policy "Users can update own installs"
on public.extension_installs
for update
to authenticated
using (auth.uid() = user_id);

-- 12) telegram_connections policies
drop policy if exists "Users can view own telegram connections" on public.telegram_connections;
create policy "Users can view own telegram connections"
on public.telegram_connections
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own telegram connections" on public.telegram_connections;
create policy "Users can insert own telegram connections"
on public.telegram_connections
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own telegram connections" on public.telegram_connections;
create policy "Users can update own telegram connections"
on public.telegram_connections
for update
to authenticated
using (auth.uid() = user_id);

-- 13) tracked_keywords policies
drop policy if exists "Users can view own tracked keywords" on public.tracked_keywords;
create policy "Users can view own tracked keywords"
on public.tracked_keywords
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own tracked keywords" on public.tracked_keywords;
create policy "Users can insert own tracked keywords"
on public.tracked_keywords
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own tracked keywords" on public.tracked_keywords;
create policy "Users can update own tracked keywords"
on public.tracked_keywords
for update
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can delete own tracked keywords" on public.tracked_keywords;
create policy "Users can delete own tracked keywords"
on public.tracked_keywords
for delete
to authenticated
using (auth.uid() = user_id);

-- 14) tracked_groups policies
drop policy if exists "Users can view own tracked groups" on public.tracked_groups;
create policy "Users can view own tracked groups"
on public.tracked_groups
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own tracked groups" on public.tracked_groups;
create policy "Users can insert own tracked groups"
on public.tracked_groups
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own tracked groups" on public.tracked_groups;
create policy "Users can update own tracked groups"
on public.tracked_groups
for update
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can delete own tracked groups" on public.tracked_groups;
create policy "Users can delete own tracked groups"
on public.tracked_groups
for delete
to authenticated
using (auth.uid() = user_id);