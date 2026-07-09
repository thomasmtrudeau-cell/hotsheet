import { NextRequest, NextResponse } from 'next/server';
import { getWarRows } from '@/lib/war';
import { createServiceClient } from '@/lib/supabase/service';

export const maxDuration = 60;

// Daily snapshot of the WAR sheet → war_snapshots, for prospect-riser tracking.
// Triggered by Vercel cron (sends Authorization: Bearer <CRON_SECRET>).
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
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

    const records = rows.map((r) => ({
      snapshot_date: today,
      name_key: r.nameKey,
      display_name: r.displayName,
      is_pitcher: r.isPitcher,
      level: r.level ?? null,
      war: r.war,
    }));

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
    return NextResponse.json({ error: 'snapshot failed' }, { status: 500 });
  }
}
