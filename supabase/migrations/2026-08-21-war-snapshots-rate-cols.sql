-- Rate-metric history for the Trends tab: the war-snapshot cron has been
-- writing wrc/era20 since 2026-08-13, but these columns never existed, so the
-- cron's fallback silently dropped them every day ("history starts Aug 13"
-- never accrued). Nullable: hitters get wrc, pitchers get era20.
alter table public.war_snapshots
  add column if not exists wrc   numeric,
  add column if not exists era20 numeric;
