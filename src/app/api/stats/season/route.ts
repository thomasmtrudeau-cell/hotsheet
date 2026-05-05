import { NextRequest, NextResponse } from 'next/server';
import { getSeasonStats, hydrateFollowedPlayers } from '@/lib/mlb-api';
import { getNPBBatters, getNPBPitchers } from '@/lib/npb-scraper';
import { getKBOBatters, getKBOPitchers, getKBOPlayerSeason, kboLeagueAverages, type KBOBatter, type KBOPitcher } from '@/lib/kbo-scraper';
import { FollowedPlayer, SeasonPlayerStats, SPORT_IDS, isMLBSystem } from '@/lib/types';

async function getNPBSeasonStats(players: FollowedPlayer[]): Promise<SeasonPlayerStats[]> {
  const npbPlayers = players.filter((p) => p.sportId === SPORT_IDS.NPB);
  if (npbPlayers.length === 0) return [];

  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;

  // Fetch current year + previous year for fallback per-player
  const [batCur, pitCur, batPrev, pitPrev] = await Promise.all([
    getNPBBatters(currentYear).catch(() => []),
    getNPBPitchers(currentYear).catch(() => []),
    getNPBBatters(prevYear).catch(() => []),
    getNPBPitchers(prevYear).catch(() => []),
  ]);

  return npbPlayers.map((player): SeasonPlayerStats => {
    const isPitcher = player.primaryPosition === 'P';
    const nameLower = player.fullName.toLowerCase();

    // Match by name (NPB names are "Last, First" in data)
    const parts = player.fullName.split(' ');
    const searchLast = parts[parts.length - 1]?.toLowerCase() || '';

    const nameMatch = (dataName: string) => {
      const dn = dataName.toLowerCase();
      return dn.includes(searchLast) || nameLower.includes(dataName.split(',')[0]?.trim().toLowerCase() || '');
    };

    if (isPitcher) {
      // Try current year first, fall back to previous year per-player
      const match = pitCur.find((p) => nameMatch(p.name)) || pitPrev.find((p) => nameMatch(p.name));

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
      const match = batCur.find((b) => nameMatch(b.name)) || batPrev.find((b) => nameMatch(b.name));

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

function batterToSeasonStats(player: FollowedPlayer, b: KBOBatter, lgAvg: ReturnType<typeof kboLeagueAverages>): SeasonPlayerStats {
  const stats: SeasonPlayerStats = {
    playerId: player.id,
    playerName: player.fullName,
    team: b.team,
    level: 'KBO',
    sportId: SPORT_IDS.KBO,
    position: player.primaryPosition,
    gamesPlayed: b.g,
    isPitcher: false,
    avg: b.avg,
    obp: b.obp,
    slg: b.slg,
    ops: b.ops,
    homeRuns: b.hr,
    stolenBases: b.sb,
    walks: b.bb,
    strikeouts: b.so,
    doubles: b.doubles,
    triples: b.triples,
    plateAppearances: b.pa,
  };
  if (lgAvg && lgAvg.lgOBP > 0 && lgAvg.lgSLG > 0) {
    const obp = parseFloat(b.obp);
    const slg = parseFloat(b.slg);
    if (isFinite(obp) && isFinite(slg)) {
      stats.opsPlus = Math.round(100 * (obp / lgAvg.lgOBP + slg / lgAvg.lgSLG - 1));
    }
  }
  return stats;
}

function pitcherToSeasonStats(player: FollowedPlayer, p: KBOPitcher): SeasonPlayerStats {
  return {
    playerId: player.id,
    playerName: player.fullName,
    team: p.team,
    level: 'KBO',
    sportId: SPORT_IDS.KBO,
    position: 'P',
    gamesPlayed: p.g,
    isPitcher: true,
    era: p.era,
    whip: p.whip,
    inningsPitched: p.ip,
    pitchingStrikeouts: p.so,
    walksAllowed: p.bb,
    wins: p.w,
    losses: p.l,
    saves: p.sv,
  };
}

// Map from English team token in our followed-player record to KBO Korean abbreviation,
// used to disambiguate the player search. Best-effort — if we don't find a mapping the
// search still works without a team filter.
const KBO_EN_TO_KR: Record<string, string> = {
  'KIA Tigers': 'HT', 'LG Twins': 'LG', 'KT Wiz': 'KT', 'Samsung Lions': 'SS',
  'SSG Landers': 'SK', 'Doosan Bears': 'OB', 'NC Dinos': 'NC',
  'Hanwha Eagles': 'HH', 'Kiwoom Heroes': 'WO', 'Lotte Giants': 'LT',
};

async function getKBOSeasonStats(players: FollowedPlayer[]): Promise<SeasonPlayerStats[]> {
  const kboPlayers = players.filter((p) => p.sportId === SPORT_IDS.KBO);
  if (kboPlayers.length === 0) return [];

  const [batters, pitchers] = await Promise.all([
    getKBOBatters().catch(() => []),
    getKBOPitchers().catch(() => []),
  ]);
  const lgAvg = kboLeagueAverages(batters);

  return Promise.all(kboPlayers.map(async (player): Promise<SeasonPlayerStats> => {
    const isPitcher = player.primaryPosition === 'P';
    const krMatch = player.fullName.match(/\(([^)]+)\)/);
    const nameKr = krMatch ? krMatch[1] : player.fullName;
    const teamKr = KBO_EN_TO_KR[player.currentTeam.name];

    if (isPitcher) {
      const match = pitchers.find((p) => p.nameKr === nameKr);
      if (match) return pitcherToSeasonStats(player, match);
      const fallback = await getKBOPlayerSeason(nameKr, true, teamKr);
      if (fallback) return pitcherToSeasonStats(player, fallback as KBOPitcher);
    } else {
      const match = batters.find((b) => b.nameKr === nameKr);
      if (match) return batterToSeasonStats(player, match, lgAvg);
      const fallback = await getKBOPlayerSeason(nameKr, false, teamKr);
      if (fallback) return batterToSeasonStats(player, fallback as KBOBatter, lgAvg);
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
  }));
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
