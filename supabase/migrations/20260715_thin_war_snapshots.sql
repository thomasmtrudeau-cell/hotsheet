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
