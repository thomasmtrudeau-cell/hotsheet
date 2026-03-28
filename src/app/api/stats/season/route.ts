import { NextRequest, NextResponse } from 'next/server';
import { getSeasonStats, hydrateFollowedPlayers } from '@/lib/mlb-api';
import { FollowedPlayer } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { players } = body as { players: FollowedPlayer[] };

    if (!players || !Array.isArray(players)) {
      return NextResponse.json({ error: 'Missing players' }, { status: 400 });
    }

    const hydrated = await hydrateFollowedPlayers(players);
    const stats = await getSeasonStats(hydrated);
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Season stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch season stats' }, { status: 500 });
  }
}
