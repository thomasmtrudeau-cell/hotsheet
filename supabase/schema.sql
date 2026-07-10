-- Hot Sheet — auth + per-user data schema
-- Paste this whole file into the Supabase SQL editor (Dashboard → SQL Editor → New query) and Run.
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user (mirrors auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  tier         text not null default 'free',  -- 'free' | 'premium' — feature gate for future monetization
  created_at   timestamptz not null default now()
);

-- Idempotent add for projects created before `tier` existed.
alter table public.profiles add column if not exists tier text not null default 'free';

alter table public.profiles enable row level security;

drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- Long-term monetization control: a user may edit their own profile (display_name)
-- but must never grant themselves premium. RLS can't gate a single column, so a
-- trigger blocks any tier change coming from the browser. Only the service role
-- (or SQL editor) — i.e. you — can move someone to 'premium'.
create or replace function public.lock_profile_tier()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Block only a logged-in browser user changing their OWN tier. The SQL editor
  -- / service role has no auth.uid() (or is service_role), so admin edits pass.
  if new.tier is distinct from old.tier
     and auth.uid() is not null
     and auth.role() <> 'service_role' then
    new.tier := old.tier;  -- silently ignore self-escalation attempts
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_tier on public.profiles;
create trigger profiles_lock_tier
  before update on public.profiles
  for each row execute function public.lock_profile_tier();

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- followed_players: each user's master follow list (the "All Players" view).
-- The full FollowedPlayer object is stored as JSONB in `data`.
-- ---------------------------------------------------------------------------
create table if not exists public.followed_players (
  user_id     uuid not null references auth.users (id) on delete cascade,
  player_id   bigint not null,
  data        jsonb not null,
  followed_at timestamptz not null default now(),
  primary key (user_id, player_id)
);

create index if not exists followed_players_user_idx
  on public.followed_players (user_id);

alter table public.followed_players enable row level security;

drop policy if exists "followed: select own" on public.followed_players;
create policy "followed: select own"
  on public.followed_players for select using (auth.uid() = user_id);

drop policy if exists "followed: insert own" on public.followed_players;
create policy "followed: insert own"
  on public.followed_players for insert with check (auth.uid() = user_id);

drop policy if exists "followed: update own" on public.followed_players;
create policy "followed: update own"
  on public.followed_players for update using (auth.uid() = user_id);

drop policy if exists "followed: delete own" on public.followed_players;
create policy "followed: delete own"
  on public.followed_players for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- groups: user-defined collections (e.g. "Fantasy", "Card PCs").
-- "All Players" is implicit (= followed_players) and is NOT stored here.
-- ---------------------------------------------------------------------------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists groups_user_idx on public.groups (user_id);

alter table public.groups enable row level security;

drop policy if exists "groups: all own" on public.groups;
create policy "groups: all own"
  on public.groups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- player_groups: which custom groups a followed player is tagged into.
-- A player can belong to many groups (and to none — they still show in "All").
-- ---------------------------------------------------------------------------
create table if not exists public.player_groups (
  user_id    uuid not null references auth.users (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  player_id  bigint not null,
  created_at timestamptz not null default now(),
  primary key (group_id, player_id),
  foreign key (user_id, player_id)
    references public.followed_players (user_id, player_id) on delete cascade
);

create index if not exists player_groups_user_idx on public.player_groups (user_id);

alter table public.player_groups enable row level security;

drop policy if exists "player_groups: all own" on public.player_groups;
create policy "player_groups: all own"
  on public.player_groups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- war_snapshots: daily snapshot of the premium WAR sheet, for tracking WAR
-- MOVEMENT (prospect risers). Written by the cron route (service role only),
-- read via the war_risers() function. No public access (RLS on, no policies).
-- ---------------------------------------------------------------------------
create table if not exists public.war_snapshots (
  snapshot_date date not null,
  name_key      text not null,   -- normalized name (join key across days)
  display_name  text not null,
  is_pitcher    boolean not null default false,
  level         text,
  war           numeric not null,
  primary key (snapshot_date, name_key, is_pitcher)
);

create index if not exists war_snapshots_key_idx on public.war_snapshots (name_key, is_pitcher, snapshot_date);

alter table public.war_snapshots enable row level security;
-- (no policies: only the service role touches this table)

-- Risers: players whose peak WAR climbed over the last `window_days`, top 100.
-- Compares the latest snapshot to the newest snapshot on/before (latest - window).
-- Until `window_days` of history has accrued, falls back to the OLDEST snapshot
-- we have (so the view shows the delta between whatever two updates exist).
-- Threshold is a small positive move (0.1) — real projection updates produce
-- gains well under the old 1.5 bar, especially over short early windows.
create or replace function public.war_risers(window_days int)
returns table(name_key text, display_name text, is_pitcher boolean, level text, war numeric, delta numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  latest_d date;
  past_d date;
begin
  select max(snapshot_date) into latest_d from public.war_snapshots;
  if latest_d is null then return; end if;
  select max(snapshot_date) into past_d from public.war_snapshots where snapshot_date <= latest_d - window_days;
  -- Not enough history yet for the exact window: use the earliest snapshot we
  -- have (any date strictly before latest). Returns nothing until 2 dates exist.
  if past_d is null then
    select min(snapshot_date) into past_d from public.war_snapshots where snapshot_date < latest_d;
  end if;
  if past_d is null then return; end if;
  return query
    select t.name_key, t.display_name, t.is_pitcher, t.level, t.war, (t.war - p.war) as delta
    from public.war_snapshots t
    join public.war_snapshots p
      on p.name_key = t.name_key and p.is_pitcher = t.is_pitcher and p.snapshot_date = past_d
    where t.snapshot_date = latest_d and (t.war - p.war) >= 0.1
    order by (t.war - p.war) desc
    limit 100;
end;
$$;

-- ---------------------------------------------------------------------------
-- Open-signup hygiene: cap each user at 500 followed players.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_follow_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.followed_players where user_id = new.user_id) >= 500 then
    raise exception 'Follow limit reached (500 players).';
  end if;
  return new;
end;
$$;

drop trigger if exists followed_players_cap on public.followed_players;
create trigger followed_players_cap
  before insert on public.followed_players
  for each row execute function public.enforce_follow_cap();
