import { NextRequest, NextResponse } from 'next/server';
import { getGameLog, getTeamGameLog } from '@/lib/mlb-api';
import { isMLBSystem } from '@/lib/types';

// GET /api/stats/gamelog?playerId=123&sportId=1&pitcher=1&teamId=114
// Recent per-game log for an MLB/MiLB player. With teamId, returns the team's
// last 15 games with DNP markers (playing frequency). NPB/KBO unsupported.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const playerId = Number(searchParams.get('playerId'));
  const sportId = Number(searchParams.get('sportId'));
  const teamId = Number(searchParams.get('teamId')) || 0;
  const isPitcher = searchParams.get('pitcher') === '1';

  if (!playerId) {
    return NextResponse.json({ error: 'Missing playerId' }, { status: 400 });
  }
  if (!isMLBSystem(sportId)) {
    return NextResponse.json({ supported: false, entries: [] });
  }

  try {
    const entries = teamId
      ? await getTeamGameLog(playerId, isPitcher, teamId, sportId)
      : await getGameLog(playerId, isPitcher, sportId);
    return NextResponse.json({ supported: true, entries });
  } catch (error) {
    console.error('Game log error:', error);
    return NextResponse.json({ error: 'Failed to fetch game log' }, { status: 500 });
  }
}
