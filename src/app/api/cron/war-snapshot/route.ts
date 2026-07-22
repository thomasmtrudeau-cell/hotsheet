import { NextRequest, NextResponse } from 'next/server';
import { getWarRows, repairPremiumSnapshot, snapshotSize } from '@/lib/war';
import { createServiceClient } from '@/lib/supabase/service';

export const maxDuration = 60;

// Daily snapshot of the WAR sheet → war_snapshots, for prospect-riser tracking.
// Triggered by Vercel cron (sends Authorization: Bearer <CRON_SECRET>).
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET) {
    // Accept the secret via the Authorization header (Vercel cron) OR a ?secret=
    // query param (external schedulers like cron-job.org, no header config needed).
    const viaHeader = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
    const viaQuery = request.nextUrl.searchParams.get('secret') === process.env.CRON_SECRET;
    if (!viaHeader && !viaQuery) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  // Piggybacked housekeeping: expire time-boxed premium comps. A comp sets
  // app_metadata.premium_until on the auth user (no schema change); when it
  // passes, tier flips back to free. Runs here because this cron already fires
  // several times a day. Non-fatal on error.
  try {
    const sb0 = createServiceClient();
    const { data: userList } = await sb0.auth.admin.listUsers({ perPage: 1000 });
    const now = Date.now();
    for (const u of userList?.users ?? []) {
      const until = (u.app_metadata as Record<string, unknown> | null)?.premium_until;
      if (typeof until === 'string' && Date.parse(until) < now) {
        await sb0.from('profiles').update({ tier: 'free' }).eq('id', u.id);
        await sb0.auth.admin.updateUserById(u.id, { app_metadata: { ...u.app_metadata, premium_until: null } });
        console.log(`comp expired -> free: ${u.email}`);
      }
    }
  } catch (e) { console.error('comp-expiry sweep failed:', e); }

  const sheetId = process.env.WAR_SHEET_ID;
  if (!sheetId) return NextResponse.json({ skipped: 'no WAR_SHEET_ID' });

  try {
    const rows = await getWarRows(sheetId);
    if (rows.length === 0) return NextResponse.json({ skipped: 'no rows' });

    // One timestamp for the whole run — every row in this capture shares it, so
    // captures are distinct points even when several happen in a day.
    const capturedAt = new Date().toISOString();

    // getWarRows already dedupes per (name_key, is_pitcher) preferring the
    // correct (non-"sa") row; this guard just protects the upsert's PK.
    const byKey = new Map<string, { captured_at: string; name_key: string; display_name: string; is_pitcher: boolean; level: string | null; war: number }>();
    for (const r of rows) {
      const k = `${r.nameKey}|${r.isPitcher}`;
      if (!byKey.has(k)) {
        byKey.set(k, {
          captured_at: capturedAt,
          name_key: r.nameKey,
          display_name: r.displayName,
          is_pitcher: r.isPitcher,
          level: r.level ?? null,
          war: r.war,
        });
      }
    }
    const records = Array.from(byKey.values());

    const sb = createServiceClient();
    for (let i = 0; i < records.length; i += 500) {
      const { error } = await sb
        .from('war_snapshots')
        .upsert(records.slice(i, i + 500), { onConflict: 'captured_at,name_key,is_pitcher' });
      if (error) throw error;
    }

    // Retention: the WAR Trends tab charts long-run movement, so keep ~2 seasons
    // (was 35 days when risers was the only consumer). To bound growth, captures
    // older than 45 days are THINNED to one per day via thin_war_snapshots()
    // (earliest capture of the day survives) rather than deleted outright.
    const cutoff = new Date(Date.now() - 730 * 86_400_000).toISOString();
    await sb.from('war_snapshots').delete().lt('captured_at', cutoff);
    const { error: thinErr } = await sb.rpc('thin_war_snapshots', { before_ts: new Date(Date.now() - 45 * 86_400_000).toISOString() });
    if (thinErr) console.error('thin_war_snapshots:', thinErr.message); // non-fatal hygiene

    // Cache a slim premium snapshot to Storage so /api/war joins against it (fast)
    // instead of pulling ~7MB of sheet CSV on every cold start. Non-fatal — pricing
    // falls back to the live fetch if this is missing/stale.
    let premiumCached = false;
    let premiumEntries = 0;
    try {
      const store = createServiceClient();
      await store.storage.createBucket('war', { public: false }); // idempotent; errors (already-exists) ignored below
      // repairPremiumSnapshot refuses to store a truncated capture (sheet
      // mid-recalc) — /api/war would serve "no data" for real players until
      // the next cron.
      const snap = await repairPremiumSnapshot(sheetId, store.storage);
      premiumEntries = snapshotSize(snap);
      premiumCached = snap !== null;
      if (!premiumCached) console.error(`premium snapshot not stored (${premiumEntries} entries)`);
    } catch (e) { console.error('premium snapshot failed:', e); }

    return NextResponse.json({ capturedAt, inserted: records.length, premiumCached, premiumEntries });
  } catch (error) {
    console.error('war-snapshot error:', error);
    const detail = error instanceof Error ? error.message
      : (error && typeof error === 'object') ? JSON.stringify(error)
      : String(error);
    return NextResponse.json({ error: 'snapshot failed', detail }, { status: 500 });
  }
}
