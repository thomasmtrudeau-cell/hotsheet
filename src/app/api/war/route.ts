import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchPremiumMap, premiumFromSnapshot, PremiumSnapshot } from '@/lib/war';
import { FollowedPlayer } from '@/lib/types';

// Per-instance cache of the Storage snapshot so warm requests don't re-download
// it. Returns null when there's no fresh (<3-day) snapshot, so the caller falls
// back to the live sheet fetch.
let snapCache: { at: number; snap: PremiumSnapshot } | null = null;
const SNAP_TTL = 5 * 60 * 1000;
async function getSnapshot(): Promise<PremiumSnapshot | null> {
  if (snapCache && Date.now() - snapCache.at < SNAP_TTL) return snapCache.snap;
  const store = createServiceClient();
  const { data } = await store.storage.from('war').download('war_premium.json');
  if (!data) return null;
  const snap = JSON.parse(await data.text()) as PremiumSnapshot;
  const fresh = snap?.capturedAt && Date.now() - Date.parse(snap.capturedAt) < 3 * 86_400_000;
  if (!fresh || !snap.hitters) return null;
  snapCache = { at: Date.now(), snap };
  return snap;
}

// Premium metrics for a player set — PREMIUM ONLY (peak WAR, plus peak wRC+ for
// hitters / ERA-per-20-TBF for pitchers). Returns {} (not an error) for
// signed-out users, non-premium users, or when no sheet is configured, so the
// client simply shows no premium stats in those cases. WAR and the other
// metrics NEVER reach a non-premium payload.
export async function POST(request: NextRequest) {
  try {
    const sheetId = process.env.WAR_SHEET_ID;
    if (!sheetId) return NextResponse.json({});

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({});

    const { data: profile } = await supabase
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single();
    if (profile?.tier !== 'premium') return NextResponse.json({});

    const body = await request.json();
    const { players } = body as { players: FollowedPlayer[] };
    if (!Array.isArray(players)) return NextResponse.json({});

    // Fast path: the daily war-snapshot cron caches a slim premium snapshot in
    // Storage. Reading it (~400KB, CDN-backed) avoids pulling ~7MB of sheet CSV on
    // a cold start, and a short in-memory cache keeps warm requests instant. Fall
    // back to the live fetch only if it's missing, unparseable, or very stale.
    try {
      const snap = await getSnapshot();
      if (snap) return NextResponse.json(premiumFromSnapshot(players, snap));
    } catch { /* fall through to the live fetch */ }

    const map = await fetchPremiumMap(players, sheetId);
    return NextResponse.json(map);
  } catch (error) {
    console.error('Premium route error:', error);
    return NextResponse.json({});
  }
}
