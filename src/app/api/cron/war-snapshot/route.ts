import { NextRequest, NextResponse } from 'next/server';
import { getWarRows } from '@/lib/war';
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
  const sheetId = process.env.WAR_SHEET_ID;
  if (!sheetId) return NextResponse.json({ skipped: 'no WAR_SHEET_ID' });

  try {
    const rows = await getWarRows(sheetId);
    if (rows.length === 0) return NextResponse.json({ skipped: 'no rows' });

    // ET date so snapshots align with the app's "today".
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
      .toISOString()
      .slice(0, 10);

    // Dedupe by the PK (name_key + is_pitcher): the sheet can have two rows that
    // normalize to the same name; keep the higher WAR so the upsert doesn't hit
    // the same row twice in one command.
    const byKey = new Map<string, { snapshot_date: string; name_key: string; display_name: string; is_pitcher: boolean; level: string | null; war: number }>();
    for (const r of rows) {
      const k = `${r.nameKey}|${r.isPitcher}`;
      const existing = byKey.get(k);
      if (!existing || r.war > existing.war) {
        byKey.set(k, {
          snapshot_date: today,
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
    // Upsert in chunks (today's rows replace themselves if the cron re-runs).
    for (let i = 0; i < records.length; i += 500) {
      const { error } = await sb
        .from('war_snapshots')
        .upsert(records.slice(i, i + 500), { onConflict: 'snapshot_date,name_key,is_pitcher' });
      if (error) throw error;
    }

    // Prune snapshots older than 35 days (30-day window + slack).
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 35);
    await sb.from('war_snapshots').delete().lt('snapshot_date', cutoff.toISOString().slice(0, 10));

    return NextResponse.json({ date: today, inserted: records.length });
  } catch (error) {
    console.error('war-snapshot error:', error);
    const detail = error instanceof Error ? error.message
      : (error && typeof error === 'object') ? JSON.stringify(error)
      : String(error);
    return NextResponse.json({ error: 'snapshot failed', detail }, { status: 500 });
  }
}
