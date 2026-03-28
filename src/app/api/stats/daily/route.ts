import { NextRequest, NextResponse } from 'next/server';
import { getDailyStats, hydrateFollowedPlayers } from '@/lib/mlb-api';
import { FollowedPlayer } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { players, date } = body as { players: FollowedPlayer[]; date: string };

    if (!players || !Array.isArray(players) || !date) {
      return NextResponse.json({ error: 'Missing players or date' }, { status: 400 });
    }

    const hydrated = await hydrateFollowedPlayers(players);
    const stats = await getDailyStats(hydrated, date);
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Daily stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch daily stats' }, { status: 500 });
  }
}
