// Single source of truth for the PV/FV value model, shared by the server (which
// bakes a default into the premium payload) and the client (which recomputes
// live as the user changes their league settings). All the league-specific
// levers live here so the two stay in lockstep.

export type ScoringFormat = 'obp' | 'avg' | 'points';

export interface LeagueSettings {
  teams: number;
  keepers: number;               // kept per team
  format: ScoringFormat;
  slots: Record<string, number>; // starting slots for ONE team, by position
}

// Standard starting slots for the baseline (Tom's) league.
export const DEFAULT_SLOTS: Record<string, number> = {
  C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 5, UTIL: 2, P: 9,
};

// The baseline the model was originally tuned against: 20-team, 28-keeper, OBP.
export const DEFAULT_SETTINGS: LeagueSettings = {
  teams: 20, keepers: 28, format: 'obp', slots: { ...DEFAULT_SLOTS },
};

// Raw per-player inputs. The client assembles these from the premium payload
// (numbers) plus the player's fielding position; the server assembles them at
// sheet-parse time (position unknown there, so scarcity is neutral server-side).
export interface ValueInputs {
  isPitcher: boolean;
  position?: string;      // fielding position abbrev, for positional scarcity
  war?: number;           // peak WAR
  peakWrcPlus?: number;
  era20?: number;
  hr?: number;
  sb?: number;
  curWrcPlus?: number;
  curEra20?: number;
  age?: number;
  level?: string;
  marketBaseline?: number; // (auction $ − role's FA line) / DIV, role-correct
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Younger = more keeper years ahead. Past the peak (28), keeper value decays
// steadily and keeps decaying — a 36-yo has little dynasty value even while he's
// still productive now (that's what PRESENT value captures; FV must not flatten).
export function ageMultiplier(age?: number): number {
  if (age === undefined) return 1.0;
  if (age <= 22) return 1.25;
  if (age <= 25) return 1.15;
  if (age <= 28) return 1.0;
  return Math.max(0.18, 1.0 - (age - 28) * 0.08); // 30→.84, 33→.60, 36→.36, 38→.20
}

// Distance from the majors discounts a keeper ceiling.
export function proximityMultiplier(level?: string): number {
  const l = (level ?? '').toUpperCase();
  if (l.includes('MLB') || l.includes('MAJOR')) return 1.0;
  if (l.includes('AAA')) return 0.92;
  if (l.includes('AA')) return 0.82;
  if (l.includes('A+') || l.includes('HIGH')) return 0.72;
  if (l.includes('A')) return 0.62;
  return 0.5;
}

// Present value only fully counts in the majors.
export function presentLevelFactor(level?: string): number {
  const l = (level ?? '').toUpperCase();
  if (l.includes('MLB') || l.includes('MAJOR')) return 1.0;
  if (l.includes('AAA')) return 0.3;
  return 0.1;
}

const totalKeepers = (s: LeagueSettings) => Math.max(1, Math.round(s.teams * s.keepers));

// The keeper bar (peak WAR below which a ceiling is barely keepable) scales with
// how deep the kept pool is. 560 keepers → 2.0 WAR baseline; FEWER keepers → the
// bar RISES (you only hold the top guys), more keepers → it falls. Sqrt dampens
// so the swing is sane across league sizes.
export function keeperBar(s: LeagueSettings): number {
  return clamp(2.0 * Math.sqrt(560 / totalKeepers(s)), 0.8, 5.0);
}

// Present-value replacement level rises with league depth — more teams means
// fewer freely-available bodies, so the bar to clear replacement is higher.
export function replacementWar(s: LeagueSettings): number {
  return clamp(1.0 * (s.teams / 20), 0.4, 2.0);
}

// Fantasy positional scarcity at standard slots: up-the-middle is thin, corners
// and DH are deep. Pitchers are neutral (no entry → 0).
const SCARCITY_PRIOR: Record<string, number> = {
  C: 0.12, SS: 0.06, '2B': 0.05, CF: 0.04, '3B': 0.02,
  OF: 0, LF: -0.02, RF: -0.02, '1B': -0.06, DH: -0.10,
};
// Which starting-slot bucket a fielding position draws from.
function slotBucket(pos: string): string {
  if (['LF', 'CF', 'RF', 'OF'].includes(pos)) return 'OF';
  if (pos === 'SP' || pos === 'RP') return 'P';
  return pos;
}
// A position's scarcity premium grows when a league starts MORE of it than
// standard (2-catcher leagues make catchers scarcer) and shrinks when it starts
// fewer, relative to the default slot count for that bucket.
export function scarcityMult(pos: string | undefined, s: LeagueSettings): number {
  if (!pos) return 1;
  const prior = SCARCITY_PRIOR[pos] ?? 0;
  if (prior === 0) return 1;
  const bucket = slotBucket(pos);
  const std = DEFAULT_SLOTS[bucket] ?? 1;
  const user = s.slots[bucket] ?? std;
  const slotAdj = clamp(user / (std || 1), 0.5, 2.5);
  return clamp(1 + prior * slotAdj, 0.82, 1.24);
}

// Scoring format reweights the model. OBP is the baseline. Points leagues make
// accumulation/playing-time (WAR) king and rate stats matter less. AVG leagues
// devalue the walk-driven slice of wRC+ (approximated — we have no AVG data) and
// lean a touch more on contact/production.
interface FormatWeights { warW: number; mktW: number; prodW: number; wrcFan: number; hrFan: number; sbFan: number; }
const FORMAT: Record<ScoringFormat, FormatWeights> = {
  obp:    { warW: 0.60, mktW: 0.25, prodW: 0.15, wrcFan: 1.00, hrFan: 1.00, sbFan: 1.00 },
  points: { warW: 0.72, mktW: 0.18, prodW: 0.10, wrcFan: 0.90, hrFan: 1.15, sbFan: 0.60 },
  avg:    { warW: 0.58, mktW: 0.25, prodW: 0.17, wrcFan: 0.82, hrFan: 1.05, sbFan: 0.90 },
};

export function computeValue(inp: ValueInputs, s: LeagueSettings): { present: number; future: number } {
  if (inp.war === undefined) return { present: 0, future: 0 };
  const fmt = FORMAT[s.format];
  const scar = scarcityMult(inp.position, s);

  // ---- Future (keeper) value ----
  const bar = keeperBar(s);
  let fantasy = 0;
  if (inp.isPitcher) {
    if (inp.era20 !== undefined) fantasy = Math.max(0, 4.0 - inp.era20);
  } else {
    if (inp.peakWrcPlus !== undefined) fantasy += fmt.wrcFan * Math.max(0, (inp.peakWrcPlus - 100) / 20);
    if (inp.hr !== undefined) fantasy += fmt.hrFan * (inp.hr / 25);
    if (inp.sb !== undefined) fantasy += fmt.sbFan * (inp.sb / 25);
  }
  const warTerm = Math.max(0, inp.war - bar) * 3;
  const fantasyTerm = fantasy * (inp.war > bar ? 1 : 0.15);
  const future = (warTerm + fantasyTerm) * ageMultiplier(inp.age) * proximityMultiplier(inp.level) * scar;

  // ---- Present (win-now) value: WAR-driven ----
  const lvl = presentLevelFactor(inp.level);
  const warPv = Math.max(0, inp.war - replacementWar(s)) * 1.8 * lvl;
  let prod = 0;
  if (inp.isPitcher) {
    const e = inp.curEra20 ?? inp.era20;
    if (e !== undefined) prod = Math.max(0, (4.8 - e) * 1.5);
  } else {
    const w = inp.curWrcPlus ?? inp.peakWrcPlus;
    if (w !== undefined) prod = Math.max(0, (w - 85) / 10);
  }
  const prodPv = prod * lvl;
  const mkt = inp.marketBaseline ?? 0;
  const present = (fmt.warW * warPv + fmt.mktW * mkt + fmt.prodW * prodPv) * scar;

  const r = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
  return { present: r(present), future: r(future) };
}
