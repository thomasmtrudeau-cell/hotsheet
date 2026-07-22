import { NextResponse } from 'next/server';
import { getWarRows, snapshotSize, PremiumSnapshot, SNAPSHOT_MIN_ENTRIES, SNAPSHOT_MAX_AGE_MS } from '@/lib/war';
import { getOopsy } from '@/lib/oopsy';
import { createServiceClient } from '@/lib/supabase/service';

export const maxDuration = 30;

// Lightweight health check for an external uptime monitor (cron-job.org). Returns
// HTTP 200 when healthy or degraded, and 503 when a CRITICAL dependency (the MLB
// Stats API or Supabase) is down — so the monitor's "alert on non-200" fires.
// Set SLACK_WEBHOOK_URL to also get a Slack ping on a hard-down.

const MLB_PING = 'https://statsapi.mlb.com/api/v1/teams?sportId=1';

async function reachable(url: string, ms = 6000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // 1) MLB Stats API — critical (the whole app depends on it).
  checks.mlbApi = { ok: await reachable(MLB_PING) };

  // 2) Supabase reachable + latest WAR capture fresh.
  let supabaseOk = false;
  let snapshotOk = false;
  let snapshotDetail = 'no captures yet';
  try {
    const sb = createServiceClient();
    const { data, error } = await sb
      .from('war_snapshots')
      .select('captured_at')
      .order('captured_at', { ascending: false })
      .limit(1);
    // Getting ANY response (even a query error) means Supabase is reachable — a
    // schema/query error is a degraded snapshot warning, not an app outage.
    supabaseOk = true;
    if (error) {
      snapshotDetail = error.message;
    } else {
      const latest = data?.[0]?.captured_at as string | undefined;
      if (latest) {
        const ageH = (Date.now() - new Date(latest).getTime()) / 3_600_000;
        snapshotOk = ageH <= 26; // cron runs 3x/day; >26h means runs were missed
        snapshotDetail = `latest capture ${ageH.toFixed(1)}h ago`;
      }
    }
  } catch (e) {
    supabaseOk = false; // a thrown error = genuine connection failure
    snapshotDetail = e instanceof Error ? e.message : String(e);
  }
  checks.supabase = { ok: supabaseOk };
  checks.warSnapshot = { ok: snapshotOk, detail: snapshotDetail };

  // 3) WAR sheet parses (warning only — premium feature, not core).
  const sheetId = process.env.WAR_SHEET_ID;
  if (!sheetId) {
    checks.warSheet = { ok: true, detail: 'not configured' };
  } else {
    try {
      const rows = await getWarRows(sheetId);
      checks.warSheet = { ok: rows.length > 0, detail: `${rows.length} rows parsed` };
    } catch (e) {
      checks.warSheet = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  // 3b) The Storage snapshot /api/war actually serves from — distinct from the
  // war_snapshots TABLE above (2026-07-22: a truncated war_premium.json served
  // wrong/missing premium metrics for days while every other check stayed green).
  try {
    const sb = createServiceClient();
    const { data } = await sb.storage.from('war').download('war_premium.json');
    if (!data) {
      checks.premiumSnapshot = { ok: true, detail: 'none stored — /api/war uses live sheet' };
    } else {
      const snap = JSON.parse(await data.text()) as PremiumSnapshot;
      const ageH = (Date.now() - Date.parse(snap?.capturedAt ?? '')) / 3_600_000;
      const size = snapshotSize(snap);
      const usable = Number.isFinite(ageH) && ageH <= SNAPSHOT_MAX_AGE_MS / 3_600_000 && size >= SNAPSHOT_MIN_ENTRIES;
      // An unusable stored snapshot only degrades performance (live fallback
      // kicks in), so warn — the row-count floor is the load-bearing detail.
      checks.premiumSnapshot = { ok: usable, detail: `${size} entries, captured ${Number.isFinite(ageH) ? ageH.toFixed(1) : '?'}h ago${usable ? '' : ' — UNUSABLE, /api/war falling back to live sheet'}` };
    }
  } catch (e) {
    checks.premiumSnapshot = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // 4) OOPSY weekly projections sheet (warning only — premium feature).
  const oopsyId = process.env.OOPSY_SHEET_ID;
  if (!oopsyId) {
    checks.oopsy = { ok: true, detail: 'OOPSY_SHEET_ID not set' };
  } else {
    try {
      const { pitchers, hitters } = await getOopsy(oopsyId);
      checks.oopsy = { ok: pitchers.length + hitters.length > 0, detail: `${pitchers.length} SP / ${hitters.length} H` };
    } catch (e) {
      checks.oopsy = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  // Critical checks decide up/down; snapshot age + sheets are "degraded" warnings.
  const critical = checks.mlbApi.ok && checks.supabase.ok;
  const allOk = critical && checks.warSnapshot.ok && checks.warSheet.ok && checks.premiumSnapshot.ok && checks.oopsy.ok;
  const status = !critical ? 'down' : allOk ? 'ok' : 'degraded';

  if (status === 'down' && process.env.SLACK_WEBHOOK_URL) {
    const failing = Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k).join(', ');
    try {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `🚨 Hot Sheet is DOWN — failing: ${failing || 'unknown'}` }),
      });
    } catch {
      // best-effort; the 503 itself is the primary signal
    }
  }

  return NextResponse.json(
    { status, checks, at: new Date().toISOString() },
    { status: status === 'down' ? 503 : 200 }
  );
}
