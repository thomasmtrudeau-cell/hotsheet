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

    // Prune captures older than 35 days (30-day window + slack).
    const cutoff = new Date(Date.now() - 35 * 86_400_000).toISOString();
    await sb.from('war_snapshots').delete().lt('captured_at', cutoff);

    return NextResponse.json({ capturedAt, inserted: records.length });
  } catch (error) {
    console.error('war-snapshot error:', error);
    const detail = error instanceof Error ? error.message
      : (error && typeof error === 'object') ? JSON.stringify(error)
      : String(error);
    return NextResponse.json({ error: 'snapshot failed', detail }, { status: 500 });
  }
}
