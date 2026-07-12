// Sport IDs — MLB Stats API uses 1-16, we use 100+ for international.
// 16 = Rookie/Complex (ACL, FCL, DSL). Note: there is no sportId 15.
export const SPORT_IDS = {
  MLB: 1,
  AAA: 11,
  AA: 12,
  HIGH_A: 13,
  A: 14,
  ROOKIE: 16,
  NPB: 100,
  KBO: 101,
} as const;

export type SportId = (typeof SPORT_IDS)[keyof typeof SPORT_IDS];

export const LEVEL_LABELS: Record<number, string> = {
  1: 'MLB',
  11: 'AAA',
  12: 'AA',
  13: 'High-A',
  14: 'A',
  16: 'Rk',
  100: 'NPB',
  101: 'KBO',
};

export function isMLBSystem(sportId: number): boolean {
  return (sportId >= 1 && sportId <= 14) || sportId === 16;
}

export function isMiLB(sportId: number): boolean {
  return (sportId >= 11 && sportId <= 14) || sportId === 16;
}

// Rolling last-15-day performance, for a "hot/cold" read on each card.
export interface RecentForm {
  gamesPlayed: number;
  line: string;                       // numeric line, e.g. ".312 · 4 HR · .955 OPS" or "2.45 ERA · 18.1 IP"
  trend: 'hot' | 'cold' | 'neutral';  // color accent only; numbers stay primary
  isPitcher: boolean;
}

// Today's matchup context for a hitter: the opposing probable starter and park.
export interface Matchup {
  oppStarterName: string;
  oppStarterHand?: 'L' | 'R';
  oppStarterEra?: number;       // season ERA
  oppStarterCareerEra?: number; // career ERA (bigger sample — drives the quality weight)
  parkFactor?: number;          // runs park factor, 100 = neutral (>100 hitter-friendly)
  platoon?: 'edge' | 'even' | 'disadv'; // batter hand vs pitcher hand
  // Overall matchup tier for the hitter, weighted from pitcher quality + platoon + park.
  ratingTier?: 'strong' | 'plus' | 'neutral' | 'tough';
}

// Premium (ScoutTheStatline) metrics joined from the sheet — premium accounts only.
export interface PremiumMetrics {
  war?: number;         // peak WAR
  peakWrcPlus?: number; // hitters — peak wRC+
  era20?: number;       // pitchers — ERA per 20 TBF/game
}

export interface InjuryStatus {
  code: string; // e.g. "D10", "D60", "ILF"
  label: string; // e.g. "10-Day IL"
  note?: string; // e.g. "Left shoulder surgery recovery"
}

export interface FollowedPlayer {
  id: number;
  fullName: string;
  primaryPosition: string; // "P", "C", "1B", "SS", "OF", etc.
  currentTeam: {
    id: number;
    name: string;
  };
  sportId: number;
  parentOrg?: string;
  parentOrgAbbrev?: string; // e.g. "CWS" for Charlotte Knights
  followedAt: string;
  injury?: InjuryStatus;
  onRehab?: boolean; // IL player currently on a minor-league rehab assignment (MLB status "RA")
  batSide?: 'L' | 'R' | 'S'; // for platoon weighting in the matchup rating
}

// A recent MLB call-up (browsable discovery list; followable like a search hit).
export interface CallUp extends SearchResult {
  calledUpDate: string;
  isPitcher: boolean;
  war?: number;         // peak WAR — drives the sort always; number shown to premium only
  peakWrcPlus?: number; // hitters — peak wRC+ (premium only; stripped for non-premium)
  era20?: number;       // pitchers — ERA/20 TBF (premium only; stripped for non-premium)
  fromLevel?: string;   // level promoted from, e.g. "AAA"
  priorLine?: string;   // season line at the prior level (the production that earned it)
  last30Line?: string;  // rolling last-30 figure at the prior level
}

export interface SearchResult {
  id: number;
  fullName: string;
  primaryPosition: string;
  currentTeam: {
    id: number;
    name: string;
  };
  sportId: number;
  level: string;
  parentOrg?: string;
  parentOrgAbbrev?: string;
}

export interface DailyPlayerStats {
  playerId: number;
  playerName: string;
  team: string;
  teamId?: number; // current team id (for the team-aware game log)
  level: string;
  sportId: number;
  position: string;
  parentOrg?: string;
  parentOrgAbbrev?: string;
  gameStatus: 'Scheduled' | 'Live' | 'Final' | 'No Game' | 'Postponed';
  gameContext: string;
  gameTime?: string;
  gameStartTime?: number; // epoch ms for sorting
  gamePk?: number;
  lineupStatus?: 'starting' | 'not_starting' | 'probable_pitcher';
  startingPosition?: string; // e.g. "SS", "3B", "DH"
  battingOrder?: number; // 1-9
  injury?: InjuryStatus;
  onRehab?: boolean; // IL player currently on a minor-league rehab assignment (MLB status "RA")
  recentForm?: RecentForm;   // rolling last-15-day line
  matchup?: Matchup;         // today's opposing starter + park (hitters only)
  twoStartDates?: string[];  // ISO dates of this SP's 2+ starts in the current fantasy week
  calledUpDate?: string;     // ISO date of a recent recall/selection to MLB (recently called up)
  promotedDate?: string;     // ISO date of a recent MiLB level-up (recently promoted)
  nextStart?: { date: string; opponent: string }; // pitcher's next announced start (MLB + MiLB)
  // Batting (no RBI/R per user request)
  hits?: number;
  atBats?: number;
  homeRuns?: number;
  walks?: number;
  strikeouts?: number;
  stolenBases?: number;
  doubles?: number;
  triples?: number;
  hitByPitch?: number;
  // Pitching
  inningsPitched?: string;
  earnedRuns?: number;
  pitchingStrikeouts?: number;
  walksAllowed?: number;
  hitsAllowed?: number;
  saves?: number;
  wins?: number;
  losses?: number;
  // Derived
  statLine: string;
  isPitcherLine: boolean;
  performanceGrade: Grade;
  gradeReason: string;
}

// One line of a player's season at a single level (for the multi-level breakdown).
export interface SeasonLevelLine {
  level: string;
  sportId: number;
  gamesPlayed: number;
  plateAppearances?: number;
  isPitcher: boolean;
  // Batting
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  woba?: string;
  wrcPlus?: number;     // real (MLB only, from API)
  wrcPlusEst?: number;  // estimated (MiLB; no park factor)
  homeRuns?: number;
  // Pitching
  era?: string;
  whip?: string;
  inningsPitched?: string;
}

export interface SeasonPlayerStats {
  playerId: number;
  playerName: string;
  team: string;
  level: string;
  sportId: number;
  position: string;
  parentOrg?: string;
  parentOrgAbbrev?: string;
  gamesPlayed: number;
  // Per-level breakdown when the player has appeared at >1 level this season.
  // The headline fields below reflect the CURRENT level only (never blended).
  levelLines?: SeasonLevelLine[];
  // Batting
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  woba?: string;
  wrcPlus?: number;     // real (MLB only, from API)
  wrcPlusEst?: number;  // estimated (MiLB; no park factor)
  opsPlus?: number;     // legacy fallback (NPB/KBO)
  homeRuns?: number;
  stolenBases?: number;
  walks?: number;
  strikeouts?: number;
  doubles?: number;
  triples?: number;
  plateAppearances?: number;
  // Pitching
  era?: string;
  whip?: string;
  inningsPitched?: string;
  pitchingStrikeouts?: number;
  walksAllowed?: number;
  wins?: number;
  losses?: number;
  saves?: number;
  kPer9?: string;
  bbPer9?: string;
  isPitcher: boolean;
  injury?: InjuryStatus;
}

export type Grade = 'milestone' | 'standout' | 'good' | 'routine' | 'off_day' | 'scheduled' | 'no_game';

export interface GradeConfig {
  label: string;
  emoji: string;
  color: string;
  bgColor: string;
}

export const GRADE_MAP: Record<Grade, GradeConfig> = {
  milestone: { label: 'Milestone', emoji: '💎', color: '#a855f7', bgColor: 'rgba(168,85,247,0.15)' },
  standout: { label: 'Standout', emoji: '🔥', color: '#ef4444', bgColor: 'rgba(239,68,68,0.15)' },
  good: { label: 'Good', emoji: '✅', color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)' },
  routine: { label: 'Routine', emoji: '😐', color: '#6b7280', bgColor: 'rgba(107,114,128,0.15)' },
  off_day: { label: 'Off Day', emoji: '🚩', color: '#eab308', bgColor: 'rgba(234,179,8,0.15)' },
  scheduled: { label: 'Scheduled', emoji: '🕒', color: '#3b82f6', bgColor: 'rgba(59,130,246,0.15)' },
  no_game: { label: 'No Game', emoji: '—', color: '#4b5563', bgColor: 'rgba(75,85,99,0.15)' },
};

export interface LeagueAverages {
  sportId: number;
  level: string;
  avgAge: number;
  lgOPS: string;
  lgERA: string;
  lgOBP: string;
  lgSLG: string;
  lgWoba?: number;        // league wOBA, for wRC+ estimation
  lgRunsPerPA?: number;   // league R/PA, for wRC+ estimation
}

export interface Group {
  id: string;
  name: string;
  sortOrder: number;
}

export interface GameLogEntry {
  date: string;      // YYYY-MM-DD
  opponent: string;  // e.g. "vs Dodgers" / "@ Giants"
  level?: string;    // sport-level label (shows level changes during rehab/promotions)
  statLine: string;  // formatted batting or pitching line ("DNP" when not in the lineup)
  gamePk?: number;   // for merging the player's log against the team's schedule
  dnp?: boolean;     // player's team played but they didn't appear
  position?: string; // position(s) played that game, e.g. "C", "DH", "1B/DH" (hitters)
}

// Special sentinel for the implicit "All Players" view (not a stored group).
export const ALL_PLAYERS_GROUP = 'all';

// Special sentinels for the pre-built discovery lists (not groups).
export const CALLUPS_VIEW = 'callups';
export const PROMOTIONS_VIEW = 'promotions';
export const RISERS_VIEW = 'risers';
export const PROJECTIONS_VIEW = 'projections';

// OOPSY weekly projections (premium). Read from a separate published sheet.
export interface OopsyPitcher {
  nameKey: string;
  player: string;
  day: string;      // Fri / Sat / Sun (start day this week)
  era: number;      // projected ERA for the start
  opponent: string;
  park: string;
  team: string;
  rank: number;     // 1 = best projected start this week
}
export interface OopsyHitter {
  nameKey: string;
  player: string;
  projGames?: number;
  projPA?: number;
  wrcPlus?: number;   // "1 is average" scale (not the 100 scale)
  fantasyZ?: number;  // fantasy value z-score (0 is average)
  rank: number;       // 1 = top weekly hitter
}

// A prospect riser (premium only) — peak WAR climbed >= 1.5 over the window.
export interface Riser {
  name_key: string;
  display_name: string;
  is_pitcher: boolean;
  level: string | null;
  war: number;
  delta: number;
}

export type ViewTab = 'today' | 'yesterday' | 'last15' | 'last30' | 'season';

export type LevelFilter = 'all' | 'MLB' | 'MiLB' | 'NPB' | 'KBO';

// Rolling-window "range" query (last N days) for any player set — including
// MiLB, which is the piece the big sites don't expose well.
export type RangeWindow = 15 | 30 | 60;

export type RangeSortKey = 'wrcPlus' | 'ops' | 'homeRuns' | 'stolenBases' | 'plateAppearances' | 'era' | 'strikeOuts' | 'inningsPitched' | 'saves';

export interface RangePlayerStats {
  playerId: number;
  playerName: string;
  team: string;
  level: string;
  sportId: number;
  position: string;
  parentOrgAbbrev?: string;
  isPitcher: boolean;
  gamesPlayed: number;
  // Hitter
  plateAppearances?: number;
  atBats?: number;
  homeRuns?: number;
  stolenBases?: number;
  avg?: string;
  ops?: string;
  wrcPlus?: number; // estimate over the window
  // Pitcher
  inningsPitched?: string;
  era?: string;
  whip?: string;
  strikeOuts?: number;
  saves?: number;
  wins?: number;
}
