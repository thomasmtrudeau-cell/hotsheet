import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchPremiumMap } from '@/lib/war';
import { FollowedPlayer } from '@/lib/types';

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

    const map = await fetchPremiumMap(players, sheetId);
    return NextResponse.json(map);
  } catch (error) {
    console.error('Premium route error:', error);
    return NextResponse.json({});
  }
}
