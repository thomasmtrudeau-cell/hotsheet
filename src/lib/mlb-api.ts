import { LEVEL_LABELS, SearchResult, DailyPlayerStats, SeasonPlayerStats, FollowedPlayer, LeagueAverages, isMLBSystem, InjuryStatus } from './types';
import { gradeHitter, gradePitcher, formatBattingLine, formatPitchingLine, parseIP } from './grading';

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const ALL_SPORT_IDS = [1, 11, 12, 13, 14];

// Convert decimal IP (e.g. 6.333) back to standard notation (e.g. "6.1")
function formatIP(ip: number): string {
  const whole = Math.floor(ip);
  const frac = Math.round((ip - whole) * 3);
  return `${whole}.${frac}`;
}

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

// --- Injury status lookup (per-team roster) ---

const IL_CODE_LABELS: Record<string, string> = {
  D7: '7-Day IL',
  D10: '10-Day IL',
  D15: '15-Day IL',
  D60: '60-Day IL',
  ILF: 'Full-Season IL',
};

interface RosterEntry {
  person: { id: number };
  status?: { code?: string; description?: string };
  note?: string;
}

async function getInjuryStatusForTeams(teamIds: number[]): Promise<Map<number, InjuryStatus>> {
  const season = new Date().getFullYear();
  const result = new Map<number, InjuryStatus>();
  const uniqueIds = Array.from(new Set(teamIds));
  const rosters = await Promise.all(
    uniqueIds.map((id) =>
      cachedFetch<{ roster?: RosterEntry[] }>(
        `${MLB_API}/teams/${id}/roster?rosterType=fullRoster&season=${season}`,
        600_000 // 10 min cache
      ).catch(() => ({ roster: [] as RosterEntry[] }))
    )
  );
  for (const data of rosters) {
    for (const entry of data.roster ?? []) {
      const code = entry.status?.code;
      if (!code || !(code in IL_CODE_LABELS)) continue;
      result.set(entry.person.id, {
        code,
        label: IL_CODE_LABELS[code],
        note: entry.note,
      });
    }
  }
  return result;
}

// --- Hydrate followed players with correct team data + names ---

export async function hydrateFollowedPlayers(players: FollowedPlayer[]): Promise<FollowedPlayer[]> {
  const teamMap = await getTeamLookup();

  // Batch lookup player details to fix names + current team
  const ids = players.map((p) => p.id).join(',');
  const playerDetails: Map<number, Record<string, unknown>> = new Map();
  try {
    const data = await cachedFetch<{ people?: Array<Record<string, unknown>> }>(
      `${MLB_API}/people?personIds=${ids}&hydrate=currentTeam`,
      3600_000
    );
    if (data.people) {
      for (const p of data.people) {
        playerDetails.set(p.id as number, p);
      }
    }
  } catch {
    // Fall back to existing data
  }

  // Resolve current team from player details first, so the roster lookup targets the right teams
  const withTeams = players.map((p) => {
    const details = playerDetails.get(p.id);
    let currentTeam = p.currentTeam;
    if (details?.currentTeam) {
      const apiTeam = details.currentTeam as Record<string, unknown>;
      if (apiTeam.id && apiTeam.name) {
        currentTeam = { id: apiTeam.id as number, name: apiTeam.name as string };
      }
    }
    return { p, details, currentTeam };
  });

  const injuryMap = await getInjuryStatusForTeams(
    withTeams.map(({ currentTeam }) => currentTeam.id)
  );

  return withTeams.map(({ p, details, currentTeam }) => {
    const teamInfo = teamMap.get(currentTeam.id);
    return {
      ...p,
      fullName: details ? formatDisplayName(details) : p.fullName,
      currentTeam,
      sportId: teamInfo?.sportId ?? p.sportId,
      parentOrg: teamInfo?.parentOrgName ?? p.parentOrg,
      parentOrgAbbrev: teamInfo?.parentOrgAbbrev ?? p.parentOrgAbbrev,
      injury: injuryMap.get(p.id),
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
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const searchTerms = normalize(query).split(/\s+/).filter(Boolean);

  return searchData.people
    .filter((p) => {
      if (!p.currentTeam) return false;
      const fullFML = (p.fullFMLName as string) || '';
      const fullName = (p.fullName as string) || '';
      const lastName = (p.lastName as string) || '';
      const firstName = (p.firstName as string) || '';
      const useName = (p.useName as string) || '';
      const nickName = (p.nickName as string) || '';
      const searchable = normalize(`${firstName} ${useName} ${nickName} ${lastName} ${fullName} ${fullFML}`);
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
    away: { team: { id: number; name: string }; probablePitcher?: { id: number; fullName: string } };
    home: { team: { id: number; name: string }; probablePitcher?: { id: number; fullName: string } };
  };
  lineups?: {
    homePlayers?: Array<{ id: number; primaryPosition?: { abbreviation: string } }>;
    awayPlayers?: Array<{ id: number; primaryPosition?: { abbreviation: string } }>;
  };
}

async function getGamesForDate(date: string): Promise<ScheduleGame[]> {
  const games: ScheduleGame[] = [];
  // Fetch all sport IDs in parallel
  const results = await Promise.all(
    ALL_SPORT_IDS.map((sportId) =>
      cachedFetch<{ dates?: Array<{ games: ScheduleGame[] }> }>(
        `${MLB_API}/schedule?date=${date}&sportId=${sportId}&hydrate=team,probablePitcher,lineups`
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

function getLineupInfo(player: FollowedPlayer, game: ScheduleGame): {
  lineupStatus: DailyPlayerStats['lineupStatus'];
  startingPosition?: string;
  battingOrder?: number;
} {
  // Check probable pitcher
  const awayPP = game.teams.away.probablePitcher;
  const homePP = game.teams.home.probablePitcher;
  if (awayPP?.id === player.id || homePP?.id === player.id) {
    return { lineupStatus: 'probable_pitcher', startingPosition: 'SP', battingOrder: undefined };
  }

  // Check lineups (position players) — array order is batting order
  const lineups = game.lineups;
  if (!lineups) return { lineupStatus: undefined };
  const allPlayers = [
    ...(lineups.homePlayers || []),
    ...(lineups.awayPlayers || []),
  ];
  if (allPlayers.length === 0) return { lineupStatus: undefined };

  // Find which side the player is on to get correct batting order index
  const homeIdx = (lineups.homePlayers || []).findIndex(p => p.id === player.id);
  const awayIdx = (lineups.awayPlayers || []).findIndex(p => p.id === player.id);
  const idx = homeIdx >= 0 ? homeIdx : awayIdx;

  if (idx < 0) return { lineupStatus: 'not_starting' };

  const lineup = homeIdx >= 0 ? lineups.homePlayers! : lineups.awayPlayers!;
  const pos = lineup[idx].primaryPosition?.abbreviation;
  return {
    lineupStatus: 'starting',
    startingPosition: pos,
    battingOrder: idx + 1, // 0-indexed → 1-indexed
  };
}

interface BoxscorePlayer {
  person: { id: number; fullName: string };
  stats: {
    batting?: Record<string, unknown>;
    pitching?: Record<string, unknown>;
  };
  position: { abbreviation: string };
  battingOrder?: string; // e.g. "500" = 5th
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
    injury: player.injury,
  };

  if (!game) return base;

  base.gameStatus = getGameStatus(game);
  base.gameContext = getGameContext(game);
  base.gameTime = getGameTime(game);
  base.gameStartTime = new Date(game.gameDate).getTime();
  base.gamePk = game.gamePk;

  // Populate starting position / batting order from boxscore (live/final games)
  if (boxscorePlayer?.battingOrder) {
    base.battingOrder = parseInt(boxscorePlayer.battingOrder, 10) / 100;
    base.startingPosition = boxscorePlayer.position?.abbreviation;
  }

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

  const isPitcherPosition = player.primaryPosition === 'P';
  const isProbablePitcher = game && (
    game.teams.away.probablePitcher?.id === player.id ||
    game.teams.home.probablePitcher?.id === player.id
  );

  if (!boxscorePlayer) {
    if (isPitcherPosition && base.gameStatus === 'Live') {
      base.isPitcherLine = true;
      if (isProbablePitcher) {
        // Scheduled starter hasn't taken the mound yet
        base.performanceGrade = 'scheduled';
        base.gradeReason = 'Has not entered';
        base.statLine = 'Awaiting entry';
      } else {
        // RP who could still enter — sort below active but above DNP
        base.performanceGrade = 'scheduled';
        base.gradeReason = 'Has not entered';
        base.statLine = 'Awaiting entry';
      }
    } else {
      base.performanceGrade = 'routine';
      base.gradeReason = 'Not in lineup';
      base.statLine = 'DNP';
    }
    return base;
  }

  const batting = boxscorePlayer.stats.batting as Record<string, number> | undefined;
  const pitching = boxscorePlayer.stats.pitching as Record<string, unknown> | undefined;

  // Determine if this is a pitching or batting line
  const hasPitching = pitching && (pitching.inningsPitched as string) !== undefined && pitching.inningsPitched !== '0.0' && pitching.inningsPitched !== '';

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
  } else if (isPitcherPosition) {
    // Pitcher in boxscore but hasn't recorded an out yet (e.g. Gausman not starting)
    base.isPitcherLine = true;
    if (base.gameStatus === 'Live') {
      base.performanceGrade = 'scheduled';
      base.gradeReason = 'Has not entered';
      base.statLine = 'Awaiting entry';
    } else {
      // Game Final — pitcher was rostered but never pitched
      base.performanceGrade = 'routine';
      base.gradeReason = 'Did not pitch';
      base.statLine = 'DNP';
    }
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
      const stats = buildDailyStats(player, game, null);
      if (status === 'Scheduled') {
        const info = getLineupInfo(player, game);
        stats.lineupStatus = info.lineupStatus;
        stats.startingPosition = info.startingPosition;
        stats.battingOrder = info.battingOrder;
      }
      return stats;
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
        injury: player.injury,
      };

      try {
        const group = isPitcher ? 'pitching' : 'hitting';

        // For MiLB/MLB players, fetch all sport IDs to catch promotions/demotions/rehab stints
        const sportIdsToTry = isMLBSystem(player.sportId) ? ALL_SPORT_IDS : [player.sportId];
        const [allRegularData, saberData] = await Promise.all([
          Promise.all(
            sportIdsToTry.map((sid) =>
              cachedFetch<Record<string, unknown>>(
                `${MLB_API}/people/${player.id}/stats?stats=season&group=${group}&season=${currentSeason}&sportId=${sid}`
              ).catch(() => null)
            )
          ),
          cachedFetch<Record<string, unknown>>(
            `${MLB_API}/people/${player.id}/stats?stats=sabermetrics&group=${group}&season=${currentSeason}&sportId=${player.sportId}`
          ).catch(() => null),
        ]);

        // Collect all splits across all levels
        const allSplits: Array<{ stat: Record<string, unknown>; sportId: number }> = [];
        for (let i = 0; i < sportIdsToTry.length; i++) {
          const data = allRegularData[i];
          const stats = data?.stats as Array<{ splits: Array<{ stat: Record<string, unknown> }> }> | undefined;
          const splits = stats?.[0]?.splits;
          if (splits) {
            for (const sp of splits) {
              allSplits.push({ stat: sp.stat, sportId: sportIdsToTry[i] });
            }
          }
        }

        if (allSplits.length === 0) return base;

        // Combine stats across all levels
        if (isPitcher) {
          let totalG = 0, totalER = 0, totalIP = 0, totalK = 0, totalBB = 0;
          let totalW = 0, totalL = 0, totalSV = 0, totalH = 0;
          for (const { stat } of allSplits) {
            totalG += (stat.gamesPlayed as number) || 0;
            totalER += (stat.earnedRuns as number) || 0;
            totalIP += parseIP((stat.inningsPitched as string) || '0');
            totalK += (stat.strikeOuts as number) || 0;
            totalBB += (stat.baseOnBalls as number) || 0;
            totalW += (stat.wins as number) || 0;
            totalL += (stat.losses as number) || 0;
            totalSV += (stat.saves as number) || 0;
            totalH += (stat.hits as number) || 0;
          }
          base.gamesPlayed = totalG;
          base.era = totalIP > 0 ? (totalER * 9 / totalIP).toFixed(2) : '0.00';
          base.whip = totalIP > 0 ? ((totalBB + totalH) / totalIP).toFixed(2) : '0.00';
          base.inningsPitched = formatIP(totalIP);
          base.pitchingStrikeouts = totalK;
          base.walksAllowed = totalBB;
          base.wins = totalW;
          base.losses = totalL;
          base.saves = totalSV;
          base.kPer9 = totalIP > 0 ? (totalK * 9 / totalIP).toFixed(2) : '0.00';
          base.bbPer9 = totalIP > 0 ? (totalBB * 9 / totalIP).toFixed(2) : '0.00';
        } else {
          let totalG = 0, totalAB = 0, totalH = 0, totalHR = 0, totalSB = 0;
          let totalBB = 0, totalK = 0, totalPA = 0, totalD = 0, totalT = 0;
          let totalHBP = 0, totalSF = 0, totalTB = 0;
          for (const { stat } of allSplits) {
            totalG += (stat.gamesPlayed as number) || 0;
            totalAB += (stat.atBats as number) || 0;
            totalH += (stat.hits as number) || 0;
            totalHR += (stat.homeRuns as number) || 0;
            totalSB += (stat.stolenBases as number) || 0;
            totalBB += (stat.baseOnBalls as number) || 0;
            totalK += (stat.strikeOuts as number) || 0;
            totalPA += (stat.plateAppearances as number) || 0;
            totalD += (stat.doubles as number) || 0;
            totalT += (stat.triples as number) || 0;
            totalHBP += (stat.hitByPitch as number) || 0;
            totalSF += (stat.sacFlies as number) || 0;
            totalTB += (stat.totalBases as number) || 0;
          }
          base.gamesPlayed = totalG;
          base.avg = totalAB > 0 ? (totalH / totalAB).toFixed(3) : '.000';
          const obpDenom = totalAB + totalBB + totalHBP + totalSF;
          base.obp = obpDenom > 0 ? ((totalH + totalBB + totalHBP) / obpDenom).toFixed(3) : '.000';
          base.slg = totalAB > 0 ? (totalTB / totalAB).toFixed(3) : '.000';
          base.ops = (parseFloat(base.obp) + parseFloat(base.slg)).toFixed(3);
          base.homeRuns = totalHR;
          base.stolenBases = totalSB;
          base.walks = totalBB;
          base.strikeouts = totalK;
          base.doubles = totalD;
          base.triples = totalT;
          base.plateAppearances = totalPA;
        }

        // Parse sabermetrics for wRC+ (use current level)
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
