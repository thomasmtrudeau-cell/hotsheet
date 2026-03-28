import { NextRequest, NextResponse } from 'next/server';
import { searchPlayers } from '@/lib/mlb-api';
import { getNPBBatters, getNPBPitchers } from '@/lib/npb-scraper';
import { getKBOBatters, getKBOPitchers } from '@/lib/kbo-scraper';
import { SearchResult, SPORT_IDS } from '@/lib/types';

// Cache international player lists for search
let intlCache: { players: SearchResult[]; expires: number } | null = null;

async function getIntlSearchPool(): Promise<SearchResult[]> {
  const now = Date.now();
  if (intlCache && intlCache.expires > now) return intlCache.players;

  const [npbBatters, npbPitchers, kboBatters, kboPitchers] = await Promise.all([
    getNPBBatters().catch(() => []),
    getNPBPitchers().catch(() => []),
    getKBOBatters().catch(() => []),
    getKBOPitchers().catch(() => []),
  ]);

  const players: SearchResult[] = [
    // NPB
    ...npbBatters.map((b) => ({
      id: hashName(b.name + b.team + 'npb'),
      fullName: formatNPBName(b.name),
      primaryPosition: 'Hitter',
      currentTeam: { id: 0, name: b.team },
      sportId: SPORT_IDS.NPB,
      level: 'NPB',
      parentOrg: b.league === 'CL' ? 'Central League' : 'Pacific League',
    })),
    ...npbPitchers.map((p) => ({
      id: hashName(p.name + p.team + 'npb'),
      fullName: formatNPBName(p.name),
      primaryPosition: 'P',
      currentTeam: { id: 0, name: p.team },
      sportId: SPORT_IDS.NPB,
      level: 'NPB',
      parentOrg: p.league === 'CL' ? 'Central League' : 'Pacific League',
    })),
    // KBO
    ...kboBatters.map((b) => ({
      id: hashName(b.nameKr + b.teamKr + 'kbo'),
      fullName: b.nameKr,
      primaryPosition: 'Hitter',
      currentTeam: { id: 0, name: b.team },
      sportId: SPORT_IDS.KBO,
      level: 'KBO',
    })),
    ...kboPitchers.map((p) => ({
      id: hashName(p.nameKr + p.teamKr + 'kbo'),
      fullName: p.nameKr,
      primaryPosition: 'P',
      currentTeam: { id: 0, name: p.team },
      sportId: SPORT_IDS.KBO,
      level: 'KBO',
    })),
  ];

  intlCache = { players, expires: now + 3600_000 };
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

// Simple hash for international player IDs
function hashName(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1_000_000;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');
  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const [mlbResults, intlPool] = await Promise.all([
      searchPlayers(query),
      getIntlSearchPool(),
    ]);

    // Filter international players by search terms
    const searchTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const intlResults = intlPool.filter((p) =>
      searchTerms.every((term) =>
        p.fullName.toLowerCase().includes(term) ||
        p.currentTeam.name.toLowerCase().includes(term)
      )
    );

    const combined = [...mlbResults, ...intlResults].slice(0, 25);
    return NextResponse.json(combined);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
