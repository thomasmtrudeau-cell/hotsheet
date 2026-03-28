import { LEVEL_LABELS, SearchResult, DailyPlayerStats, SeasonPlayerStats, FollowedPlayer, LeagueAverages } from './types';
import { gradeHitter, gradePitcher, formatBattingLine, formatPitchingLine, parseIP } from './grading';

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const ALL_SPORT_IDS = [1, 11, 12, 13, 14];

// Simple in-memory cache for server-side API routes
const cache = new Map<string, { data: unknown; expires: number }>();
const CACHE_TTL = 60_000; // 1 minute

async function cachedFetch<T>(url: string, ttl = CACHE_TTL): Promise<T> {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.expires > now) return cached.data as T;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`MLB API error: ${res.status} ${url}`);
  const data = await res.json();
  cache.set(url, { data, expires: now + ttl });
  return data;
}

// --- Team Lookup (for sport level + parent org) ---

interface TeamInfo {
  sportId: number;
  sportName: string;
  parentOrgName?: string;
  parentOrgAbbrev?: string;
}

let teamLookupCache: Map<number, TeamInfo> | null = null;
let teamLookupExpires = 0;

async function getTeamLookup(): Promise<Map<number, TeamInfo>> {
  const now = Date.now();
  if (teamLookupCache && teamLookupExpires > now) return teamLookupCache;

  const url = `${MLB_API}/teams?sportIds=${ALL_SPORT_IDS.join(',')}&activeStatus=ACTIVE`;
  const data = await cachedFetch<{ teams: Array<Record<string, unknown>> }>(url, 3600_000); // cache 1 hour
  const map = new Map<number, TeamInfo>();

  // First pass: build MLB team ID -> abbreviation map
  const orgAbbrevs = new Map<number, string>();
  for (const t of data.teams) {
    const sport = t.sport as Record<string, unknown> | undefined;
    if ((sport?.id as number) === 1) {
      orgAbbrevs.set(t.id as number, (t.abbreviation as string) || '');
    }
  }

  for (const t of data.teams) {
    const sport = t.sport as Record<string, unknown> | undefined;
    const parentOrgId = t.parentOrgId as number | undefined;
    map.set(t.id as number, {
      sportId: (sport?.id as number) || 1,
      sportName: (sport?.name as string) || 'MLB',
      parentOrgName: t.parentOrgName as string | undefined,
      parentOrgAbbrev: parentOrgId ? orgAbbrevs.get(parentOrgId) : undefined,
    });
  }
  teamLookupCache = map;
  teamLookupExpires = now + 3600_000;
  return map;
}

// --- Hydrate followed players with correct team data + names ---

export async function hydrateFollowedPlayers(players: FollowedPlayer[]): Promise<FollowedPlayer[]> {
  const teamMap = await getTeamLookup();

  // Batch lookup player details to fix names
  const ids = players.map((p) => p.id).join(',');
  let playerDetails: Map<number, Record<string, unknown>> = new Map();
  try {
    const data = await cachedFetch<{ people?: Array<Record<string, unknown>> }>(
      `${MLB_API}/people?personIds=${ids}`,
      3600_000
    );
    if (data.people) {
      for (const p of data.people) {
        playerDetails.set(p.id as number, p);
      }
    }
  } catch {
    // Fall back to existing names
  }

  return players.map((p) => {
    const teamInfo = teamMap.get(p.currentTeam.id);
    const details = playerDetails.get(p.id);
    return {
      ...p,
      fullName: details ? formatDisplayName(details) : p.fullName,
      sportId: teamInfo?.sportId ?? p.sportId,
      parentOrg: teamInfo?.parentOrgName ?? p.parentOrg,
      parentOrgAbbrev: teamInfo?.parentOrgAbbrev ?? p.parentOrgAbbrev,
    };
  });
}

// --- Name formatting (middle initial) ---

function formatDisplayName(p: Record<string, unknown>): string {
  // Prefer useName (e.g. "Freddie") over legal firstName (e.g. "Frederick")
  const first = (p.useName as string) || (p.firstName as string) || '';
  const middle = (p.middleName as string) || '';
  const last = (p.lastName as string) || '';
  const suffix = (p.nameSuffix as string) || '';
  // Only show middle initial if using the legal first name (useName already is the short form)
  const usedUseName = !!(p.useName as string);
  const middleInitial = middle && !usedUseName ? ` ${middle[0]}.` : '';
  const suffixStr = suffix ? ` ${suffix}` : '';
  return `${first}${middleInitial} ${last}${suffixStr}`.trim();
}

// --- Player Search ---

export async function searchPlayers(query: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return [];

  const sportIds = ALL_SPORT_IDS.join(',');
  const [searchData, teamMap] = await Promise.all([
    cachedFetch<{ people?: Array<Record<string, unknown>> }>(
      `${MLB_API}/people/search?names=${encodeURIComponent(query)}&sportIds=${sportIds}&active=true&hydrate=currentTeam`
    ),
    getTeamLookup(),
  ]);

  if (!searchData.people) return [];

  // The MLB API does loose/fuzzy matching, so we filter locally
  // to ensure ALL search terms appear somewhere in the player's name
  const searchTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return searchData.people
    .filter((p) => {
      if (!p.currentTeam) return false;
      const fullFML = ((p.fullFMLName as string) || '').toLowerCase();
      const fullName = ((p.fullName as string) || '').toLowerCase(); // common name e.g. "Joey Ortiz"
      const lastName = ((p.lastName as string) || '').toLowerCase();
      const firstName = ((p.firstName as string) || '').toLowerCase();
      const useName = ((p.useName as string) || '').toLowerCase(); // e.g. "joey"
      const nickName = ((p.nickName as string) || '').toLowerCase();
      const searchable = `${firstName} ${useName} ${nickName} ${lastName} ${fullName} ${fullFML}`;
      return searchTerms.every((term) => searchable.includes(term));
    })
    .map((p) => {
      const team = p.currentTeam as Record<string, unknown>;
      const teamId = team.id as number;
      const teamInfo = teamMap.get(teamId);
      const sportId = teamInfo?.sportId ?? 1;
      const pos = p.primaryPosition as Record<string, unknown> | undefined;
      return {
        id: p.id as number,
        fullName: formatDisplayName(p),
        primaryPosition: pos?.abbreviation as string || 'Unknown',
        currentTeam: {
          id: teamId,
          name: team.name as string,
        },
        sportId,
        level: LEVEL_LABELS[sportId] || 'Unknown',
        parentOrg: teamInfo?.parentOrgName,
        parentOrgAbbrev: teamInfo?.parentOrgAbbrev,
      };
    })
    .slice(0, 20);
}

// --- Daily Stats ---

interface ScheduleGame {
  gamePk: number;
  gameDate: string;
  status: { abstractGameState: string; detailedState: string };
  teams: {
    away: { team: { id: number; name: string } };
    home: { team: { id: number; name: string } };
  };
}

async function getGamesForDate(date: string): Promise<ScheduleGame[]> {
  const games: ScheduleGame[] = [];
  // Fetch all sport IDs in parallel
  const results = await Promise.all(
    ALL_SPORT_IDS.map((sportId) =>
      cachedFetch<{ dates?: Array<{ games: ScheduleGame[] }> }>(
        `${MLB_API}/schedule?date=${date}&sportId=${sportId}&hydrate=team`
      ).catch(() => ({ dates: [] }))
    )
  );
  for (const data of results) {
    if (data.dates) {
      for (const d of data.dates) {
        games.push(...d.games);
      }
    }
  }
  return games;
}

function getGameStatus(game: ScheduleGame): DailyPlayerStats['gameStatus'] {
  const state = game.status.abstractGameState;
  const detail = game.status.detailedState;
  if (detail === 'Postponed') return 'Postponed';
  if (state === 'Live' || state === 'In Progress') return 'Live';
  if (state === 'Final') return 'Final';
  if (state === 'Preview') return 'Scheduled';
  return 'Scheduled';
}

function getGameContext(game: ScheduleGame): string {
  return `${game.teams.away.team.name} @ ${game.teams.home.team.name}`;
}

function getGameTime(game: ScheduleGame): string {
  const d = new Date(game.gameDate);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
}

interface BoxscorePlayer {
  person: { id: number; fullName: string };
  stats: {
    batting?: Record<string, unknown>;
    pitching?: Record<string, unknown>;
  };
  position: { abbreviation: string };
}

async function getBoxscore(gamePk: number): Promise<{
  away: { players: Record<string, BoxscorePlayer> };
  home: { players: Record<string, BoxscorePlayer> };
} | null> {
  try {
    const data = await cachedFetch<{ teams: { away: { players: Record<string, BoxscorePlayer> }; home: { players: Record<string, BoxscorePlayer> } } }>(
      `${MLB_API}/game/${gamePk}/boxscore`
    );
    return data.teams;
  } catch {
    return null;
  }
}

function extractPlayerFromBoxscore(
  teams: { away: { players: Record<string, BoxscorePlayer> }; home: { players: Record<string, BoxscorePlayer> } },
  playerId: number
): BoxscorePlayer | null {
  const key = `ID${playerId}`;
  return teams.away.players[key] || teams.home.players[key] || null;
}

function buildDailyStats(
  player: FollowedPlayer,
  game: ScheduleGame | null,
  boxscorePlayer: BoxscorePlayer | null
): DailyPlayerStats {
  const level = LEVEL_LABELS[player.sportId] || 'Unknown';
  const base: DailyPlayerStats = {
    playerId: player.id,
    playerName: player.fullName,
    team: player.currentTeam.name,
    level,
    sportId: player.sportId,
    position: player.primaryPosition,
    parentOrg: player.parentOrg,
    parentOrgAbbrev: player.parentOrgAbbrev,
    gameStatus: 'No Game',
    gameContext: '',
    statLine: '',
    isPitcherLine: false,
    performanceGrade: 'no_game',
    gradeReason: 'No game today',
  };

  if (!game) return base;

  base.gameStatus = getGameStatus(game);
  base.gameContext = getGameContext(game);
  base.gameTime = getGameTime(game);
  base.gamePk = game.gamePk;

  if (base.gameStatus === 'Scheduled') {
    base.performanceGrade = 'scheduled';
    base.gradeReason = `Game at ${base.gameTime}`;
    base.statLine = `${base.gameTime}`;
    return base;
  }

  if (base.gameStatus === 'Postponed') {
    base.performanceGrade = 'no_game';
    base.gradeReason = 'Postponed';
    base.statLine = 'Postponed';
    return base;
  }

  if (!boxscorePlayer) {
    base.performanceGrade = 'routine';
    base.gradeReason = 'Not in lineup';
    base.statLine = 'DNP';
    return base;
  }

  const batting = boxscorePlayer.stats.batting as Record<string, number> | undefined;
  const pitching = boxscorePlayer.stats.pitching as Record<string, unknown> | undefined;

  // Determine if this is a pitching or batting line
  const hasPitching = pitching && (pitching.inningsPitched as string) !== undefined && pitching.inningsPitched !== '0.0' && pitching.inningsPitched !== '';
  const isPitcherPosition = player.primaryPosition === 'P';

  if (hasPitching && isPitcherPosition) {
    const ip = parseIP(pitching.inningsPitched as string | number);
    base.isPitcherLine = true;
    base.inningsPitched = pitching.inningsPitched as string;
    base.earnedRuns = (pitching.earnedRuns as number) || 0;
    base.pitchingStrikeouts = (pitching.strikeOuts as number) || 0;
    base.walksAllowed = (pitching.baseOnBalls as number) || 0;
    base.hitsAllowed = (pitching.hits as number) || 0;
    base.saves = (pitching.saves as number) || 0;
    base.wins = (pitching.wins as number) || 0;
    base.losses = (pitching.losses as number) || 0;

    const { grade, reason } = gradePitcher({
      inningsPitched: ip,
      earnedRuns: base.earnedRuns,
      strikeouts: base.pitchingStrikeouts,
      walksAllowed: base.walksAllowed,
      hitsAllowed: base.hitsAllowed,
      saves: base.saves,
      wins: base.wins,
      losses: base.losses,
    });
    base.performanceGrade = grade;
    base.gradeReason = reason;
    base.statLine = formatPitchingLine(base);
  } else if (batting && batting.atBats !== undefined) {
    base.isPitcherLine = false;
    base.hits = batting.hits || 0;
    base.atBats = batting.atBats || 0;
    base.homeRuns = batting.homeRuns || 0;
    base.walks = batting.baseOnBalls || 0;
    base.strikeouts = batting.strikeOuts || 0;
    base.stolenBases = batting.stolenBases || 0;
    base.doubles = batting.doubles || 0;
    base.triples = batting.triples || 0;
    base.hitByPitch = batting.hitByPitch || 0;

    const { grade, reason } = gradeHitter({
      hits: base.hits,
      atBats: base.atBats,
      homeRuns: base.homeRuns,
      walks: base.walks,
      strikeouts: base.strikeouts,
      stolenBases: base.stolenBases,
      doubles: base.doubles,
      triples: base.triples,
      hitByPitch: base.hitByPitch,
    });
    base.performanceGrade = grade;
    base.gradeReason = reason;
    base.statLine = formatBattingLine(base);
  } else {
    base.performanceGrade = 'routine';
    base.gradeReason = 'Not in lineup';
    base.statLine = 'DNP';
  }

  return base;
}

export async function getDailyStats(players: FollowedPlayer[], date: string): Promise<DailyPlayerStats[]> {
  if (players.length === 0) return [];

  const games = await getGamesForDate(date);

  // Map team ID -> games
  const teamGames = new Map<number, ScheduleGame[]>();
  for (const game of games) {
    const awayId = game.teams.away.team.id;
    const homeId = game.teams.home.team.id;
    teamGames.set(awayId, [...(teamGames.get(awayId) || []), game]);
    teamGames.set(homeId, [...(teamGames.get(homeId) || []), game]);
  }

  // Find which games we need boxscores for
  const neededGamePks = new Set<number>();
  for (const player of players) {
    const playerGames = teamGames.get(player.currentTeam.id);
    if (playerGames) {
      for (const g of playerGames) {
        const status = getGameStatus(g);
        if (status === 'Live' || status === 'Final') {
          neededGamePks.add(g.gamePk);
        }
      }
    }
  }

  // Fetch all needed boxscores in parallel
  const boxscores = new Map<number, Awaited<ReturnType<typeof getBoxscore>>>();
  const boxscoreResults = await Promise.all(
    Array.from(neededGamePks).map(async (pk) => ({
      pk,
      data: await getBoxscore(pk),
    }))
  );
  for (const { pk, data } of boxscoreResults) {
    boxscores.set(pk, data);
  }

  // Build stats for each player
  return players.map((player) => {
    const playerGames = teamGames.get(player.currentTeam.id);
    if (!playerGames || playerGames.length === 0) {
      return buildDailyStats(player, null, null);
    }

    // Use first game (handle doubleheaders later if needed)
    const game = playerGames[0];
    const status = getGameStatus(game);

    if (status === 'Scheduled' || status === 'Postponed') {
      return buildDailyStats(player, game, null);
    }

    const boxscore = boxscores.get(game.gamePk);
    const boxscorePlayer = boxscore ? extractPlayerFromBoxscore(boxscore, player.id) : null;
    return buildDailyStats(player, game, boxscorePlayer);
  });
}

// --- Season Stats ---

export async function getSeasonStats(players: FollowedPlayer[], season?: number): Promise<SeasonPlayerStats[]> {
  if (players.length === 0) return [];

  const currentSeason = season || new Date().getFullYear();

  const results = await Promise.all(
    players.map(async (player): Promise<SeasonPlayerStats> => {
      const level = LEVEL_LABELS[player.sportId] || 'Unknown';
      const isPitcher = player.primaryPosition === 'P';

      const base: SeasonPlayerStats = {
        playerId: player.id,
        playerName: player.fullName,
        team: player.currentTeam.name,
        level,
        sportId: player.sportId,
        position: player.primaryPosition,
        parentOrg: player.parentOrg,
    parentOrgAbbrev: player.parentOrgAbbrev,
        gamesPlayed: 0,
        isPitcher,
      };

      try {
        const group = isPitcher ? 'pitching' : 'hitting';
        // Fetch both regular and sabermetrics stats
        const [regularData, saberData] = await Promise.all([
          cachedFetch<Record<string, unknown>>(
            `${MLB_API}/people/${player.id}/stats?stats=season&group=${group}&season=${currentSeason}`
          ).catch(() => null),
          cachedFetch<Record<string, unknown>>(
            `${MLB_API}/people/${player.id}/stats?stats=sabermetrics&group=${group}&season=${currentSeason}`
          ).catch(() => null),
        ]);

        // Parse regular stats
        const regularStats = regularData?.stats as Array<{ splits: Array<{ stat: Record<string, unknown> }> }> | undefined;
        const stat = regularStats?.[0]?.splits?.[0]?.stat;

        if (!stat) return base;

        if (isPitcher) {
          base.gamesPlayed = (stat.gamesPlayed as number) || 0;
          base.era = stat.era as string;
          base.whip = stat.whip as string;
          base.inningsPitched = stat.inningsPitched as string;
          base.pitchingStrikeouts = (stat.strikeOuts as number) || 0;
          base.walksAllowed = (stat.baseOnBalls as number) || 0;
          base.wins = (stat.wins as number) || 0;
          base.losses = (stat.losses as number) || 0;
          base.saves = (stat.saves as number) || 0;
          base.kPer9 = stat.strikeoutsPer9Inn as string;
          base.bbPer9 = stat.walksPer9Inn as string;
        } else {
          base.gamesPlayed = (stat.gamesPlayed as number) || 0;
          base.avg = stat.avg as string;
          base.obp = stat.obp as string;
          base.slg = stat.slg as string;
          base.ops = stat.ops as string;
          base.homeRuns = (stat.homeRuns as number) || 0;
          base.stolenBases = (stat.stolenBases as number) || 0;
          base.walks = (stat.baseOnBalls as number) || 0;
          base.strikeouts = (stat.strikeOuts as number) || 0;
          base.doubles = (stat.doubles as number) || 0;
          base.triples = (stat.triples as number) || 0;
          base.plateAppearances = (stat.plateAppearances as number) || 0;
        }

        // Parse sabermetrics for wRC+
        const saberStats = saberData?.stats as Array<{ splits: Array<{ stat: Record<string, unknown> }> }> | undefined;
        const saber = saberStats?.[0]?.splits?.[0]?.stat;
        if (saber && !isPitcher) {
          base.wrcPlus = saber.wRcPlus as number | undefined;
          if (base.wrcPlus === undefined) {
            base.wrcPlus = saber.wrcPlus as number | undefined;
          }
        }

        // Calculate OPS+ as fallback when wRC+ is unavailable
        if (!isPitcher && base.wrcPlus === undefined && base.obp && base.slg) {
          const lgAvg = await getLeagueAverages(player.sportId, currentSeason);
          if (lgAvg) {
            const playerOBP = parseFloat(base.obp);
            const playerSLG = parseFloat(base.slg);
            const lgOBP = parseFloat(lgAvg.lgOBP);
            const lgSLG = parseFloat(lgAvg.lgSLG);
            if (lgOBP > 0 && lgSLG > 0) {
              base.opsPlus = Math.round(100 * (playerOBP / lgOBP + playerSLG / lgSLG - 1));
            }
          }
        }

        return base;
      } catch {
        return base;
      }
    })
  );

  return results;
}

// --- League Averages ---

// Approximate average ages per level (stable year-to-year)
const LEVEL_AVG_AGES: Record<number, number> = {
  1: 28.5,  // MLB
  11: 26.5, // AAA
  12: 24.0, // AA
  13: 23.0, // High-A
  14: 22.0, // A
};

let leagueAvgCache: Map<string, LeagueAverages> | null = null;
let leagueAvgExpires = 0;

async function getLeagueAverages(sportId: number, season?: number): Promise<LeagueAverages | null> {
  const currentSeason = season || new Date().getFullYear();
  const key = `${sportId}-${currentSeason}`;

  // Check cache
  const now = Date.now();
  if (leagueAvgCache && leagueAvgExpires > now) {
    return leagueAvgCache.get(key) || null;
  }

  // Fetch all levels at once and cache
  leagueAvgCache = new Map();

  await Promise.all(
    ALL_SPORT_IDS.map(async (sid) => {
      try {
        const [hittingData, pitchingData] = await Promise.all([
          cachedFetch<Record<string, unknown>>(
            `${MLB_API}/teams/stats?stats=season&group=hitting&season=${currentSeason}&sportIds=${sid}`,
            3600_000
          ).catch(() => null),
          cachedFetch<Record<string, unknown>>(
            `${MLB_API}/teams/stats?stats=season&group=pitching&season=${currentSeason}&sportIds=${sid}`,
            3600_000
          ).catch(() => null),
        ]);

        let lgOPS = '.000', lgOBP = '.000', lgSLG = '.000', lgERA = '0.00';

        // Compute weighted averages from team splits
        const hittingSplits = (hittingData?.stats as Array<{ splits: Array<{ stat: Record<string, unknown> }> }>)?.[0]?.splits;
        if (hittingSplits && hittingSplits.length > 0) {
          let totalPA = 0, weightedOPS = 0, weightedOBP = 0, weightedSLG = 0;
          for (const sp of hittingSplits) {
            const s = sp.stat;
            const pa = (s.plateAppearances as number) || 0;
            totalPA += pa;
            weightedOPS += pa * parseFloat((s.ops as string) || '0');
            weightedOBP += pa * parseFloat((s.obp as string) || '0');
            weightedSLG += pa * parseFloat((s.slg as string) || '0');
          }
          if (totalPA > 0) {
            lgOPS = (weightedOPS / totalPA).toFixed(3);
            lgOBP = (weightedOBP / totalPA).toFixed(3);
            lgSLG = (weightedSLG / totalPA).toFixed(3);
          }
        }

        const pitchingSplits = (pitchingData?.stats as Array<{ splits: Array<{ stat: Record<string, unknown> }> }>)?.[0]?.splits;
        if (pitchingSplits && pitchingSplits.length > 0) {
          let totalIP = 0, weightedERA = 0;
          for (const sp of pitchingSplits) {
            const s = sp.stat;
            const ipStr = (s.inningsPitched as string) || '0';
            const ip = parseIP(ipStr);
            totalIP += ip;
            weightedERA += ip * parseFloat((s.era as string) || '0');
          }
          if (totalIP > 0) {
            lgERA = (weightedERA / totalIP).toFixed(2);
          }
        }

        const cacheKey = `${sid}-${currentSeason}`;
        leagueAvgCache!.set(cacheKey, {
          sportId: sid,
          level: LEVEL_LABELS[sid] || 'Unknown',
          avgAge: LEVEL_AVG_AGES[sid] || 25,
          lgOPS,
          lgOBP,
          lgSLG,
          lgERA,
        });
      } catch {
        // Skip this level
      }
    })
  );

  leagueAvgExpires = now + 3600_000; // 1 hour
  return leagueAvgCache.get(key) || null;
}

export async function getAllLeagueAverages(): Promise<LeagueAverages[]> {
  const season = new Date().getFullYear();
  // Ensure cache is populated
  await getLeagueAverages(1, season);
  return Array.from(leagueAvgCache?.values() || []);
}
