-- One-time migration: switch war_snapshots from calendar-DATE keying to
-- TIMESTAMP keying, so multiple captures per day are preserved. That's what lets
-- prospect risers compare an earlier sheet state to a later one within a day
-- (instead of collapsing every same-day update into a single overwritten row).
--
-- Run ONCE in the Supabase SQL editor. It drops the old date-keyed table (its
-- one collapsed snapshot is disposable — the cron re-captures within hours) and
-- recreates it plus the war_risers() reader. Safe and self-contained.

drop table if exists public.war_snapshots cascade;

create table public.war_snapshots (
  captured_at   timestamptz not null,   -- one value per cron run
  name_key      text not null,          -- normalized name (join key across captures)
  display_name  text not null,
  is_pitcher    boolean not null default false,
  level         text,
  war           numeric not null,
  primary key (captured_at, name_key, is_pitcher)
);

create index if not exists war_snapshots_key_idx
  on public.war_snapshots (name_key, is_pitcher, captured_at);

alter table public.war_snapshots enable row level security;
-- (no policies: only the service role writes/reads this table)

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
  -- Not enough history for the exact window yet: fall back to the earliest
  -- capture we have (needs at least 2 captures to show anything).
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
