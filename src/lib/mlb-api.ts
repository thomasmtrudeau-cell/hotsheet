import { LEVEL_LABELS, SearchResult, DailyPlayerStats, SeasonPlayerStats, SeasonLevelLine, FollowedPlayer, LeagueAverages, GameLogEntry, isMLBSystem, InjuryStatus, RecentForm, Matchup, RangePlayerStats, CallUp } from './types';
import { gradeHitter, gradePitcher, formatBattingLine, formatPitchingLine, parseIP } from './grading';

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const ALL_SPORT_IDS = [1, 11, 12, 13, 14];

// Approximate multi-year runs park factors (100 = neutral, >100 hitter-friendly).
// Keyed by venue-name substring so renames/variants still match. MLB parks only;
// anything unmatched (incl. MiLB) is treated as neutral and simply omitted.
const PARK_FACTORS: Array<[string, number]> = [
  ['Coors Field', 112], ['Fenway Park', 106], ['Great American Ball Park', 105],
  ['Citizens Bank Park', 103], ['Chase Field', 103], ['Yankee Stadium', 103],
  ['Camden Yards', 101], ['Wrigley Field', 102], ['Globe Life Field', 100],
  ['Truist Park', 101], ['Nationals Park', 101], ['American Family Field', 101],
  ['Rogers Centre', 101], ['Daikin Park', 101], ['Minute Maid', 101], ['Rate Field', 101],
  ['Angel Stadium', 100], ['Dodger Stadium', 99], ['Target Field', 99],
  ['Progressive Field', 98], ['Kauffman Stadium', 98], ['Busch Stadium', 97],
  ['PNC Park', 97], ['Comerica Park', 97], ['loanDepot park', 96], ['Citi Field', 96],
  ['Petco Park', 95], ['Oracle Park', 94], ['T-Mobile Park', 93],
];

function parkFactorFor(venueName?: string): number | undefined {
  if (!venueName) return undefined;
  const hit = PARK_FACTORS.find(([name]) => venueName.includes(name));
  return hit?.[1];
}

// Convert decimal IP (e.g. 6.333) back to standard notation (e.g. "6.1")
function formatIP(ip: number): string {
  const whole = Math.floor(ip);
  const frac = Math.round((ip - whole) * 3);
  return `${whole}.${frac}`;
}

// --- wOBA / wRC+ estimation ---
// Generic (league-agnostic) linear weights + scale. These don't vary by year/level
// here, so the resulting wRC+ is an ESTIMATE — good enough to track FanGraphs to a
// few points, but not park- or run-environment-adjusted. Always label it as such.
const WOBA_WEIGHTS = { bb: 0.69, hbp: 0.72, b1: 0.89, b2: 1.27, b3: 1.62, hr: 2.10 };
const WOBA_SCALE = 1.24;

interface WobaComponents {
  ab: number; h: number; doubles: number; triples: number; hr: number;
  bb: number; ibb: number; hbp: number; sf: number;
}

function computeWoba(c: WobaComponents): number | null {
  const denom = c.ab + c.bb - c.ibb + c.sf + c.hbp;
  if (denom <= 0) return null;
  const uBB = Math.max(0, c.bb - c.ibb);
  const singles = Math.max(0, c.h - c.doubles - c.triples - c.hr);
  const num =
    WOBA_WEIGHTS.bb * uBB +
    WOBA_WEIGHTS.hbp * c.hbp +
    WOBA_WEIGHTS.b1 * singles +
    WOBA_WEIGHTS.b2 * c.doubles +
    WOBA_WEIGHTS.b3 * c.triples +
    WOBA_WEIGHTS.hr * c.hr;
  return num / denom;
}

// wRC+ estimate (no park factor): ((wOBA - lgwOBA)/scale + lgR/PA) / (lgR/PA) * 100
function estimateWrcPlus(woba: number, lgWoba?: number, lgRunsPerPA?: number): number | undefined {
  if (!lgWoba || !lgRunsPerPA || lgRunsPerPA <= 0) return undefined;
  return Math.round((((woba - lgWoba) / WOBA_SCALE + lgRunsPerPA) / lgRunsPerPA) * 100);
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

export interface TeamInfo {
  sportId: number;
  sportName: string;
  teamName?: string;
  parentOrgName?: string;
  parentOrgAbbrev?: string;
}

let teamLookupCache: Map<number, TeamInfo> | null = null;
let teamLookupExpires = 0;

export async function getTeamLookup(): Promise<Map<number, TeamInfo>> {
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
      teamName: t.name as string | undefined,
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

// A rehab assignment is a distinct MLB roster status ("RA"): an IL player
// temporarily playing for a minor-league affiliate. The player carries many
// historical RA entries across affiliates/leagues — only the one flagged
// isActive is the current assignment. This is NOT the same as being on the
// minor-league IL (code "D7"/"D60"), which is just an injured minor-leaguer.
function isOnRehabAssignment(details?: Record<string, unknown>): boolean {
  const entries = (details?.rosterEntries as Array<{
    status?: { code?: string };
    isActive?: boolean;
  }>) ?? [];
  return entries.some((e) => e.isActive && e.status?.code === 'RA');
}

async function getInjuryStatusForTeams(
  teamIds: number[],
  failedTeams?: Set<number>
): Promise<Map<number, InjuryStatus>> {
  const season = new Date().getFullYear();
  const result = new Map<number, InjuryStatus>();
  const uniqueIds = Array.from(new Set(teamIds));
  const rosters = await Promise.all(
    uniqueIds.map((id) =>
      cachedFetch<{ roster?: RosterEntry[] }>(
        `${MLB_API}/teams/${id}/roster?rosterType=fullRoster&season=${season}`,
        600_000 // 10 min cache
      ).catch(() => {
        failedTeams?.add(id);
        return { roster: [] as RosterEntry[] };
      })
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

export async function hydrateFollowedPlayers(
  players: FollowedPlayer[],
  failedInjuryTeams?: Set<number>
): Promise<FollowedPlayer[]> {
  const teamMap = await getTeamLookup();

  // Batch lookup player details to fix names + current team
  const ids = players.map((p) => p.id).join(',');
  const playerDetails: Map<number, Record<string, unknown>> = new Map();
  try {
    const data = await cachedFetch<{ people?: Array<Record<string, unknown>> }>(
      `${MLB_API}/people?personIds=${ids}&hydrate=currentTeam,rosterEntries`,
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
    withTeams.map(({ currentTeam }) => currentTeam.id),
    failedInjuryTeams
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
      onRehab: isOnRehabAssignment(details),
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
  venue?: { id: number; name: string };
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
        `${MLB_API}/schedule?date=${date}&sportId=${sportId}&hydrate=team,probablePitcher,lineups,venue`
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

  // Only the player's own team's lineup tells us whether they're starting.
  // The opposing team may have posted before the player's team does.
  const isHome = game.teams.home.team.id === player.currentTeam.id;
  const ownLineup = isHome ? lineups.homePlayers : lineups.awayPlayers;
  if (!ownLineup || ownLineup.length === 0) return { lineupStatus: undefined };

  const idx = ownLineup.findIndex(p => p.id === player.id);
  if (idx < 0) return { lineupStatus: 'not_starting' };

  const pos = ownLineup[idx].primaryPosition?.abbreviation;
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
    onRehab: player.onRehab,
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

// --- Recent form (rolling last-15-day line) ---

interface DateRangeStat {
  gamesPlayed?: number;
  plateAppearances?: number;
  atBats?: number;
  hits?: number;
  doubles?: number;
  triples?: number;
  homeRuns?: number;
  baseOnBalls?: number;
  intentionalWalks?: number;
  hitByPitch?: number;
  sacFlies?: number;
  stolenBases?: number;
  avg?: string;
  ops?: string;
  era?: string;
  inningsPitched?: string;
  whip?: string;
  strikeOuts?: number;
  saves?: number;
  wins?: number;
}

// `wrcPlus` is the last-15-day wRC+ ESTIMATE (byDateRange has no real wOBA/wRC+),
// computed by the caller from league averages; undefined when unavailable.
function buildRecentForm(st: DateRangeStat, isPitcher: boolean, wrcPlus?: number): RecentForm {
  const gp = st.gamesPlayed ?? 0;
  if (isPitcher) {
    const era = st.era !== undefined ? parseFloat(st.era) : NaN;
    const ip = parseIP(st.inningsPitched ?? '0');
    let trend: RecentForm['trend'] = 'neutral';
    if (ip >= 4 && !Number.isNaN(era)) {
      if (era <= 3.0) trend = 'hot';
      else if (era >= 5.5) trend = 'cold';
    }
    return { gamesPlayed: gp, isPitcher: true, trend, line: `${st.era ?? '—'} ERA · ${st.inningsPitched ?? '0.0'} IP` };
  }
  const pa = st.plateAppearances ?? 0;
  const ops = st.ops !== undefined ? parseFloat(st.ops) : NaN;
  // Prefer wRC+ for the hot/cold read; fall back to OPS when it's unavailable.
  let trend: RecentForm['trend'] = 'neutral';
  if (pa >= 20) {
    if (wrcPlus !== undefined) {
      if (wrcPlus >= 130) trend = 'hot';
      else if (wrcPlus <= 70) trend = 'cold';
    } else if (!Number.isNaN(ops)) {
      if (ops >= 0.85) trend = 'hot';
      else if (ops <= 0.62) trend = 'cold';
    }
  }
  const wrc = wrcPlus !== undefined ? `${wrcPlus}` : '—';
  return {
    gamesPlayed: gp,
    isPitcher: false,
    trend,
    line: `${pa} PA · ${wrc} wRC+ · ${st.homeRuns ?? 0} HR · ${st.stolenBases ?? 0} SB`,
  };
}

async function getRecentForm(players: FollowedPlayer[], date: string): Promise<Map<number, RecentForm>> {
  const season = new Date(date + 'T00:00:00Z').getUTCFullYear();
  const start = new Date(date + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - 14); // 15-day inclusive window ending on `date`
  const startStr = start.toISOString().slice(0, 10);

  const entries = await Promise.all(
    players.map(async (p) => {
      const isPitcher = p.primaryPosition === 'P';
      const group = isPitcher ? 'pitching' : 'hitting';
      try {
        const data = await cachedFetch<{ stats?: Array<{ splits?: Array<{ stat: DateRangeStat }> }> }>(
          `${MLB_API}/people/${p.id}/stats?stats=byDateRange&startDate=${startStr}&endDate=${date}&group=${group}&sportId=${p.sportId}&season=${season}`,
          1800_000 // 30 min
        );
        const st = data.stats?.[0]?.splits?.[0]?.stat;
        if (!st || !st.gamesPlayed) return null;
        let wrcPlus: number | undefined;
        if (!isPitcher) {
          const woba = computeWoba({
            ab: st.atBats ?? 0, h: st.hits ?? 0, doubles: st.doubles ?? 0, triples: st.triples ?? 0,
            hr: st.homeRuns ?? 0, bb: st.baseOnBalls ?? 0, ibb: st.intentionalWalks ?? 0,
            hbp: st.hitByPitch ?? 0, sf: st.sacFlies ?? 0,
          });
          if (woba !== null) {
            const lg = await getLeagueAverages(p.sportId, season);
            wrcPlus = estimateWrcPlus(woba, lg?.lgWoba, lg?.lgRunsPerPA);
          }
        }
        return [p.id, buildRecentForm(st, isPitcher, wrcPlus)] as const;
      } catch {
        return null;
      }
    })
  );
  const result = new Map<number, RecentForm>();
  for (const e of entries) if (e) result.set(e[0], e[1]);
  return result;
}

// --- Matchup (today's opposing starter + park), hitters only ---

async function getMatchups(
  players: FollowedPlayer[],
  teamGames: Map<number, ScheduleGame[]>
): Promise<Map<number, Matchup>> {
  const season = new Date().getFullYear();
  const raw = new Map<number, { oppId?: number; venue?: string }>();
  const pitcherIds = new Set<number>();

  for (const p of players) {
    if (p.primaryPosition === 'P') continue; // matchup is a hitter-vs-starter read
    const games = teamGames.get(p.currentTeam.id);
    if (!games || games.length === 0) continue;
    const game = games.find((g) => {
      const s = getGameStatus(g);
      return s === 'Scheduled' || s === 'Live'; // moot once final
    });
    if (!game) continue;
    const isHome = game.teams.home.team.id === p.currentTeam.id;
    const opp = isHome ? game.teams.away.probablePitcher : game.teams.home.probablePitcher;
    raw.set(p.id, { oppId: opp?.id, venue: game.venue?.name });
    if (opp?.id) pitcherIds.add(opp.id);
  }

  // One batched call for every opposing starter's hand + season ERA.
  const pInfo = new Map<number, { name: string; hand?: 'L' | 'R'; era?: number }>();
  if (pitcherIds.size > 0) {
    try {
      const data = await cachedFetch<{ people?: Array<Record<string, unknown>> }>(
        `${MLB_API}/people?personIds=${Array.from(pitcherIds).join(',')}&hydrate=stats(group=pitching,type=season,season=${season})`,
        1800_000
      );
      for (const person of data.people ?? []) {
        const hand = (person.pitchHand as { code?: string } | undefined)?.code;
        const stats = person.stats as Array<{ splits?: Array<{ stat?: { era?: string } }> }> | undefined;
        const eraStr = stats?.[0]?.splits?.[0]?.stat?.era;
        pInfo.set(person.id as number, {
          name: person.fullName as string,
          hand: hand === 'L' || hand === 'R' ? hand : undefined,
          era: eraStr !== undefined ? parseFloat(eraStr) : undefined,
        });
      }
    } catch {
      // Leave pInfo empty — matchup can still show park factor.
    }
  }

  const result = new Map<number, Matchup>();
  raw.forEach(({ oppId, venue }, playerId) => {
    const info = oppId ? pInfo.get(oppId) : undefined;
    const parkFactor = parkFactorFor(venue);
    if (!info && parkFactor === undefined) return; // nothing useful
    result.set(playerId, {
      oppStarterName: info?.name ?? '',
      oppStarterHand: info?.hand,
      oppStarterEra: info?.era,
      parkFactor,
    });
  });
  return result;
}

// --- Range query: last-N-day stats for an arbitrary player set (any level) ---

export async function getRangeStats(
  players: FollowedPlayer[],
  windowDays: number,
  endDate: string
): Promise<RangePlayerStats[]> {
  const season = new Date(endDate + 'T00:00:00Z').getUTCFullYear();
  const start = new Date(endDate + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  const startStr = start.toISOString().slice(0, 10);

  const results = await Promise.all(
    players.map(async (p) => {
      const isPitcher = p.primaryPosition === 'P';
      const group = isPitcher ? 'pitching' : 'hitting';
      try {
        const data = await cachedFetch<{ stats?: Array<{ splits?: Array<{ stat: DateRangeStat }> }> }>(
          `${MLB_API}/people/${p.id}/stats?stats=byDateRange&startDate=${startStr}&endDate=${endDate}&group=${group}&sportId=${p.sportId}&season=${season}`,
          1800_000
        );
        const st = data.stats?.[0]?.splits?.[0]?.stat;
        if (!st || !st.gamesPlayed) return null; // no games in window → nothing to show
        const base: RangePlayerStats = {
          playerId: p.id,
          playerName: p.fullName,
          team: p.currentTeam.name,
          level: LEVEL_LABELS[p.sportId] || 'Unknown',
          sportId: p.sportId,
          position: p.primaryPosition,
          parentOrgAbbrev: p.parentOrgAbbrev,
          isPitcher,
          gamesPlayed: st.gamesPlayed ?? 0,
        };
        if (isPitcher) {
          base.inningsPitched = st.inningsPitched;
          base.era = st.era;
          base.whip = st.whip;
          base.strikeOuts = st.strikeOuts;
          base.saves = st.saves;
          base.wins = st.wins;
        } else {
          base.plateAppearances = st.plateAppearances;
          base.atBats = st.atBats;
          base.homeRuns = st.homeRuns;
          base.stolenBases = st.stolenBases;
          base.avg = st.avg;
          base.ops = st.ops;
          const woba = computeWoba({
            ab: st.atBats ?? 0, h: st.hits ?? 0, doubles: st.doubles ?? 0, triples: st.triples ?? 0,
            hr: st.homeRuns ?? 0, bb: st.baseOnBalls ?? 0, ibb: st.intentionalWalks ?? 0,
            hbp: st.hitByPitch ?? 0, sf: st.sacFlies ?? 0,
          });
          if (woba !== null) {
            const lg = await getLeagueAverages(p.sportId, season);
            base.wrcPlus = estimateWrcPlus(woba, lg?.lgWoba, lg?.lgRunsPerPA);
          }
        }
        return base;
      } catch {
        return null;
      }
    })
  );
  return results.filter((r): r is RangePlayerStats => r !== null);
}

// --- Two-start week (SP with 2+ starts in the current Mon–Sun fantasy week) ---

async function getTwoStartPitchers(date: string): Promise<Map<number, string[]>> {
  // NEXT calendar week (Mon–Sun) — a two-start week is only actionable before
  // it starts, for setting fantasy lineups. Note: probables are announced only
  // ~5 days out, so next week fills in progressively (most complete over the
  // weekend before it begins).
  const d = new Date(date + 'T00:00:00Z');
  const toMonday = (d.getUTCDay() + 6) % 7; // days back to THIS week's Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - toMonday + 7); // next Monday
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const startStr = monday.toISOString().slice(0, 10);
  const endStr = sunday.toISOString().slice(0, 10);

  const result = new Map<number, string[]>();
  try {
    // MLB fantasy concept — sportId 1 only.
    const data = await cachedFetch<{ dates?: Array<{ date: string; games: ScheduleGame[] }> }>(
      `${MLB_API}/schedule?sportId=1&startDate=${startStr}&endDate=${endStr}&hydrate=probablePitcher`,
      3600_000 // 1 hr; probables shift through the week
    );
    const byPitcher = new Map<number, string[]>();
    for (const dt of data.dates ?? []) {
      for (const g of dt.games ?? []) {
        for (const side of ['away', 'home'] as const) {
          const pp = g.teams[side].probablePitcher;
          if (pp?.id) {
            const arr = byPitcher.get(pp.id) ?? [];
            arr.push(dt.date);
            byPitcher.set(pp.id, arr);
          }
        }
      }
    }
    byPitcher.forEach((dates, pid) => {
      if (dates.length >= 2) result.set(pid, dates.sort());
    });
  } catch {
    // No two-start data this run; cards simply omit the badge.
  }
  return result;
}

// --- Recently called up (recall / contract selection to MLB in the last N days) ---

async function getRecentCallups(date: string, windowDays = 10): Promise<Map<number, string>> {
  const end = new Date(date + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - windowDays);
  const startStr = start.toISOString().slice(0, 10);

  const result = new Map<number, string>();
  try {
    const data = await cachedFetch<{ transactions?: Array<{ typeCode?: string; effectiveDate?: string; date?: string; person?: { id?: number } }> }>(
      `${MLB_API}/transactions?startDate=${startStr}&endDate=${date}&sportId=1`,
      3600_000 // 1 hr
    );
    for (const t of data.transactions ?? []) {
      // CU = Recalled, SE = Selected (contract selection) — both are call-ups.
      if ((t.typeCode === 'CU' || t.typeCode === 'SE') && t.person?.id) {
        const when = (t.effectiveDate || t.date || '').slice(0, 10);
        // Keep the most recent call-up date per player.
        const prev = result.get(t.person.id);
        if (!prev || when > prev) result.set(t.person.id, when);
      }
    }
  } catch {
    // No call-up data this run; cards omit the badge.
  }
  return result;
}

// Pre-built discovery list: everyone recalled/selected to MLB in the last N days.
export async function getCallupList(date: string, windowDays = 7): Promise<CallUp[]> {
  const callupMap = await getRecentCallups(date, windowDays);
  const ids = Array.from(callupMap.keys());
  if (ids.length === 0) return [];

  const [teamMap, data] = await Promise.all([
    getTeamLookup(),
    cachedFetch<{ people?: Array<Record<string, unknown>> }>(
      `${MLB_API}/people?personIds=${ids.join(',')}&hydrate=currentTeam`,
      1800_000
    ),
  ]);

  const out: CallUp[] = [];
  for (const p of data.people ?? []) {
    const team = p.currentTeam as Record<string, unknown> | undefined;
    if (!team?.id) continue;
    const teamId = team.id as number;
    const teamInfo = teamMap.get(teamId);
    const sportId = teamInfo?.sportId ?? 1;
    if (sportId !== 1) continue; // now on an MLB roster (it's an MLB call-up list)
    const pos = p.primaryPosition as Record<string, unknown> | undefined;
    out.push({
      id: p.id as number,
      fullName: formatDisplayName(p),
      primaryPosition: (pos?.abbreviation as string) || 'Unknown',
      currentTeam: { id: teamId, name: team.name as string },
      sportId,
      level: LEVEL_LABELS[sportId] || 'MLB',
      parentOrg: teamInfo?.parentOrgName,
      parentOrgAbbrev: teamInfo?.parentOrgAbbrev,
      calledUpDate: callupMap.get(p.id as number) ?? '',
    });
  }
  out.sort((a, b) => b.calledUpDate.localeCompare(a.calledUpDate)); // most recent first
  return out;
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

  // Rolling recent form + matchup + two-start weeks + recent call-ups, alongside game data.
  const [recentFormMap, matchupMap, twoStartMap, callupMap] = await Promise.all([
    getRecentForm(players, date),
    getMatchups(players, teamGames),
    getTwoStartPitchers(date),
    getRecentCallups(date),
  ]);

  // Build stats for each player
  return players.map((player) => {
    let stat: DailyPlayerStats;
    const playerGames = teamGames.get(player.currentTeam.id);
    if (!playerGames || playerGames.length === 0) {
      stat = buildDailyStats(player, null, null);
    } else if (playerGames.length === 1) {
      stat = buildSingleGameStats(player, playerGames[0], boxscores);
    } else {
      // Doubleheader: aggregate played games, fall through to scheduled if none played
      const playedGames = playerGames.filter((g) => {
        const s = getGameStatus(g);
        return s === 'Live' || s === 'Final';
      });
      const upcomingGames = playerGames.filter((g) => getGameStatus(g) === 'Scheduled');

      if (playedGames.length === 0) {
        stat = buildSingleGameStats(player, playerGames[0], boxscores);
      } else {
        const perGame = playedGames.map((g) => {
          const bs = boxscores.get(g.gamePk);
          const bp = bs ? extractPlayerFromBoxscore(bs, player.id) : null;
          return buildDailyStats(player, g, bp);
        });
        stat = aggregateDoubleheader(perGame, upcomingGames.length);
      }
    }
    stat.recentForm = recentFormMap.get(player.id);
    stat.matchup = matchupMap.get(player.id);
    stat.twoStartDates = twoStartMap.get(player.id);
    stat.calledUpDate = callupMap.get(player.id);
    return stat;
  });
}

function buildSingleGameStats(
  player: FollowedPlayer,
  game: ScheduleGame,
  boxscores: Map<number, Awaited<ReturnType<typeof getBoxscore>>>
): DailyPlayerStats {
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
}

function aggregateDoubleheader(games: DailyPlayerStats[], upcomingCount: number): DailyPlayerStats {
  const first = games[0];
  const tag = `(G1+${games.length === 2 ? 'G2' : `G${games.length}`}${upcomingCount > 0 ? ` · G${games.length + 1} upcoming` : ''})`;
  const base: DailyPlayerStats = { ...first };
  base.gameContext = `${first.gameContext} ${tag}`;

  // Pick the most live status
  base.gameStatus = games.some((g) => g.gameStatus === 'Live') ? 'Live'
    : games.every((g) => g.gameStatus === 'Final') ? 'Final'
    : first.gameStatus;

  if (first.isPitcherLine) {
    let totalIP = 0, er = 0, k = 0, bb = 0, h = 0, w = 0, l = 0, sv = 0;
    for (const g of games) {
      totalIP += parseIP(g.inningsPitched || '0');
      er += g.earnedRuns || 0;
      k += g.pitchingStrikeouts || 0;
      bb += g.walksAllowed || 0;
      h += g.hitsAllowed || 0;
      w += g.wins || 0;
      l += g.losses || 0;
      sv += g.saves || 0;
    }
    base.inningsPitched = formatIP(totalIP);
    base.earnedRuns = er;
    base.pitchingStrikeouts = k;
    base.walksAllowed = bb;
    base.hitsAllowed = h;
    base.wins = w;
    base.losses = l;
    base.saves = sv;
    const { grade, reason } = gradePitcher({
      inningsPitched: totalIP,
      earnedRuns: er,
      strikeouts: k,
      walksAllowed: bb,
      hitsAllowed: h,
      saves: sv,
      wins: w,
      losses: l,
    });
    base.performanceGrade = grade;
    base.gradeReason = `${reason} ${tag}`;
    base.statLine = formatPitchingLine(base);
  } else {
    let h = 0, ab = 0, hr = 0, bb = 0, k = 0, sb = 0, d = 0, t = 0, hbp = 0;
    for (const g of games) {
      h += g.hits || 0;
      ab += g.atBats || 0;
      hr += g.homeRuns || 0;
      bb += g.walks || 0;
      k += g.strikeouts || 0;
      sb += g.stolenBases || 0;
      d += g.doubles || 0;
      t += g.triples || 0;
      hbp += g.hitByPitch || 0;
    }
    base.hits = h;
    base.atBats = ab;
    base.homeRuns = hr;
    base.walks = bb;
    base.strikeouts = k;
    base.stolenBases = sb;
    base.doubles = d;
    base.triples = t;
    base.hitByPitch = hbp;
    if (ab > 0) {
      const { grade, reason } = gradeHitter({
        hits: h, atBats: ab, homeRuns: hr, walks: bb, strikeouts: k,
        stolenBases: sb, doubles: d, triples: t, hitByPitch: hbp,
      });
      base.performanceGrade = grade;
      base.gradeReason = `${reason} ${tag}`;
      base.statLine = formatBattingLine(base);
    } else {
      base.performanceGrade = 'routine';
      base.gradeReason = `Not in lineup ${tag}`;
      base.statLine = 'DNP';
    }
  }
  return base;
}

// --- Season Stats ---

// Per-level aggregates (summed across stints within one level).
interface HitAgg { sid: number; g: number; ab: number; h: number; hr: number; sb: number; bb: number; ibb: number; k: number; pa: number; d: number; t: number; hbp: number; sf: number; tb: number }
interface PitAgg { sid: number; g: number; er: number; ip: number; k: number; bb: number; w: number; l: number; sv: number; h: number }

const LEVEL_RANK: Record<number, number> = { 1: 0, 11: 1, 12: 2, 13: 3, 14: 4 };

function buildHitterLine(a: HitAgg, lg: LeagueAverages | null, saberStat?: Record<string, unknown>): SeasonLevelLine {
  const avg = a.ab > 0 ? (a.h / a.ab).toFixed(3) : '.000';
  const obpDen = a.ab + a.bb + a.hbp + a.sf;
  const obp = obpDen > 0 ? ((a.h + a.bb + a.hbp) / obpDen).toFixed(3) : '.000';
  const slg = a.ab > 0 ? (a.tb / a.ab).toFixed(3) : '.000';
  const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

  const wobaNum = computeWoba({ ab: a.ab, h: a.h, doubles: a.d, triples: a.t, hr: a.hr, bb: a.bb, ibb: a.ibb, hbp: a.hbp, sf: a.sf });
  // FanGraphs rescales MiLB wOBA so league wOBA == league OBP. Match that convention
  // for the DISPLAYED value (wRC+ below still uses the raw value + raw league wOBA,
  // which is scale-invariant).
  let woba: string | undefined;
  if (wobaNum !== null) {
    const lgObp = lg ? parseFloat(lg.lgOBP) : NaN;
    const scaleK = lg?.lgWoba && lg.lgWoba > 0 && isFinite(lgObp) ? lgObp / lg.lgWoba : 1;
    woba = (wobaNum * scaleK).toFixed(3);
  }
  let wrcPlus: number | undefined;
  let wrcPlusEst: number | undefined;

  // Real wOBA/wRC+ exist only for MLB time (sportId 1) via the sabermetrics endpoint.
  if (a.sid === 1 && saberStat) {
    const realWrc = (saberStat.wRcPlus ?? saberStat.wrcPlus) as number | undefined;
    const realWoba = saberStat.woba as number | undefined;
    if (realWoba !== undefined) woba = realWoba.toFixed(3);
    if (realWrc !== undefined) wrcPlus = Math.round(realWrc);
  }
  if (wrcPlus === undefined && wobaNum !== null) {
    wrcPlusEst = estimateWrcPlus(wobaNum, lg?.lgWoba, lg?.lgRunsPerPA);
  }

  return {
    level: LEVEL_LABELS[a.sid] || '?', sportId: a.sid, isPitcher: false,
    gamesPlayed: a.g, plateAppearances: a.pa, avg, obp, slg, ops, woba, wrcPlus, wrcPlusEst, homeRuns: a.hr,
  };
}

function buildPitcherLine(a: PitAgg): SeasonLevelLine {
  return {
    level: LEVEL_LABELS[a.sid] || '?', sportId: a.sid, isPitcher: true,
    gamesPlayed: a.g,
    era: a.ip > 0 ? (a.er * 9 / a.ip).toFixed(2) : '0.00',
    whip: a.ip > 0 ? ((a.bb + a.h) / a.ip).toFixed(2) : '0.00',
    inningsPitched: formatIP(a.ip),
  };
}

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

        // Fetch every level (catches promotions/demotions/rehab) + MLB sabermetrics
        // (the only level with real wOBA/wRC+).
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
            `${MLB_API}/people/${player.id}/stats?stats=sabermetrics&group=${group}&season=${currentSeason}&sportId=1`
          ).catch(() => null),
        ]);
        const saberStat = (saberData?.stats as Array<{ splits: Array<{ stat: Record<string, unknown> }> }> | undefined)?.[0]?.splits?.[0]?.stat;

        // Aggregate each level separately — NEVER blend rate stats across levels.
        const hitAggs: HitAgg[] = [];
        const pitAggs: PitAgg[] = [];
        for (let i = 0; i < sportIdsToTry.length; i++) {
          const sid = sportIdsToTry[i];
          const splits = (allRegularData[i]?.stats as Array<{ splits: Array<{ stat: Record<string, unknown> }> }> | undefined)?.[0]?.splits;
          if (!splits || splits.length === 0) continue;

          if (isPitcher) {
            const a: PitAgg = { sid, g: 0, er: 0, ip: 0, k: 0, bb: 0, w: 0, l: 0, sv: 0, h: 0 };
            for (const sp of splits) {
              const s = sp.stat;
              a.g += (s.gamesPlayed as number) || 0;
              a.er += (s.earnedRuns as number) || 0;
              a.ip += parseIP((s.inningsPitched as string) || '0');
              a.k += (s.strikeOuts as number) || 0;
              a.bb += (s.baseOnBalls as number) || 0;
              a.w += (s.wins as number) || 0;
              a.l += (s.losses as number) || 0;
              a.sv += (s.saves as number) || 0;
              a.h += (s.hits as number) || 0;
            }
            if (a.g > 0 || a.ip > 0) pitAggs.push(a);
          } else {
            const a: HitAgg = { sid, g: 0, ab: 0, h: 0, hr: 0, sb: 0, bb: 0, ibb: 0, k: 0, pa: 0, d: 0, t: 0, hbp: 0, sf: 0, tb: 0 };
            for (const sp of splits) {
              const s = sp.stat;
              a.g += (s.gamesPlayed as number) || 0;
              a.ab += (s.atBats as number) || 0;
              a.h += (s.hits as number) || 0;
              a.hr += (s.homeRuns as number) || 0;
              a.sb += (s.stolenBases as number) || 0;
              a.bb += (s.baseOnBalls as number) || 0;
              a.ibb += (s.intentionalWalks as number) || 0;
              a.k += (s.strikeOuts as number) || 0;
              a.pa += (s.plateAppearances as number) || 0;
              a.d += (s.doubles as number) || 0;
              a.t += (s.triples as number) || 0;
              a.hbp += (s.hitByPitch as number) || 0;
              a.sf += (s.sacFlies as number) || 0;
              a.tb += (s.totalBases as number) || 0;
            }
            if (a.pa > 0 || a.g > 0) hitAggs.push(a);
          }
        }

        if (isPitcher) {
          if (pitAggs.length === 0) return base;
          // Current level = the one matching the (re-hydrated) current sportId, else most IP.
          const current = pitAggs.find((a) => a.sid === player.sportId) ??
            [...pitAggs].sort((x, y) => y.ip - x.ip)[0];
          const c = current;
          base.level = LEVEL_LABELS[c.sid] || base.level;
          base.sportId = c.sid;
          base.gamesPlayed = c.g;
          base.era = c.ip > 0 ? (c.er * 9 / c.ip).toFixed(2) : '0.00';
          base.whip = c.ip > 0 ? ((c.bb + c.h) / c.ip).toFixed(2) : '0.00';
          base.inningsPitched = formatIP(c.ip);
          base.pitchingStrikeouts = c.k;
          base.walksAllowed = c.bb;
          base.wins = c.w;
          base.losses = c.l;
          base.saves = c.sv;
          base.kPer9 = c.ip > 0 ? (c.k * 9 / c.ip).toFixed(2) : '0.00';
          base.bbPer9 = c.ip > 0 ? (c.bb * 9 / c.ip).toFixed(2) : '0.00';
          if (pitAggs.length > 1) {
            base.levelLines = [...pitAggs].sort((x, y) => (LEVEL_RANK[x.sid] ?? 9) - (LEVEL_RANK[y.sid] ?? 9)).map(buildPitcherLine);
          }
        } else {
          if (hitAggs.length === 0) return base;
          const current = hitAggs.find((a) => a.sid === player.sportId) ??
            [...hitAggs].sort((x, y) => y.pa - x.pa)[0];
          const c = current;
          // League averages for the current level → wRC+ estimate.
          const lgAvg = await getLeagueAverages(c.sid, currentSeason);
          const line = buildHitterLine(c, lgAvg, saberStat);
          base.level = line.level;
          base.sportId = c.sid;
          base.gamesPlayed = c.g;
          base.avg = line.avg;
          base.obp = line.obp;
          base.slg = line.slg;
          base.ops = line.ops;
          base.woba = line.woba;
          base.wrcPlus = line.wrcPlus;
          base.wrcPlusEst = line.wrcPlusEst;
          base.homeRuns = c.hr;
          base.stolenBases = c.sb;
          base.walks = c.bb;
          base.strikeouts = c.k;
          base.doubles = c.d;
          base.triples = c.t;
          base.plateAppearances = c.pa;
          if (hitAggs.length > 1) {
            const ordered = [...hitAggs].sort((x, y) => (LEVEL_RANK[x.sid] ?? 9) - (LEVEL_RANK[y.sid] ?? 9));
            base.levelLines = await Promise.all(
              ordered.map(async (a) => buildHitterLine(a, await getLeagueAverages(a.sid, currentSeason), saberStat))
            );
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
        let lgWoba: number | undefined;
        let lgRunsPerPA: number | undefined;

        // Compute weighted averages + league wOBA/R-per-PA from team splits
        const hittingSplits = (hittingData?.stats as Array<{ splits: Array<{ stat: Record<string, unknown> }> }>)?.[0]?.splits;
        if (hittingSplits && hittingSplits.length > 0) {
          let totalPA = 0, weightedOPS = 0, weightedOBP = 0, weightedSLG = 0;
          // League component totals for wOBA
          let tAB = 0, tH = 0, t2B = 0, t3B = 0, tHR = 0, tBB = 0, tIBB = 0, tHBP = 0, tSF = 0, tR = 0, tPA = 0;
          for (const sp of hittingSplits) {
            const s = sp.stat;
            const pa = (s.plateAppearances as number) || 0;
            totalPA += pa;
            weightedOPS += pa * parseFloat((s.ops as string) || '0');
            weightedOBP += pa * parseFloat((s.obp as string) || '0');
            weightedSLG += pa * parseFloat((s.slg as string) || '0');
            tAB += (s.atBats as number) || 0;
            tH += (s.hits as number) || 0;
            t2B += (s.doubles as number) || 0;
            t3B += (s.triples as number) || 0;
            tHR += (s.homeRuns as number) || 0;
            tBB += (s.baseOnBalls as number) || 0;
            tIBB += (s.intentionalWalks as number) || 0;
            tHBP += (s.hitByPitch as number) || 0;
            tSF += (s.sacFlies as number) || 0;
            tR += (s.runs as number) || 0;
            tPA += pa;
          }
          if (totalPA > 0) {
            lgOPS = (weightedOPS / totalPA).toFixed(3);
            lgOBP = (weightedOBP / totalPA).toFixed(3);
            lgSLG = (weightedSLG / totalPA).toFixed(3);
          }
          const woba = computeWoba({ ab: tAB, h: tH, doubles: t2B, triples: t3B, hr: tHR, bb: tBB, ibb: tIBB, hbp: tHBP, sf: tSF });
          if (woba !== null) lgWoba = woba;
          if (tPA > 0) lgRunsPerPA = tR / tPA;
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
          lgWoba,
          lgRunsPerPA,
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

// --- Game logs (MLB + MiLB only; NPB/KBO have no equivalent endpoint) ---

interface GameLogSplit {
  date?: string;
  isHome?: boolean;
  team?: { id: number; name: string };
  opponent?: { id: number; name: string };
  sport?: { id: number };
  stat?: Record<string, unknown>;
}

function shortTeamName(name: string): string {
  // "Los Angeles Dodgers" -> "Dodgers"; "Red Sox" -> "Red Sox" (keep two-word nicknames)
  const parts = name.trim().split(' ');
  if (parts.length <= 1) return name;
  const last = parts[parts.length - 1];
  const TWO_WORD = new Set(['Sox', 'Jays']);
  return TWO_WORD.has(last) ? `${parts[parts.length - 2]} ${last}` : last;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return isFinite(n) ? n : undefined;
}

// Recent per-game log for an MLB/MiLB player. `sportId` filters to a level;
// pass undefined to let the API return the player's games across levels.
export async function getGameLog(
  playerId: number,
  isPitcher: boolean,
  sportId?: number,
  season?: number,
  limit = 10
): Promise<GameLogEntry[]> {
  const year = season ?? new Date().getFullYear();
  const group = isPitcher ? 'pitching' : 'hitting';
  const sportParam = sportId ? `&sportId=${sportId}` : '';
  const url = `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=${group}&season=${year}${sportParam}`;

  let splits: GameLogSplit[] = [];
  try {
    const data = await cachedFetch<{ stats?: Array<{ splits?: GameLogSplit[] }> }>(url, 5 * 60_000);
    splits = data?.stats?.[0]?.splits ?? [];
  } catch {
    return [];
  }

  // Splits are chronological; take the most recent `limit`, newest first.
  return splits.slice(-limit).reverse().map((split): GameLogEntry => {
    const s = split.stat ?? {};
    const opponent = split.opponent?.name ? shortTeamName(split.opponent.name) : '—';
    const prefix = split.isHome ? 'vs' : '@';

    const statLine = isPitcher
      ? formatPitchingLine({
          inningsPitched: s.inningsPitched as string | undefined,
          earnedRuns: num(s.earnedRuns),
          pitchingStrikeouts: num(s.strikeOuts),
          walksAllowed: num(s.baseOnBalls),
          hitsAllowed: num(s.hits),
        })
      : formatBattingLine({
          atBats: num(s.atBats),
          hits: num(s.hits),
          homeRuns: num(s.homeRuns),
          doubles: num(s.doubles),
          triples: num(s.triples),
          walks: num(s.baseOnBalls),
          strikeouts: num(s.strikeOuts),
          stolenBases: num(s.stolenBases),
        });

    return {
      date: split.date ?? '',
      opponent: `${prefix} ${opponent}`,
      level: split.sport?.id ? LEVEL_LABELS[split.sport.id] : undefined,
      statLine,
    };
  });
}
