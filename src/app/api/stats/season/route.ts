import { NextRequest, NextResponse } from 'next/server';
import { getSeasonStats, hydrateFollowedPlayers } from '@/lib/mlb-api';
import { getNPBBatters, getNPBPitchers } from '@/lib/npb-scraper';
import { getKBOBatters, getKBOPitchers } from '@/lib/kbo-scraper';
import { FollowedPlayer, SeasonPlayerStats, SPORT_IDS, isMLBSystem } from '@/lib/types';

async function getNPBSeasonStats(players: FollowedPlayer[]): Promise<SeasonPlayerStats[]> {
  const npbPlayers = players.filter((p) => p.sportId === SPORT_IDS.NPB);
  if (npbPlayers.length === 0) return [];

  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;

  // Fetch current year; only fall back to previous year if current season has no data yet
  const [batCur, pitCur] = await Promise.all([
    getNPBBatters(currentYear).catch(() => []),
    getNPBPitchers(currentYear).catch(() => []),
  ]);

  const seasonStarted = batCur.length > 0 || pitCur.length > 0;

  let batters = batCur;
  let pitchers = pitCur;
  if (!seasonStarted) {
    // Pre-season: fall back to previous year
    const [batPrev, pitPrev] = await Promise.all([
      getNPBBatters(prevYear).catch(() => []),
      getNPBPitchers(prevYear).catch(() => []),
    ]);
    batters = batPrev;
    pitchers = pitPrev;
  }

  return npbPlayers.map((player): SeasonPlayerStats => {
    const isPitcher = player.primaryPosition === 'P';
    const nameLower = player.fullName.toLowerCase();

    // Match by name (NPB names are "Last, First" in data)
    const parts = player.fullName.split(' ');
    const searchLast = parts[parts.length - 1]?.toLowerCase() || '';

    if (isPitcher) {
      const match = pitchers.find((p) => {
        const pName = p.name.toLowerCase();
        return pName.includes(searchLast) || nameLower.includes(p.name.split(',')[0]?.trim().toLowerCase() || '');
      });

      if (match) {
        return {
          playerId: player.id,
          playerName: player.fullName,
          team: match.team,
          level: 'NPB',
          sportId: SPORT_IDS.NPB,
          position: 'P',
          parentOrg: match.league === 'CL' ? 'Central League' : 'Pacific League',
          gamesPlayed: match.g,
          isPitcher: true,
          era: match.era,
          whip: match.whip,
          inningsPitched: match.ip,
          pitchingStrikeouts: match.so,
          walksAllowed: match.bb,
          wins: match.w,
          losses: match.l,
          saves: match.sv,
        };
      }
    } else {
      const match = batters.find((b) => {
        const bName = b.name.toLowerCase();
        return bName.includes(searchLast) || nameLower.includes(b.name.split(',')[0]?.trim().toLowerCase() || '');
      });

      if (match) {
        const ops = (parseFloat(match.obp) + parseFloat(match.slg)).toFixed(3);
        return {
          playerId: player.id,
          playerName: player.fullName,
          team: match.team,
          level: 'NPB',
          sportId: SPORT_IDS.NPB,
          position: player.primaryPosition,
          parentOrg: match.league === 'CL' ? 'Central League' : 'Pacific League',
          gamesPlayed: match.g,
          isPitcher: false,
          avg: match.avg,
          obp: match.obp,
          slg: match.slg,
          ops,
          homeRuns: match.hr,
          stolenBases: match.sb,
          walks: match.bb,
          strikeouts: match.so,
          doubles: match.doubles,
          triples: match.triples,
          plateAppearances: match.pa,
        };
      }
    }

    // No match found — return empty
    return {
      playerId: player.id,
      playerName: player.fullName,
      team: player.currentTeam.name,
      level: 'NPB',
      sportId: SPORT_IDS.NPB,
      position: player.primaryPosition,
      gamesPlayed: 0,
      isPitcher,
    };
  });
}

async function getKBOSeasonStats(players: FollowedPlayer[]): Promise<SeasonPlayerStats[]> {
  const kboPlayers = players.filter((p) => p.sportId === SPORT_IDS.KBO);
  if (kboPlayers.length === 0) return [];

  const [batters, pitchers] = await Promise.all([
    getKBOBatters().catch(() => []),
    getKBOPitchers().catch(() => []),
  ]);

  return kboPlayers.map((player): SeasonPlayerStats => {
    const isPitcher = player.primaryPosition === 'P';
    // Extract Korean name from "English (Korean)" format
    const krMatch = player.fullName.match(/\(([^)]+)\)/);
    const nameKr = krMatch ? krMatch[1] : player.fullName;

    if (isPitcher) {
      const match = pitchers.find((p) => p.nameKr === nameKr);
      if (match) {
        return {
          playerId: player.id,
          playerName: player.fullName,
          team: match.team,
          level: 'KBO',
          sportId: SPORT_IDS.KBO,
          position: 'P',
          gamesPlayed: match.g,
          isPitcher: true,
          era: match.era,
          whip: match.whip,
          inningsPitched: match.ip,
          pitchingStrikeouts: match.so,
          walksAllowed: match.bb,
          wins: match.w,
          losses: match.l,
          saves: match.sv,
        };
      }
    } else {
      const match = batters.find((b) => b.nameKr === nameKr);
      if (match) {
        return {
          playerId: player.id,
          playerName: player.fullName,
          team: match.team,
          level: 'KBO',
          sportId: SPORT_IDS.KBO,
          position: player.primaryPosition,
          gamesPlayed: match.g,
          isPitcher: false,
          avg: match.avg,
          obp: match.obp,
          slg: match.slg,
          ops: match.ops,
          homeRuns: match.hr,
          stolenBases: match.sb,
          walks: match.bb,
          strikeouts: match.so,
          doubles: match.doubles,
          triples: match.triples,
          plateAppearances: match.pa,
        };
      }
    }

    return {
      playerId: player.id,
      playerName: player.fullName,
      team: player.currentTeam.name,
      level: 'KBO',
      sportId: SPORT_IDS.KBO,
      position: player.primaryPosition,
      gamesPlayed: 0,
      isPitcher,
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { players } = body as { players: FollowedPlayer[] };

    if (!players || !Array.isArray(players)) {
      return NextResponse.json({ error: 'Missing players' }, { status: 400 });
    }

    const mlbPlayers = players.filter((p) => isMLBSystem(p.sportId));
    const npbPlayers = players.filter((p) => p.sportId === SPORT_IDS.NPB);
    const kboPlayers = players.filter((p) => p.sportId === SPORT_IDS.KBO);

    const [mlbStats, npbStats, kboStats] = await Promise.all([
      mlbPlayers.length > 0
        ? hydrateFollowedPlayers(mlbPlayers).then((h) => getSeasonStats(h))
        : Promise.resolve([]),
      getNPBSeasonStats(npbPlayers),
      getKBOSeasonStats(kboPlayers),
    ]);

    return NextResponse.json([...mlbStats, ...npbStats, ...kboStats]);
  } catch (error) {
    console.error('Season stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch season stats' }, { status: 500 });
  }
}
