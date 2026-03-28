import { NextRequest, NextResponse } from 'next/server';
import { getDailyStats, hydrateFollowedPlayers } from '@/lib/mlb-api';
import { FollowedPlayer, DailyPlayerStats, isMLBSystem, LEVEL_LABELS } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { players, date } = body as { players: FollowedPlayer[]; date: string };

    if (!players || !Array.isArray(players) || !date) {
      return NextResponse.json({ error: 'Missing players or date' }, { status: 400 });
    }

    // Split MLB-system and international players
    const mlbPlayers = players.filter((p) => isMLBSystem(p.sportId));
    const intlPlayers = players.filter((p) => !isMLBSystem(p.sportId));

    const mlbStats = mlbPlayers.length > 0
      ? await hydrateFollowedPlayers(mlbPlayers).then((h) => getDailyStats(h, date))
      : [];

    // International players don't have daily game data yet
    const intlStats: DailyPlayerStats[] = intlPlayers.map((p) => ({
      playerId: p.id,
      playerName: p.fullName,
      team: p.currentTeam.name,
      level: LEVEL_LABELS[p.sportId] || 'Intl',
      sportId: p.sportId,
      position: p.primaryPosition,
      parentOrg: p.parentOrg,
      parentOrgAbbrev: p.parentOrgAbbrev,
      gameStatus: 'No Game' as const,
      gameContext: '',
      statLine: 'Season stats only',
      isPitcherLine: false,
      performanceGrade: 'no_game' as const,
      gradeReason: 'Daily stats not available — check Season tab',
    }));

    return NextResponse.json([...mlbStats, ...intlStats]);
  } catch (error) {
    console.error('Daily stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch daily stats' }, { status: 500 });
  }
}
