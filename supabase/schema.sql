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
-- war_snapshots: timestamped captures of the premium WAR sheet, for tracking
-- WAR MOVEMENT (prospect risers). Keyed by captured_at (not calendar date) so
-- MULTIPLE captures per day are preserved — that's what lets risers compare an
-- earlier sheet state to a later one even within a single day. Written by the
-- cron route (service role only), read via war_risers(). RLS on, no policies.
-- NOTE: an older build keyed this table by snapshot_date; migrating requires a
-- one-time drop (see supabase/migrations/) since the primary key changes.
-- ---------------------------------------------------------------------------
create table if not exists public.war_snapshots (
  captured_at   timestamptz not null,   -- one value per cron run
  name_key      text not null,          -- normalized name (join key across captures)
  display_name  text not null,
  is_pitcher    boolean not null default false,
  level         text,
  war           numeric not null,
  primary key (captured_at, name_key, is_pitcher)
);

create index if not exists war_snapshots_key_idx on public.war_snapshots (name_key, is_pitcher, captured_at);

alter table public.war_snapshots enable row level security;
-- (no policies: only the service role touches this table)

-- Risers: players whose peak WAR climbed over the last `window_days`, top 100.
-- Compares the latest capture to the newest capture on/before (latest - window).
-- Until `window_days` of history has accrued, falls back to the OLDEST capture
-- we have — so with just two captures a few hours apart it still shows movement.
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
  latest_at timestamptz;
  past_at timestamptz;
begin
  select max(captured_at) into latest_at from public.war_snapshots;
  if latest_at is null then return; end if;
  select max(captured_at) into past_at from public.war_snapshots
    where captured_at <= latest_at - (window_days || ' days')::interval;
  -- Not enough history yet for the exact window: use the earliest capture we
  -- have (any capture strictly before latest). Needs 2 captures to show anything.
  if past_at is null then
    select min(captured_at) into past_at from public.war_snapshots where captured_at < latest_at;
  end if;
  if past_at is null then return; end if;
  return query
    select t.name_key, t.display_name, t.is_pitcher, t.level, t.war, (t.war - p.war) as delta
    from public.war_snapshots t
    join public.war_snapshots p
      on p.name_key = t.name_key and p.is_pitcher = t.is_pitcher and p.captured_at = past_at
    where t.captured_at = latest_at and (t.war - p.war) >= 0.1
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

-- ---------------------------------------------------------------------------
-- push_subscriptions: Web Push endpoints for background ("app closed") alerts.
-- One row per browser/device a user opts in on. The push cron reads across all
-- users under the service role; each user manages only their own rows. See
-- supabase/migrations/2026-07-13-push-subscriptions.sql for the canonical DDL
-- (columns: endpoint PK, user_id, subscription jsonb, last_state jsonb, times).
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  subscription jsonb not null,
  last_state   jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push: select own" on public.push_subscriptions;
create policy "push: select own" on public.push_subscriptions for select using (auth.uid() = user_id);
drop policy if exists "push: insert own" on public.push_subscriptions;
create policy "push: insert own" on public.push_subscriptions for insert with check (auth.uid() = user_id);
drop policy if exists "push: update own" on public.push_subscriptions;
create policy "push: update own" on public.push_subscriptions for update using (auth.uid() = user_id);
drop policy if exists "push: delete own" on public.push_subscriptions;
create policy "push: delete own" on public.push_subscriptions for delete using (auth.uid() = user_id);
-- Thin old WAR snapshots to ONE capture per day (the earliest survives), so the
-- Trends tab can keep ~2 seasons of history without unbounded growth. Called by
-- the war-snapshot cron for captures older than 45 days; recent captures keep
-- their intraday granularity (risers compares same-day sheet states).
create or replace function public.thin_war_snapshots(before_ts timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.war_snapshots w
  where w.captured_at < before_ts
    and w.captured_at not in (
      select min(captured_at)
      from public.war_snapshots
      where captured_at < before_ts
      group by date_trunc('day', captured_at at time zone 'utc')
    );
$$;
-- Billing pipes (Stripe). profiles gains the Stripe linkage; referral_codes maps
-- each user's personal promo code (friend: 20% off first payment; referrer: $5
-- credit per conversion, granted by the webhook).
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists subscription_status text;

create table if not exists public.referral_codes (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  code     text not null unique,
  promo_id text not null,
  created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;
-- (no policies: only the service role touches this table)
