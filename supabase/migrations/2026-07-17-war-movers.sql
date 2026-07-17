-- Risers + Fallers in one reader: same as war_risers() but both directions
-- (abs(delta) >= 0.1), ordered risers-first. The app splits by the sign of delta.
-- /api/risers prefers this and falls back to war_risers() until it's applied.
create or replace function public.war_movers(window_days int)
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
  if past_at is null then
    select min(captured_at) into past_at from public.war_snapshots where captured_at < latest_at;
  end if;
  if past_at is null then return; end if;
  return query
    select t.name_key, t.display_name, t.is_pitcher, t.level, t.war, (t.war - p.war) as delta
    from public.war_snapshots t
    join public.war_snapshots p
      on p.name_key = t.name_key and p.is_pitcher = t.is_pitcher and p.captured_at = past_at
    where t.captured_at = latest_at and abs(t.war - p.war) >= 0.1
    order by (t.war - p.war) desc
    limit 200;
end;
$$;
