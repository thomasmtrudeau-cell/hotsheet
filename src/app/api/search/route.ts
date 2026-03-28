import { NextRequest, NextResponse } from 'next/server';
import { searchPlayers } from '@/lib/mlb-api';
import { getNPBBatters, getNPBPitchers } from '@/lib/npb-scraper';
import { SearchResult, SPORT_IDS } from '@/lib/types';

// Cache NPB player list for search
let npbCache: { players: SearchResult[]; expires: number } | null = null;

async function getNPBSearchPool(): Promise<SearchResult[]> {
  const now = Date.now();
  if (npbCache && npbCache.expires > now) return npbCache.players;

  const [batters, pitchers] = await Promise.all([
    getNPBBatters().catch(() => []),
    getNPBPitchers().catch(() => []),
  ]);

  const players: SearchResult[] = [
    ...batters.map((b) => ({
      id: hashName(b.name + b.team),
      fullName: formatNPBName(b.name),
      primaryPosition: 'Hitter',
      currentTeam: { id: 0, name: b.team },
      sportId: SPORT_IDS.NPB,
      level: 'NPB',
      parentOrg: b.league === 'CL' ? 'Central League' : 'Pacific League',
    })),
    ...pitchers.map((p) => ({
      id: hashName(p.name + p.team),
      fullName: formatNPBName(p.name),
      primaryPosition: 'P',
      currentTeam: { id: 0, name: p.team },
      sportId: SPORT_IDS.NPB,
      level: 'NPB',
      parentOrg: p.league === 'CL' ? 'Central League' : 'Pacific League',
    })),
  ];

  npbCache = { players, expires: now + 3600_000 };
  return players;
}

// Convert "LastName, FirstName" to "FirstName LastName"
function formatNPBName(name: string): string {
  if (name.includes(',')) {
    const [last, first] = name.split(',').map((s) => s.trim());
    return `${first} ${last}`;
  }
  return name;
}

// Simple hash for NPB player IDs (no MLB ID available)
function hashName(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1_000_000; // Offset to avoid collision with MLB IDs
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');
  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  try {
    // Search both MLB and NPB in parallel
    const [mlbResults, npbPool] = await Promise.all([
      searchPlayers(query),
      getNPBSearchPool(),
    ]);

    // Filter NPB players by search terms
    const searchTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const npbResults = npbPool.filter((p) =>
      searchTerms.every((term) => p.fullName.toLowerCase().includes(term))
    );

    // Combine: MLB first, then NPB
    const combined = [...mlbResults, ...npbResults].slice(0, 25);
    return NextResponse.json(combined);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
