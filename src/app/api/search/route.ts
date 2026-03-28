import { NextRequest, NextResponse } from 'next/server';
import { searchPlayers } from '@/lib/mlb-api';
import { getNPBBatters, getNPBPitchers } from '@/lib/npb-scraper';
import { getKBOBatters, getKBOPitchers } from '@/lib/kbo-scraper';
import { getEnglishName } from '@/lib/korean-romanize';
import { SearchResult, SPORT_IDS } from '@/lib/types';

// Cache international player lists for search
let intlCache: { players: SearchResult[]; expires: number } | null = null;

async function getIntlSearchPool(): Promise<SearchResult[]> {
  const now = Date.now();
  if (intlCache && intlCache.expires > now) return intlCache.players;

  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;

  // Fetch current + previous year NPB (season may have just started)
  const [npbBatCur, npbPitCur, npbBatPrev, npbPitPrev, kboBatters, kboPitchers] = await Promise.all([
    getNPBBatters(currentYear).catch(() => []),
    getNPBPitchers(currentYear).catch(() => []),
    getNPBBatters(prevYear).catch(() => []),
    getNPBPitchers(prevYear).catch(() => []),
    getKBOBatters().catch(() => []),
    getKBOPitchers().catch(() => []),
  ]);

  // Merge NPB: use current year if available, fill gaps from previous year
  const npbBatterNames = new Set(npbBatCur.map((b) => b.name));
  const npbPitcherNames = new Set(npbPitCur.map((p) => p.name));
  const npbBatters = [
    ...npbBatCur,
    ...npbBatPrev.filter((b) => !npbBatterNames.has(b.name)),
  ];
  const npbPitchers = [
    ...npbPitCur,
    ...npbPitPrev.filter((p) => !npbPitcherNames.has(p.name)),
  ];

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
    // KBO — include both Korean and romanized names for search
    ...kboBatters.map((b) => {
      const englishName = getEnglishName(b.nameKr);
      return {
        id: hashName(b.nameKr + b.teamKr + 'kbo'),
        fullName: `${englishName} (${b.nameKr})`,
        primaryPosition: 'Hitter',
        currentTeam: { id: 0, name: b.team },
        sportId: SPORT_IDS.KBO,
        level: 'KBO',
        _searchText: `${englishName} ${b.nameKr} ${b.team} ${b.teamKr}`.toLowerCase(),
      } as SearchResult & { _searchText: string };
    }),
    ...kboPitchers.map((p) => {
      const englishName = getEnglishName(p.nameKr);
      return {
        id: hashName(p.nameKr + p.teamKr + 'kbo'),
        fullName: `${englishName} (${p.nameKr})`,
        primaryPosition: 'P',
        currentTeam: { id: 0, name: p.team },
        sportId: SPORT_IDS.KBO,
        level: 'KBO',
        _searchText: `${englishName} ${p.nameKr} ${p.team} ${p.teamKr}`.toLowerCase(),
      } as SearchResult & { _searchText: string };
    }),
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
    const intlResults = intlPool.filter((p) => {
      const searchable = (p as SearchResult & { _searchText?: string })._searchText
        || `${p.fullName} ${p.currentTeam.name}`.toLowerCase();
      return searchTerms.every((term) => searchable.includes(term));
    });

    // Strip internal search fields before returning
    const cleanIntl = intlResults.map((p) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _searchText, ...clean } = p as SearchResult & { _searchText?: string };
      return clean;
    });

    const combined = [...mlbResults, ...cleanIntl].slice(0, 25);
    return NextResponse.json(combined);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
