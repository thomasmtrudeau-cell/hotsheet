-- Web Push subscriptions: one row per browser/device endpoint a user opts in on.
-- The push cron (running under the service role) reads across all users to
-- deliver background alerts; each user can only see/manage their own rows.
create table if not exists public.push_subscriptions (
  endpoint     text primary key,            -- unique per browser push endpoint
  user_id      uuid not null references auth.users (id) on delete cascade,
  subscription jsonb not null,              -- full PushSubscription (keys, endpoint)
  -- server-side snapshot of each followed player's last-known state, so the cron
  -- can diff roster/IL moves and only push what actually changed since last run.
  last_state   jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push: select own" on public.push_subscriptions;
create policy "push: select own"
  on public.push_subscriptions for select using (auth.uid() = user_id);

drop policy if exists "push: insert own" on public.push_subscriptions;
create policy "push: insert own"
  on public.push_subscriptions for insert with check (auth.uid() = user_id);

drop policy if exists "push: update own" on public.push_subscriptions;
create policy "push: update own"
  on public.push_subscriptions for update using (auth.uid() = user_id);

drop policy if exists "push: delete own" on public.push_subscriptions;
create policy "push: delete own"
  on public.push_subscriptions for delete using (auth.uid() = user_id);
