// Sport IDs — MLB Stats API uses 1-14, we use 100+ for international
export const SPORT_IDS = {
  MLB: 1,
  AAA: 11,
  AA: 12,
  HIGH_A: 13,
  A: 14,
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
  100: 'NPB',
  101: 'KBO',
};

export function isMLBSystem(sportId: number): boolean {
  return sportId >= 1 && sportId <= 14;
}

export function isMiLB(sportId: number): boolean {
  return sportId >= 11 && sportId <= 14;
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
  // Batting
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  wrcPlus?: number;
  opsPlus?: number;
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
}

export type ViewTab = 'today' | 'yesterday' | 'season';

export type LevelFilter = 'all' | 'MLB' | 'MiLB' | 'NPB' | 'KBO';
