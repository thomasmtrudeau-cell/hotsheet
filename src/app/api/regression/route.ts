import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSpRegression } from '@/lib/war';
import { getInjuryStatusForTeams } from '@/lib/mlb-api';

// SP sell-high / buy-low regression — PREMIUM ONLY. Returns empty sets for
// non-premium / unconfigured so the client shows the teaser.
export async function GET() {
  const empty = { rows: [] };
  try {
    const sheetId = process.env.WAR_SHEET_ID;
    if (!sheetId) return NextResponse.json(empty);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);

    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json(empty);

    const { rows } = await getSpRegression(sheetId);
    // Flag who's currently on the IL — the context behind a small-sample /
    // anomalous line (rehabbing aces etc.). Batched by team, cached ~10 min.
    const teamIds = [...new Set(rows.map((r) => r.teamId).filter((id): id is number => typeof id === 'number'))];
    const il = teamIds.length > 0 ? await getInjuryStatusForTeams(teamIds) : new Map();
    const enriched = rows.map((r) => ({
      ...r,
      il: r.playerId !== undefined ? il.has(r.playerId) : false,
      playerId: undefined, teamId: undefined, // drop join-only fields from the payload
    }));
    return NextResponse.json({ rows: enriched });
  } catch (error) {
    console.error('Regression route error:', error);
    return NextResponse.json(empty);
  }
}
