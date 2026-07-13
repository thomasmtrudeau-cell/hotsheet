import { NextRequest, NextResponse } from 'next/server';
import { hydrateFollowedPlayers, getPlayingTimeRisk } from '@/lib/mlb-api';
import { FollowedPlayer, isMLBSystem } from '@/lib/types';

// Re-hydrates followed players with their current team, level and IL status.
// The client diffs the response against its stored copy to generate
// promotion / demotion / IL notifications.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { players } = body as { players: FollowedPlayer[] };
    if (!players || !Array.isArray(players)) {
      return NextResponse.json({ error: 'Missing players' }, { status: 400 });
    }

    const mlbPlayers = players.filter((p) => isMLBSystem(p.sportId));
    const intlPlayers = players.filter((p) => !isMLBSystem(p.sportId));

    const failedInjuryTeams = new Set<number>();
    const hydrated =
      mlbPlayers.length > 0 ? await hydrateFollowedPlayers(mlbPlayers, failedInjuryTeams) : [];

    // If a team's roster fetch failed we can't tell "healthy" from "no data" —
    // carry the previous injury state through so the client sees no change.
    const prevById = new Map(mlbPlayers.map((p) => [p.id, p]));
    const safe = hydrated.map((p) =>
      failedInjuryTeams.has(p.currentTeam.id)
        ? { ...p, injury: prevById.get(p.id)?.injury }
        : p
    );

    // Attach playing-time risk (same-org same-area teammate on the IL).
    const risk = await getPlayingTimeRisk(safe);
    const withRisk = safe.map((p) => ({ ...p, playingTimeRisk: risk.get(p.id) }));

    return NextResponse.json([...withRisk, ...intlPlayers]);
  } catch (error) {
    console.error('Player refresh error:', error);
    return NextResponse.json({ error: 'Failed to refresh players' }, { status: 500 });
  }
}
