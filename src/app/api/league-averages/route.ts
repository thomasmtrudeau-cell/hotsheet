import { NextResponse } from 'next/server';
import { getAllLeagueAverages } from '@/lib/mlb-api';

export async function GET() {
  try {
    const averages = await getAllLeagueAverages();
    return NextResponse.json(averages);
  } catch (error) {
    console.error('League averages error:', error);
    return NextResponse.json({ error: 'Failed to fetch league averages' }, { status: 500 });
  }
}
