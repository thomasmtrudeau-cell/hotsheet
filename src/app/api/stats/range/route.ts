import { NextRequest, NextResponse } from 'next/server';
import { getRangeStats } from '@/lib/mlb-api';
import { FollowedPlayer, isMLBSystem } from '@/lib/types';

// Last-N-day stats for a player set. MLB-system players only (NPB/KBO have no
// day-by-day range endpoint here). Window is clamped to a sane range.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { players, window, endDate } = body as {
      players: FollowedPlayer[];
      window: number;
      endDate: string;
    };

    if (!players || !Array.isArray(players) || !endDate) {
      return NextResponse.json({ error: 'Missing players or endDate' }, { status: 400 });
    }

    const windowDays = Math.min(120, Math.max(1, Number(window) || 15));
    const mlbPlayers = players.filter((p) => isMLBSystem(p.sportId));
    const stats = await getRangeStats(mlbPlayers, windowDays, endDate);
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Range stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch range stats' }, { status: 500 });
  }
}
