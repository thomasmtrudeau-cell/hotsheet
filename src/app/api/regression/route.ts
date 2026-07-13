import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSpRegression } from '@/lib/war';
import { getInjuryStatusForTeams, getIlDetailsForTeams } from '@/lib/mlb-api';

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
    // Flag who's on the IL + the real when/why (roster note + transaction date) —
    // context behind a small-sample / anomalous line. Batched by team, cached.
    const teamIds = [...new Set(rows.map((r) => r.teamId).filter((id): id is number => typeof id === 'number'))];
    const il = teamIds.length > 0 ? await getInjuryStatusForTeams(teamIds) : new Map();
    // Only teams that actually have an IL'd pitcher in our list need transaction detail.
    const ilTeamIds = [...new Set(rows.filter((r) => r.playerId !== undefined && il.has(r.playerId!)).map((r) => r.teamId).filter((id): id is number => typeof id === 'number'))];
    const ilDetail = ilTeamIds.length > 0 ? await getIlDetailsForTeams(ilTeamIds) : new Map();
    const enriched = rows.map((r) => {
      const inj = r.playerId !== undefined ? il.get(r.playerId) : undefined;
      const det = r.playerId !== undefined ? ilDetail.get(r.playerId) : undefined;
      return {
        ...r,
        il: Boolean(inj),
        ilLabel: inj?.label,
        ilNote: inj?.note,
        ilSince: det?.date,
        playerId: undefined, teamId: undefined, // drop join-only fields from the payload
      };
    });
    return NextResponse.json({ rows: enriched });
  } catch (error) {
    console.error('Regression route error:', error);
    return NextResponse.json(empty);
  }
}
