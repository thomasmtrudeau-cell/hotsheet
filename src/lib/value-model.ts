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

// Standard starting slots for the baseline (Tom's) league. CI = corner infield
// (1B/3B), MI = middle infield (2B/SS) — flex spots that add demand to those
// positions. P can be split SP/RP in other leagues.
export const DEFAULT_SLOTS: Record<string, number> = {
  C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, CI: 1, MI: 1, OF: 4, UTIL: 2, P: 9,
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
  catcherFlex?: boolean;   // catcher who also plays 1B/DH (bat can carry off the dish)
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Keeper value is a DISCOUNTED SUM over the next several seasons, weighting NEXT
// year far more than distant ones (2027 >> 2030). Each future season is scaled
// by a gentle aging curve. Because the near years dominate the sum, an aging
// star who still projects well next year keeps real keeper value instead of
// being zeroed out — while youth compounds across many productive seasons. The
// aging curve is deliberately gentle: WAR already separates elite-aging from
// washed, since a low-WAR vet has little annual value to carry forward anyway.
const YEAR_DISCOUNT = 0.72;   // each year out is worth 72% of the prior year
const KEEPER_HORIZON = 7;     // seasons of keeper value considered
function ageRetention(a: number): number {
  return Math.max(0, Math.min(1.0, 1.05 - Math.max(0, a - 30) * 0.06)); // flat ≤30, then −6%/yr
}
const KEEPER_NORM = 2.76;     // normalize so a prime-age (26) player lands ≈ 1.15
export function keeperAgeFactor(age?: number): number {
  if (age === undefined) return 1.0;
  let sum = 0;
  for (let k = 1; k <= KEEPER_HORIZON; k++) {
    sum += Math.pow(YEAR_DISCOUNT, k - 1) * ageRetention(age + k);
  }
  return sum / KEEPER_NORM;
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

// Time-to-peak discount for FUTURE value. A player's productive peak window is
// ~26-29; value that arrives years from now is deferred and carries bust /
// attrition / years-of-minors risk, so a far-from-peak prospect shouldn't rival
// a proven peak-age star just for being young (a 20-yo AAA bat is 5-6 years out).
// Only bites BELOW the peak window; older players decay via keeperAgeFactor. Note
// this is distinct from proximity (distance to the MAJORS) — a 20-yo can be in
// AAA yet still years from his peak.
export function maturityFactor(age?: number): number {
  if (age === undefined) return 1.0;
  return Math.max(0.45, Math.min(1.0, 1 - Math.max(0, 25 - age) * 0.07)); // 24→.93, 22→.79, 20→.65, 18→.51
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
// League-wide demand for a position, including flex slots that can hold it: CI
// feeds 1B/3B, MI feeds 2B/SS. (UTIL is left general — it doesn't concentrate on
// any one position.)
function positionDemand(pos: string, slots: Record<string, number>): number {
  const own = slots[slotBucket(pos)] ?? 0;
  if (pos === '1B' || pos === '3B') return own + (slots.CI ?? 0);
  if (pos === '2B' || pos === 'SS') return own + (slots.MI ?? 0);
  return own;
}
// A position's scarcity premium grows when a league starts MORE of it than
// standard (2-catcher leagues make catchers scarcer; extra CI/MI deepen corner/
// middle demand) and shrinks when it starts fewer.
export function scarcityMult(pos: string | undefined, s: LeagueSettings): number {
  if (!pos) return 1;
  const prior = SCARCITY_PRIOR[pos] ?? 0;
  if (prior === 0) return 1;
  const std = positionDemand(pos, DEFAULT_SLOTS) || 1;
  const user = positionDemand(pos, s.slots);
  const slotAdj = clamp(user / std, 0.5, 2.5);
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

// WAR isn't fantasy value. Catcher WAR is inflated by framing/defense that
// doesn't score, so it's haircut (less so for a flex catcher who can play 1B/DH,
// since his bat carries off the dish). 1B/DH WAR is deflated by the positional
// penalty even though their bat is the whole fantasy point, so we add it back —
// a good-hitting low-WAR 1B (Schwarber-type) then clears the keeper bar on the
// bat. Middle-infield/OF WAR translates roughly as-is (scarcity handles those).
function fantasyWar(war: number, position?: string, catcherFlex?: boolean): number {
  const p = position ?? '';
  if (p === 'C') return war * (catcherFlex ? 0.92 : 0.80);
  if (p === '1B' || p === 'DH') return war + 0.6;
  return war;
}

export function computeValue(inp: ValueInputs, s: LeagueSettings): { present: number; future: number } {
  if (inp.war === undefined) return { present: 0, future: 0 };
  const fmt = FORMAT[s.format];
  const scar = scarcityMult(inp.position, s);
  const fWar = inp.isPitcher ? inp.war : fantasyWar(inp.war, inp.position, inp.catcherFlex);

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
  const warTerm = Math.max(0, fWar - bar) * 3;
  const fantasyTerm = fantasy * (fWar > bar ? 1 : 0.15);
  const future = (warTerm + fantasyTerm) * keeperAgeFactor(inp.age) * maturityFactor(inp.age) * proximityMultiplier(inp.level) * scar;

  // ---- Present (win-now) BASE: WAR + market, park- and playing-time-NEUTRAL.
  // The dynamic layer (current-rate × ACTUAL playing time × park) is applied
  // downstream in the Trade Checker, where real game-log usage + park live — see
  // its dynamic-present track. Format's prod weight is folded into that layer.
  const lvl = presentLevelFactor(inp.level);
  const warPv = Math.max(0, fWar - replacementWar(s)) * 1.8 * lvl;
  const mkt = inp.marketBaseline ?? 0;
  // Positional scarcity weighs mostly on KEEPER value (a scarce SS is hard to
  // replace on your roster); win-now production is closer to position-agnostic
  // (a run's a run today), so present value only feels scarcity at half strength.
  const scarPresent = 1 + (scar - 1) * 0.5;
  const present = (fmt.warW * warPv + fmt.mktW * mkt) * scarPresent;

  const r = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
  return { present: r(present), future: r(future) };
}
