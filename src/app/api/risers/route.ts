import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { bucketPos, normalizeName, snapshotUsable, PremiumSnapshot } from '@/lib/war';
import { getNamePositionPairs } from '@/lib/player-index';
import { Riser } from '@/lib/types';

// Enrich mover rows with the current premium rates (peak wRC+/HR-600/SB-600 for
// hitters, ERA/20 for pitchers) from the served Storage snapshot, plus hitter
// primary positions via the roster-index name join (same ambiguity-means-
// unlabeled rule as Scouting). Best-effort — the movers list never fails or
// waits on a re-parse over this; rows just render without the extras.
let snapCache: { at: number; snap: PremiumSnapshot } | null = null;
const SNAP_TTL = 5 * 60 * 1000;
async function enrichMovers(rows: Riser[]): Promise<Riser[]> {
  try {
    if (!snapCache || Date.now() - snapCache.at >= SNAP_TTL) {
      const { data } = await createServiceClient().storage.from('war').download('war_premium.json');
      if (data) {
        const snap = JSON.parse(await data.text()) as PremiumSnapshot;
        if (snapshotUsable(snap)) snapCache = { at: Date.now(), snap };
      }
    }
    const snap = snapCache?.snap;
    if (snap) {
      for (const r of rows) {
        const m = r.is_pitcher ? snap.pitchers[r.name_key] : snap.hitters[r.name_key];
        if (!m) continue;
        if (r.is_pitcher) { if (m.era20 !== undefined) r.era20 = m.era20; }
        else {
          if (m.peakWrcPlus !== undefined) r.wrc = m.peakWrcPlus;
          if (m.hr !== undefined) r.hr600 = m.hr;
          if (m.sb !== undefined) r.sb600 = m.sb;
        }
      }
    }
  } catch (e) { console.error('movers premium enrichment failed:', e); }
  try {
    if (rows.some((r) => !r.is_pitcher)) {
      const posByName = new Map<string, string | null>(); // null = ambiguous
      for (const { name, pos } of await getNamePositionPairs()) {
        const bucket = bucketPos(pos);
        if (!bucket) continue; // P rows are other people from a hitter's perspective
        const key = normalizeName(name);
        const existing = posByName.get(key);
        if (existing === undefined) posByName.set(key, bucket);
        else if (existing !== bucket) posByName.set(key, null);
      }
      for (const r of rows) {
        if (r.is_pitcher) continue;
        const p = posByName.get(r.name_key);
        if (p) r.pos = p;
      }
    }
  } catch (e) { console.error('movers position join failed:', e); }
  return rows;
}

// Prospect risers: players whose peak WAR climbed >= 1.5 over the window.
// PREMIUM ONLY — WAR is never exposed to anyone else. Returns [] otherwise.
export async function GET(request: NextRequest) {
  try {
    // Premium gate.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json([]);
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json([]);

    const raw = Number(request.nextUrl.searchParams.get('window')) || 7;
    const windowDays = [7, 14, 30].includes(raw) ? raw : 7;

    const sb = createServiceClient();
    // war_movers returns risers AND fallers (both directions). Fall back to the
    // risers-only reader until the war_movers migration is applied.
    const { data, error } = await sb.rpc('war_movers', { window_days: windowDays });
    if (error) {
      const { data: risersOnly } = await sb.rpc('war_risers', { window_days: windowDays });
      return NextResponse.json(await enrichMovers(risersOnly ?? []));
    }
    return NextResponse.json(await enrichMovers(data ?? []));
  } catch (error) {
    console.error('risers route error:', error);
    return NextResponse.json([]);
  }
}
