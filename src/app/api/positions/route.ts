import { NextResponse } from 'next/server';
import { getBulkPositions } from '@/lib/mlb-api';
import { normalizeName } from '@/lib/war';

// Public MLB roster positions, normalized-name → position, across MLB + MiLB.
// Split out of /api/values so the board renders instantly and positions stream
// in after (6 level-fetches are ~seconds cold, then cached 6h). Public data.
export async function GET() {
  try {
    const map: Record<string, string> = {};
    for (const { name, pos } of await getBulkPositions()) {
      const k = normalizeName(name);
      if (!(k in map)) map[k] = pos;
    }
    return NextResponse.json({ map });
  } catch {
    return NextResponse.json({ map: {} });
  }
}
