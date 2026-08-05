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
  rebuilder?: boolean;           // rebuilder mode — ignore the time-to-peak discount
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
  catcherFlex?: boolean;   // catcher who also plays 1B/DH (bat can carry off the dish) — coarse fallback when catcherShare is unknown
  catcherShare?: number;   // 0–1 fraction of his played games actually spent BEHIND THE PLATE (from the game log); scales the catcher haircuts
  defRuns?: number;      // hitters — raw sheet DEF runs (strip from WAR for fantasy)
  ipg?: number;          // pitchers — sheet IP/G (< 2.01 = reliever role)
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
// Pitchers age more gracefully than hitters for keeper purposes — a good 31-yo arm
// is usually still good at 32 — so their retention plateaus a year longer and
// declines at −5%/yr instead of −6%. Hitters: flat ≤30, then −6%/yr.
function ageRetention(a: number, isPitcher = false): number {
  const onset = isPitcher ? 31 : 30;
  const slope = isPitcher ? 0.05 : 0.06;
  return Math.max(0, Math.min(1.0, 1.05 - Math.max(0, a - onset) * slope));
}
const KEEPER_NORM = 2.76;     // normalize so a prime-age (26) player lands ≈ 1.15

// Per-season keeper aggregation — the engine behind "below-replacement seasons
// aren't material" (Tom, 2026-08-05). The old shape decayed the NET surplus
// (value above the bar) by keeperAgeFactor, which silently pays out seasons
// where the decayed GROSS ability has fallen below the bar — a 33-yo 2.8-WAR
// bat's age-36 season is gross 1.9 vs a 2.0 bar and should be worth ZERO, but
// surplus-decay credited 0.8 × 0.69 = 0.55 for it. This instead decays the
// gross along the aging curve and lets the caller re-derive each season's
// value (netting against the bar yearly, floored at 0) before the discounted
// sum. seasonVal(ret) maps one season's retention to its value; prime seasons
// (retention 1) reproduce the legacy math exactly, so young/prime players are
// untouched — only decline-phase seasons get cut.
function keeperSeasons(age: number | undefined, isPitcher: boolean, seasonVal: (ret: number) => number, surv?: number[]): number {
  if (age === undefined) return seasonVal(1); // legacy: unknown age aggregates at ×1.0
  let sum = 0;
  for (let k = 1; k <= KEEPER_HORIZON; k++) {
    sum += Math.pow(YEAR_DISCOUNT, k - 1) * seasonVal(ageRetention(age + k, isPitcher)) * (surv?.[k - 1] ?? 1);
  }
  return sum / KEEPER_NORM;
}

// QUALITY-CONDITIONED career survival (Tom, 2026-08-05): expected value must
// include the odds the player even HAS each future season, and that can't be a
// blanket age curve — "98% of 36-year-olds won't have an age-39 season", but
// the HOF-track ones (Freeman/Judge/Trout tier) do, and "outlier" shouldn't be
// a list of names. The projection already tells us who the outliers are: per-
// year hazard of the career ending rises with age and falls with the MARGIN of
// the decayed keeper WAR over the position's bar (teams keep finding jobs for
// stars; a vet projected at/below the bar is a release away from done). The
// aging curve says what the seasons look like IF they happen; this is the
// probability they happen — multiplying them is expected value, not a double
// count. Calibration anchors: a 36-yo star (margin +0.7 next year) holds P≈0.9
// / 0.7 / 0.45 for ages 37/38/39; a 36-yo ordinary keeper (margin ≈ −0.8) gets
// P≈0.6 / 0.3 / 0.11 — and his age-39 value season is already netted to zero,
// so effectively none of it counts. Young players with positive margins ride
// the 0.01 floor (≈7% total trim across the full horizon — real flameout risk,
// negligible reshuffling).
function survivalCurve(age: number | undefined, isPitcher: boolean, fWarKeeper: number, bar: number): number[] | undefined {
  if (age === undefined) return undefined;
  const out: number[] = [];
  let s = 1;
  for (let k = 1; k <= KEEPER_HORIZON; k++) {
    const a = age + k;
    const margin = fWarKeeper * ageRetention(a, isPitcher) - bar;
    s *= 1 - clamp(0.075 * (a - 34) - 0.21 * margin, 0.01, 0.85);
    out.push(s);
  }
  return out;
}

// One future season's ability shape relative to peak: the maturation ramp below
// prime × the aging decline past it (survival multiplies separately).
function futureSeasonShape(a: number, isPitcher: boolean): number {
  return ageRetention(a, isPitcher) * presentMaturity(a);
}

export function keeperAgeFactor(age?: number, isPitcher = false): number {
  if (age === undefined) return 1.0;
  let sum = 0;
  for (let k = 1; k <= KEEPER_HORIZON; k++) {
    sum += Math.pow(YEAR_DISCOUNT, k - 1) * ageRetention(age + k, isPitcher);
  }
  return sum / KEEPER_NORM;
}

// The keeper ceiling's premium over the bar (peak WAR ×3) is a GROWTH/upside reward
// — it assumes the player will still reach/exceed this peak. A player past peak has
// no growth ahead, so the premium fades with age: pitchers hold it latest (onset
// 32), bat-only corners (1B/DH) erode earliest (onset 28), everyone else at 30.
// This is what drops a declining vet's FV below his PV.
export function growthPremium(age?: number, isPitcher = false, position?: string): number {
  if (age === undefined) return 3;
  const corner = position === '1B' || position === 'DH';
  const onset = isPitcher ? 32 : corner ? 28 : 30;
  const slope = corner ? 0.2 : 0.15;
  return Math.max(1.5, 3 - Math.max(0, age - onset) * slope);
}

// ATHLETICISM decays before the bat does. Delta-method aging curves put the SB
// peak at 25-26 with decline starting immediately — 20+ SB burners lose ~7
// steals off peak by age 30 and ~16 by 38 — while ageRetention is flat until
// 30. This fills that 27-30 gap, shaded slightly steep because FV is forward-
// looking (a 30-yo's keeper SB credit should read his age-31/32 rate). Stacks
// with keeperAgeFactor's post-30 decline to give speed its steep tail; HR is
// untouched (power holds through the late 20s). SHARED by the two athleticism-
// driven keeper inputs: the SB share of counting value, and the defense share
// retained in keeper WAR (range erodes like speed — same physical skill).
export function sbAgeFactor(age?: number): number {
  if (age === undefined) return 1;
  return clamp(1 - Math.max(0, age - 26) * 0.05, 0.5, 1);
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

// The keeper-ceiling deferral discount: a prospect is years from his peak
// (maturityFactor) AND far from the majors (proximityMultiplier). Both key on
// LEVEL, so multiplying them double-counts the same "young and far" risk and
// crushes elite young prospects below replacement (a 2.79-WAR 19-yo SS in A-ball
// is a prized dynasty keeper, not a scrub). Combine them additively so each risk
// contributes ~60% of its discount. MLB players are unaffected (both factors = 1).
export function keeperDeferral(age?: number, level?: string, isPitcher?: boolean, rebuilder?: boolean): number {
  const mat = maturityFactor(age, level, isPitcher, rebuilder);
  const prox = proximityMultiplier(level);
  return Math.max(0.3, 1 - (1 - mat) * 0.6 - (1 - prox) * 0.6);
}

// Time-to-peak discount for FUTURE value. A player's productive peak window is
// ~26-29; value years out is deferred and carries bust / attrition / years-of-
// minors risk. But once a guy reaches the MAJORS his value has ARRIVED — he's
// "what he is" — so the discount is ZERO in the bigs and scales up the lower the
// level (a 20-yo in AAA is advanced but still years from peak). Pitchers stabilize
// sooner, so they take half the discount. Rebuilder mode turns it off entirely
// (you want the young upside, wait be damned). Distinct from proximity (distance
// to the MAJORS) — a 20-yo can be in AAA yet still years from his PEAK.
function deferralByLevel(level?: string): number {
  const l = (level ?? '').toUpperCase();
  if (l.includes('MLB') || l.includes('MAJOR')) return 0;   // arrived — no time discount
  if (l.includes('AAA')) return 0.75;
  if (l.includes('AA')) return 0.9;
  return 1.0; // A+ / A / Rk — fully deferred
}
export function maturityFactor(age?: number, level?: string, isPitcher?: boolean, rebuilder?: boolean): number {
  if (rebuilder || age === undefined) return 1.0;
  let discount = Math.max(0, 25 - age) * 0.07;   // raw time-to-peak (24→.07, 20→.35)
  if (isPitcher) discount *= 0.5;                 // pitchers are "what they are" sooner
  discount *= deferralByLevel(level);             // zero in the majors, full in the low minors
  return Math.max(0.45, 1 - discount);
}

// How much of a player's PEAK ability he's producing NOW, by age — the peak WAR
// is his age-26/27 ceiling, so a pre-peak guy's current (win-now) value is below
// it. Gentle: near-peak by 25-26, tapering for the young (21 → ~.70). Used only
// for present value; keeper value banks the full ceiling.
export function presentMaturity(age?: number): number {
  if (age === undefined) return 1;
  return Math.max(0.5, Math.min(1, 1 - Math.max(0, 26 - age) * 0.06)); // 25→.94, 24→.88, 22→.76, 21→.70
}

// Attrition: expected value must include the chance a player is still PLAYING at
// a given age — stars don't glide to 45, careers end. Annual hazard of falling off
// (retirement, release, chronic injury) rises through the 30s, steeper for
// pitchers. survivalTo(a) = P(still producing at age a), anchored at 30; it's only
// ever used as a ratio between two ages, so the anchor cancels. This is what stops
// a 38-yo ace from projecting value at 44 (≈1% chance he's still pitching).
function hazard(a: number, isPitcher: boolean): number {
  const base = isPitcher ? 0.05 : 0.03;
  const slope = isPitcher ? 0.045 : 0.035;
  return Math.min(0.6, Math.max(0, base + slope * (a - 31)));
}
function survivalTo(a: number, isPitcher = false): number {
  let s = 1;
  for (let x = 31; x <= a; x++) s *= 1 - hazard(x, isPitcher);
  return s;
}

// Fraction of PEAK expected value at a given age — the maturation ramp (below
// prime) × the aging decline (past prime) × survival (the odds the career is still
// going). Peaks ≈1.0 across 26–30. Used to project a player's per-season value
// across a multi-year keeper horizon for the timeline chart: a young guy's line
// rises toward peak, an old guy's fades and then falls off the career cliff.
export function abilityCurve(age?: number, isPitcher = false): number {
  if (age === undefined) return 1;
  return presentMaturity(age) * Math.min(1, ageRetention(age, isPitcher)) * survivalTo(Math.round(age), isPitcher);
}

// ---- WAR as PLAYING-TIME CONFIDENCE (not fantasy value) ----
// Empirically, playing time is the #1 driver of fantasy value (corr(auction$, PA)
// ≈ 0.95) and WAR is the WEAKEST of the big three (≈0.72, below wRC+'s 0.75). So
// WAR's job in this model is NOT to be the value — it's to tell us how confident
// we are the reps will show up NOW and PERSIST over the keeper horizon. Net effect
// by design: a high WAR nudges PV a little and lifts FV a lot.

// PRESENT PT fragility — a DOCK for low WAR, never a boost (caps at 1.0). A
// low-WAR regular is a slump/bench/call-up from losing the job, so his win-now
// reps carry risk even when he's playing today. Reaching 1.0 means "no fringe
// dock" — NOT "guaranteed everyday"; a high-WAR guy who's actually part-time is
// docked by the observed-role layer (roles/platoon/ptCredit), not here, and WAR
// never manufactures playing time he isn't getting. Docks from ~0.7 at 1.0 WAR up
// to no-dock at 2.5 (nobody's a lock below that — plenty of 2-WAR guys sit or are
// in the minors). Up-the-middle (C/SS/2B/CF) is gentler (scarce + the glove holds
// the job); corners (1B/DH) are steeper — a bat-only guy is the first benched (his
// wRC+ is checked separately by the caller, where for corners it "rules").
export function ptFragility(war: number, position?: string): number {
  const p = position ?? '';
  const premium = p === 'C' || p === 'SS' || p === '2B' || p === 'CF';
  const corner = p === '1B' || p === 'DH';
  const hi = 2.5;                                   // no fringe dock at 2.5+ WAR (still not a PT guarantee)
  const lo = corner ? 1.5 : 1.0;                    // corners need more WAR before the dock eases
  const floor = premium ? 0.82 : corner ? 0.62 : 0.7;  // premium gentler, corners harshest
  const t = clamp((war - lo) / (hi - lo), 0, 1);
  return floor + (1 - floor) * t;
}

// EARNING reps (the flip side of fragility, a small PV nudge). A prime-age
// (24–29) player with a good peak WAR but limited CURRENT reps is talent waiting
// to play — most guys who look like that in their prime end up playing every day,
// so give a little of the reps dock back rather than treating today's part-time
// role as his ceiling (Gabriel Arias 2.65 WAR, Anthony Volpe 3.5 WAR — the classic
// buy-lows). Kicks in at peak WAR ≥ 2.5 with a base nudge that grows with talent;
// deliberately small (a nudge, not a rerating): ~+3% for a 2.5-WAR part-timer up to
// ~+12% for a benched 5-WAR stud. Returns a PV multiplier ≥ 1. (The bigger buy-low
// signal lives in FV via warDurability — this is just the present sweetener.)
export function earningPtBump(war: number, age?: number, ptRate?: number): number {
  if (age === undefined || ptRate === undefined) return 1;
  if (age < 24 || age > 29) return 1;               // prime-age window only
  if (ptRate >= 0.8 || war < 2.5) return 1;         // already playing, or not enough talent to expect it
  const talent = clamp((war - 2.5) / 2.5, 0, 1);    // 2.5 WAR → base only … 5+ WAR → full
  const shortfall = clamp((0.8 - ptRate) / 0.5, 0, 1);
  return 1 + (0.06 + 0.14 * talent) * shortfall;    // base 6% at 2.5 WAR → up to 20% at 5 WAR, scaled by the reps gap
}

// LONG-TERM PT durability (the dominant use of WAR, weighs on FV). A good WAR
// means the everyday reps keep coming for years — keeper value you can bank; a
// poor WAR means the future role is a question mark (a bat-only or fringe guy is
// a demotion/platoon away from zero keeper value). This is the "FV a lot" half of
// the design. Centered on the ~2.0-WAR everyday pivot so it TILTS the keeper grade
// by durability rather than inflating the whole board: ~1.0 at 2 WAR, up to ~1.18
// for stars, down to ~0.6–0.68 for a replacement-level regular. Up-the-middle is
// a touch more durable (scarcity keeps them employed); corners harsher (bat-only,
// replaceable). Uses raw WAR on purpose — a high framing/glove WAR genuinely means
// durable playing time (teams keep good defenders), which is what durability is.
export function warDurability(war: number, position?: string): number {
  const p = position ?? '';
  const premium = p === 'C' || p === 'SS' || p === '2B' || p === 'CF';
  const corner = p === '1B' || p === 'DH';
  const up = premium ? 0.09 : corner ? 0.06 : 0.075;   // reward for WAR above the pivot
  const dn = premium ? 0.11 : corner ? 0.17 : 0.14;    // risk for WAR below it (corners harshest)
  const d = war - 2.0;
  const f = 1 + (d >= 0 ? up * d : dn * d);
  return clamp(f, corner ? 0.6 : premium ? 0.72 : 0.68, 1.18);
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

// The bar depends on the POSITION PROFILE (Tom, 2026-08-05): one 2.0 line
// doesn't match who actually gets kept in a 560-keeper pool.
//  - Hitters outside 1B/DH carry defensive/positional WAR that doesn't score in
//    fantasy — you'd almost never see one kept at 2.0 raw WAR; their real line
//    is ≈ 2.4 (a 2.2-WAR glove-first SS with an 88 wRC+ is not a keeper).
//  - 1B/DH keep the base bar, judged on their STRIPPED keeper WAR (negative
//    positional adjustment removed) — the "$15 Jake Burger at 1.5 WAR" case: a
//    mashing corner is kept on the bat. His margin for error is thin by
//    construction — the per-season netting cuts him off quickly once the
//    decayed bat crosses the bar.
//  - Pitchers ≈ 1.6: a 2-WAR SP is a routinely-kept mid-rotation starter (9 P
//    slots × 20 teams), and pitcher WAR runs compressed vs hitters'.
export function keeperBarFor(s: LeagueSettings, isPitcher: boolean, position?: string): number {
  const base = keeperBar(s);
  if (isPitcher) return base * 0.8;
  return position === '1B' || position === 'DH' ? base : base * 1.2;
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
// PRESENT-value weights. Empirically the auction MARKET (production × playing time
// × scarcity) predicts fantasy value far better than WAR — corr(auction$, PA)≈0.95
// vs corr(auction$, WAR)≈0.72 — and WAR's extra over the market is largely defense/
// position that doesn't score. So present value leans on the market with WAR only a
// light tilt (two identical-production bats should read close regardless of their
// glove). Points leagues reward accumulation, so WAR gets a bit more there. When a
// player has NO market signal (missing from the auction export) we fall back to
// WAR-led present so he isn't zeroed — see computeValue.
interface FormatWeights { warW: number; mktW: number; prodW: number; wrcFan: number; hrFan: number; sbFan: number; }
// Category-league counting weights favor SB over HR ~1.5:1 for two stacked
// reasons: (1) scarcity — league-wide HR outnumber SB and the SB pool is more
// concentrated, so a marginal SB moves category standings more (z-score studies
// put 1 SB ≈ 1.3–1.7 HR even after the 2023 rules fattened the SB pool); and
// (2) orthogonality — HR is already partly credited through the wRC+ term (a
// 30-HR bat IS a high-wRC+ bat), while steals contribute nothing to wRC+, so an
// equal HR weight double-counts power. Rebalanced within a constant hrFan+sbFan
// sum so a 20/20 bat grades exactly as before — only the SHAPE moves. Points
// formats are untouched: points scoring rewards HR directly and has no category
// scarcity. Age interaction: sbFan × sbAgeFactor means an old burner's effective
// SB weight falls below hrFan by ~33 (speed melts; power holds).
const FORMAT: Record<ScoringFormat, FormatWeights> = {
  obp:    { warW: 0.18, mktW: 0.62, prodW: 0.20, wrcFan: 1.00, hrFan: 0.80, sbFan: 1.20 },
  points: { warW: 0.34, mktW: 0.46, prodW: 0.20, wrcFan: 0.90, hrFan: 1.15, sbFan: 0.60 },
  avg:    { warW: 0.18, mktW: 0.60, prodW: 0.22, wrcFan: 0.82, hrFan: 0.78, sbFan: 1.17 },
};

// How much of the catcher haircut a "C" actually deserves, 0 (none) → 1 (full).
// The haircuts exist because time BEHIND THE PLATE suppresses PA volume (rest
// days, day-after-night) and inflates WAR with framing that doesn't score — both
// scale with how often he actually squats, not with the roster label. So when we
// can see his real position mix (game log), the penalty follows it: ≤40% of games
// at C reads like any other bat (a C-eligible LF/DH — the label is upside, not a
// tax), ≥80% is a true full-timer, linear in between. Without a share we fall
// back to the coarse catcherFlex flag (half severity), else full. C-eligibility
// UPSIDE (scarcity premium, gentler fragility/durability) is untouched — it keys
// off eligibility, which any C games preserve.
export function catcherSeverity(position?: string, catcherShare?: number, catcherFlex?: boolean): number {
  if ((position ?? '') !== 'C') return 0;
  if (catcherShare !== undefined) return clamp((catcherShare - 0.4) / 0.4, 0, 1);
  return catcherFlex ? 0.5 : 1;
}

// WAR isn't fantasy value. Catcher WAR is inflated by framing/defense that
// doesn't score, so it's haircut — scaled by cSev (catcherSeverity), how much of
// his time is really spent catching. 1B/DH WAR is deflated by the positional
// penalty even though their bat is the whole fantasy point, so we add it back —
// a good-hitting low-WAR 1B (Schwarber-type) then clears the keeper bar on the
// bat. Middle-infield/OF WAR translates roughly as-is (scarcity handles those).
function fantasyWar(war: number, position?: string, cSev = 1, defRuns?: number, defKeep = 0.3): number {
  const p = position ?? '';
  // Defense in fantasy (when the sheet's raw DEF is available): it produces no
  // stats, but it IS insurance — a plus glove holds the everyday job and extends
  // the career; a minus glove is a slump from a platoon. So DEF (runs, incl.
  // positional adj, at 9.774 runs/win) is only PARTIALLY stripped — `defKeep` is
  // the insurance share retained (present ~0.30 = playing-time safety; keeper
  // ~0.40 = longevity/role retention). Symmetric by construction: framing-rich
  // catchers deflate but not to zero, bad-glove mashers inflate but their PT
  // risk tempers it. Replaces the old C/1B/DH special cases; positional scarcity
  // stays with the roster-slot model. Catchers keep a small extra haircut for
  // the games-played reality of the position.
  if (defRuns !== undefined) {
    const offWar = war - (defRuns / 9.774) * (1 - defKeep);
    // Full-time catchers take ~15% fewer PA than other regulars (rest days,
    // day-after-night) — their per-600 rates overstate real seasonal volume.
    // A part-time C (splits time at LF/DH/1B) loses proportionally less.
    return p === 'C' ? offWar * (1 - 0.15 * cSev) : offWar;
  }
  // Legacy fallbacks when DEF isn't known (e.g. older cached payloads).
  if (p === 'C') return war * (1 - 0.20 * cSev);
  if (p === 'DH') return war + 1.2;
  if (p === '1B') return war + 1.0;
  return war;
}

// Pure park-neutral fantasy PRODUCTION rate — the bat/arm alone, weighted by the
// league format. No playing time, market, WAR, or age: the "if he plays, what
// does he produce" anchor. When this and the asset grades disagree, the gap IS
// the playing-time / market / aging story.
export function fantasyRate(inp: ValueInputs, s: LeagueSettings): number {
  const fmt = FORMAT[s.format];
  if (inp.isPitcher) {
    if (inp.era20 === undefined) return 0;
    return Math.max(0, (4.6 - inp.era20) * 2.2);
  }
  let f = 0;
  if (inp.peakWrcPlus !== undefined) f += fmt.wrcFan * Math.max(0, (inp.peakWrcPlus - 90) / 12);
  if (inp.hr !== undefined) f += fmt.hrFan * (inp.hr / 12);
  if (inp.sb !== undefined) f += fmt.sbFan * (inp.sb / 12);
  return f;
}

// The single, build-agnostic OVERALL value — a player's total dynasty asset worth.
// Now (this season) + Keep (all future seasons) are different time windows, so a
// blend is honest, not double-counting. Weighted toward Keep (¼ Now / ¾ Keep)
// because in a keeper league the years you hold him dwarf the current one; a
// contender still reads Now directly, a rebuilder reads Keep directly.
export const OV_NOW_WEIGHT = 0.25;
export function overallValue(now: number, keep: number): number {
  return OV_NOW_WEIGHT * now + (1 - OV_NOW_WEIGHT) * keep;
}

export function computeValue(inp: ValueInputs, s: LeagueSettings): { present: number; future: number; surv?: number[] } {
  if (inp.war === undefined) return { present: 0, future: 0 };
  const fmt = FORMAT[s.format];
  const scar = scarcityMult(inp.position, s);
  // Reliever role: limited innings cap fantasy production regardless of rate
  // quality (Mason Miller problem) — win-now docked hard, keeper value keeps
  // most of the ceiling (an elite RP arm is a rotation-conversion lottery
  // ticket; the trade view's saves premium adds closer value back on top).
  const isRp = inp.isPitcher && inp.ipg !== undefined && inp.ipg < 2.01;
  // Two defense-insurance rates. Present keeps a flat 30% of DEF (playing-time
  // safety this season). Keeper keeps 70% × sbAgeFactor — defense doesn't score,
  // but it's what brings the bat's fantasy skills to life through PLAYING TIME
  // over the horizon (a young ++ glove secures a decade of everyday jobs), and
  // that glove is itself an athleticism asset that erodes on the same age curve
  // as speed (70% at ≤26 → ~56% at 30 → ~46% at 33). The 70% young-age anchor
  // (not 100%) is the guardrail that keeps FV starting from the hitting profile:
  // a no-bat glove wizard still can't out-keep a real bat on defense alone.
  const cSev = catcherSeverity(inp.position, inp.catcherShare, inp.catcherFlex);
  const fWar = inp.isPitcher ? inp.war : fantasyWar(inp.war, inp.position, cSev, inp.defRuns, 0.3);
  // Keeper WAR doesn't inherit WAR's NEGATIVE positional adjustments (1B −12.5,
  // DH −17.5, corner OF −7.5 runs/season): they're real-baseball replacement
  // accounting, and fantasy already prices position via the roster-slot scarcity
  // model — charging both hammers every 1B/DH bat twice (Casas-at-3.2 problem).
  // Deliberately ASYMMETRIC: positive adjustments (C/SS/CF...) stay in, because
  // scarce eligibility is genuine fantasy value (a 120 wRC+ catcher > a 120 wRC+
  // first baseman in any dynasty league) — common eligibility isn't a penalty,
  // just the absence of that premium. The remainder after removing the label
  // charge approximates actual FIELDING, so a genuinely bad-glove corner bat
  // still carries his (retained, age-decayed) DH-crowding risk.
  const NEG_POS_ADJ: Record<string, number> = { LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5 };
  // Only when DEF is known: fantasyWar's legacy no-DEF fallback already credits
  // 1B/DH (+1.0/+1.2), so stripping there too would double-count.
  const negPosRuns = inp.defRuns !== undefined ? (NEG_POS_ADJ[inp.position ?? ''] ?? 0) : 0;
  const fWarKeeper = inp.isPitcher ? inp.war : fantasyWar(
    inp.war - negPosRuns / 9.774, inp.position, cSev,
    inp.defRuns === undefined ? undefined : inp.defRuns - negPosRuns,
    0.7 * sbAgeFactor(inp.age));

  // ---- Future (keeper) value ----
  const bar = keeperBarFor(s, inp.isPitcher, inp.position);
  let fantasy = 0;
  if (inp.isPitcher) {
    if (inp.era20 !== undefined) fantasy = Math.max(0, 4.0 - inp.era20);
  } else {
    if (inp.peakWrcPlus !== undefined) fantasy += fmt.wrcFan * Math.max(0, (inp.peakWrcPlus - 100) / 20);
    if (inp.hr !== undefined) fantasy += fmt.hrFan * (inp.hr / 25);
    if (inp.sb !== undefined) fantasy += fmt.sbFan * (inp.sb / 25) * sbAgeFactor(inp.age);
  }
  // Growth premium fades with age (see growthPremium). An aging hitter's counting
  // stats erode alongside, so his fantasy credit fades on the same schedule; a
  // pitcher's ERA-based fantasy holds (run prevention ages more gracefully).
  const growth = growthPremium(inp.age, inp.isPitcher, inp.position);
  const fantasyFade = inp.isPitcher ? 1 : growth / 3;
  // Catcher counting stats shrink with catcher PA volume too — proportional to
  // how much he actually catches (a C/LF/DH's HR aren't squat-suppressed).
  fantasy *= 1 - 0.2 * cSev;
  // Clearing the keeper bar used to be a hard step (0.15 → 1.0 the instant WAR
  // crossed the bar), which put a cliff in keeper value — a 1.9- and 2.1-WAR guy
  // graded 10× apart. Smooth it into a ramp across ±0.75 WAR around the bar so a
  // small WAR difference is a small FV difference.
  const clearsAt = (w: number) => clamp((w - bar + 0.75) / 1.5, 0, 1);
  // Per-season netting (see keeperSeasons): decay the GROSS keeper WAR along the
  // aging curve and re-net against the bar EACH season, floored at 0 — a season
  // where the decayed ability sits below the bar contributes nothing (you'd just
  // keep someone else) instead of riding along as decayed surplus. The clears
  // gate slides season by season the same way, so a bat-first corner's fantasy
  // credit fades toward the 0.15 floor as his margin over the bar erodes rather
  // than staying frozen at today's clearance.
  // Career survival rides on every future season (see survivalCurve) — shared
  // with the sustained floor in liveValue via the return value so both paths
  // price the same career-end odds.
  const surv = survivalCurve(inp.age, inp.isPitcher, fWarKeeper, bar);
  const warTerm = keeperSeasons(inp.age, inp.isPitcher, (ret) => Math.max(0, fWarKeeper * ret - bar), surv) * growth;
  const fantasyTerm = fantasy * fantasyFade
    * keeperSeasons(inp.age, inp.isPitcher, (ret) => ret * (0.15 + 0.85 * clearsAt(fWarKeeper * ret)), surv);
  const future = (warTerm + fantasyTerm) * (isRp ? 0.8 : 1) * keeperDeferral(inp.age, inp.level, inp.isPitcher, s.rebuilder) * scar;

  // ---- Present (win-now) BASE: WAR + market, park- and playing-time-NEUTRAL.
  // The dynamic layer (current-rate × ACTUAL playing time × park) is applied
  // downstream in the Trade Checker, where real game-log usage + park live — see
  // its dynamic-present track. Format's prod weight is folded into that layer.
  const lvl = presentLevelFactor(inp.level);
  // A pre-peak player isn't producing his PEAK WAR yet — his current ability is
  // below the ceiling, so the peak-WAR component of PRESENT value is discounted by
  // age (a 21-yo's win-now value ≠ his age-27 projection). FV keeps the full
  // ceiling; this only touches what he's worth NOW.
  const warPv = Math.max(0, fWar - replacementWar(s)) * 1.8 * lvl * presentMaturity(inp.age) * (isRp ? 0.55 : 1);
  const mkt = inp.marketBaseline ?? 0;
  // Positional scarcity weighs mostly on KEEPER value (a scarce SS is hard to
  // replace on your roster); win-now production is closer to position-agnostic
  // (a run's a run today), so present value only feels scarcity at half strength.
  const scarPresent = 1 + (scar - 1) * 0.5;
  // Market-led when the player is IN the auction export (the good predictor) —
  // including when the market values him at/below replacement (mkt 0), which is a
  // real signal, not a reason to fall back. WAR-led fallback ONLY when he's absent
  // from the export entirely (marketBaseline undefined), so he isn't zeroed. His
  // actual production still flows in via the dynamic layer downstream.
  const inExport = inp.marketBaseline !== undefined;
  const wW = inExport ? fmt.warW : 0.6;
  const mW = inExport ? fmt.mktW : 0;
  const present = (wW * warPv + mW * mkt) * scarPresent;

  const r = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
  return { present: r(present), future: r(future), surv };
}

// ---- LIVE value: the trade-grade Now / Keep / Overall. The SINGLE source of
// truth for the graded values shown in BOTH the Trade Checker and the Value
// Board — do not re-derive PV/FV in the components. It wraps computeValue's
// neutral base with the two layers the base model omits:
//   1) the fantasy-PRODUCTION layer (current-form rate + scarce HR/SB counting,
//      scaled by playing time) — the biggest chunk of present value, and
//   2) the SUSTAINED-production keeper floor (an established bat's future years ≈
//      his present production, age-discounted), which lifts a solid vet's Keep.
// Every genuinely-LIVE signal (injury, park, saves, observed role, platoon, PT
// threats) arrives via `layers`, each defaulting to NEUTRAL — so a healthy,
// everyday, neutral-park player reads IDENTICALLY on the board and in a trade.
// The board supplies only the bulk-available layers (isMLB, ROS rates); the
// Trade Checker supplies the full live set. Whatever differs between the two is
// therefore exactly a real live adjustment (an injury, a benching, a park), not
// a code-drift artifact.
export const DYN_W = 0.7; // weight of the fantasy-production layer over the WAR/market base

export interface ValueLayers {
  isMLB?: boolean;        // MLB player? the fantasy layer + PT haircut are majors-only (default false → prospects score off the neutral base, as they do in a trade)
  ptCredit?: number;      // 0.3–1.05 fraction of full-time reps (hitters); default 1 (everyday). Playing time is a live layer — the board leaves it at 1.
  rosWrc?: number;        // rest-of-season wRC+ (hitters) — the preferred current-form rate; falls back to cur/peak
  rosEra?: number;        // rest-of-season ERA, traditional scale (pitchers); falls back to cur/peak ERA/20
  savesPremium?: number;  // closer saves value (trade-only, needs live saves pace); default 0
  fvPtFactor?: number;    // keeper PT / role-attainment factor; default 1
  injuryMult?: number;    // present injury dock; default 1
  armPvMult?: number;     // present arm-injury nick (0.93 if arm-injured); default 1
  armFvMult?: number;     // keeper arm-injury fade; default 1
  ptDockEff?: number;     // present PT-threat dock (returnee / minors pusher / roster crowd); default 1
  jobSecurity?: number;   // present job-security (WAR as PT confidence, position-aware); default 1
  earnBump?: number;      // prime-age high-WAR buy-low reps nudge; default 1
  platoonDock?: number;   // platoon-role dock; default 1
  homePark?: number;      // home-park run environment; default 1
}

// Fantasy PRODUCTION rate scaled by playing time — the non-WAR, usage-responsive
// layer that lets a live bat/arm move present value. Majors-only (a prospect's
// production doesn't count toward THIS season, so it stays on the neutral base).
// The counting term is deliberately shape-blind for PRESENT value — the OOPSY
// auction/ROS market anchor already prices category scarcity into Now, so
// weighting here would double-apply it. When this rate feeds the sustained
// KEEPER floor, though, present production is being banked into future seasons,
// so the floor path (floorFmt set) values counting at future prices: the format
// shape weights × the speed age decay, same as the ceiling — otherwise an aging
// SB-heavy floor-rider escapes the decay the ceiling correctly applies.
function fantasyProd(inp: ValueInputs, L: ValueLayers, floorFmt?: FormatWeights): number {
  if (!L.isMLB) return 0;
  const mat = presentMaturity(inp.age); // pre-peak guys don't produce their peak rate yet
  if (inp.isPitcher) {
    // ROS ERA is traditional; the model's ERA/20 runs ~0.2 higher — convert.
    const e = L.rosEra !== undefined ? L.rosEra + 0.2 : (inp.curEra20 ?? inp.era20);
    return e === undefined ? 0 : Math.max(0, (4.6 - e) * 1.2) * mat;
  }
  const w = L.rosWrc ?? inp.curWrcPlus ?? inp.peakWrcPlus;
  const rateProd = w === undefined ? 0 : Math.max(0, (w - 90) / 12);       // OBP/rate value
  const countingProd = floorFmt
    ? (floorFmt.hrFan * (inp.hr ?? 0) + floorFmt.sbFan * sbAgeFactor(inp.age) * (inp.sb ?? 0)) / 18
    : ((inp.hr ?? 0) + (inp.sb ?? 0)) / 18;                               // scarce HR+SB — worth more than their WAR share
  return Math.max(rateProd, countingProd) * (L.ptCredit ?? 1) * mat;
}

export function liveValue(inp: ValueInputs, s: LeagueSettings, L: ValueLayers = {}): { present: number; future: number; overall: number; outlook?: { next3: number; peakSeason: number } } {
  const base = computeValue(inp, s);
  const ptCredit = L.ptCredit ?? 1;
  // Present: the WAR+market base assumes a full-time role, so MLB hitters take a
  // mild continuous PT haircut; the fantasy layer already bakes in actual usage.
  const ptHaircut = L.isMLB && !inp.isPitcher ? 0.6 + 0.4 * ptCredit : 1;
  const injuryMult = L.injuryMult ?? 1;
  // Every live present multiplier except the injury dock (the floor un-docks it).
  const pvMults = (L.armPvMult ?? 1)
    * (L.ptDockEff ?? 1) * (L.jobSecurity ?? 1) * (L.earnBump ?? 1)
    * (L.platoonDock ?? 1) * (L.homePark ?? 1);
  const present = (base.present * ptHaircut + DYN_W * fantasyProd(inp, L) + (L.savesPremium ?? 0))
    * injuryMult * pvMults;
  // Keeper: the durability-tilted ceiling, floored by sustained production.
  const durable = warDurability(inp.war ?? 0, inp.isPitcher ? undefined : inp.position);
  const ceiling = base.future * (L.fvPtFactor ?? 1) * durable;
  const war = inp.war ?? 0;
  // Sustained-production floor: an established player's future years ≈ his present
  // production, discounted by how many good years remain (keeperAgeFactor). Un-dock
  // the age-maturity haircut (keeper banks the peak) and the current-IL hedge
  // (keeper value is about future healthy seasons). Phased in with a smooth WAR
  // taper so a genuine scrub keeps little of it and a 1.5-WAR+ regular most.
  const sustainTaper = clamp((war - 0.4) / 1.4, 0, 1);
  // The floor re-prices the production layer's counting at FUTURE prices (shape
  // weights + speed decay — see fantasyProd) before banking it forward; the
  // present shown to the user keeps the raw market-led counting.
  const healthyPv = (base.present * ptHaircut + DYN_W * fantasyProd(inp, L, FORMAT[s.format]) + (L.savesPremium ?? 0)) * pvMults;
  // The floor gets the same per-season netting: healthyPv is already SURPLUS
  // over the freely-available line, so re-inflate to gross with the per-season
  // roster-spot value, decay the gross, and re-net each year — a fading vet's
  // below-the-line seasons stop paying out through the floor too.
  const FLOOR_REPL = 0.7; // per-season roster-spot value (mirrors the trade calc's PV replacement)
  const annualPv = healthyPv / presentMaturity(inp.age);
  const sustained = sustainTaper
    * keeperSeasons(inp.age, inp.isPitcher, (ret) => Math.max(0, (annualPv + FLOOR_REPL) * ret - FLOOR_REPL), base.surv);
  const savesFv = (L.savesPremium ?? 0) * 0.45 * keeperAgeFactor(inp.age, true);
  const future = (Math.max(ceiling, sustained) + savesFv) * (L.armFvMult ?? 1);

  // ---- Future-outlook slices (the "3yr" / "Best yr" chips) ----
  // For an MLB player the anchor is his CURRENT healthy per-season value (Now
  // units, injury un-docked): divide out the pre-peak maturity discount to get
  // his peak-scale annual value, then walk each future season along the aging
  // curves × the quality-conditioned survival odds. Keep is deliberately NOT
  // the anchor — it prices a keeper SLOT (ceiling-vs-bar economics), a bigger
  // unit system, and slicing it made a prime-age everyday bat's next season
  // read ABOVE his Now (the Ben Rice 8.0-vs-6.1 bug, 2026-08-05). Prospects
  // have no meaningful Now, so they still derive from Keep via keeperAgeFactor
  // — the keeper asset value is the only signal there.
  let outlook: { next3: number; peakSeason: number } | undefined;
  const rr = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
  if (inp.age !== undefined && L.isMLB) {
    const surv = base.surv ?? [];
    // MLB anchor is RELATIVE: his current value already embodies his current
    // age's spot on the curve (a 34-yo producing 8.9 IS his age-34 level), so
    // divide by today's shape and re-apply each future season's — walking the
    // curve forward at its RATE, not re-imposing the whole decline from peak.
    const annualPeakVal = healthyPv / Math.max(0.05, futureSeasonShape(inp.age, inp.isPitcher));
    const seasons = Array.from({ length: 7 }, (_, i) => {
      const a = inp.age! + i + 1;
      return annualPeakVal * futureSeasonShape(a, inp.isPitcher) * (surv[i] ?? 1);
    });
    outlook = { next3: rr((seasons[0] + seasons[1] + seasons[2]) / 3), peakSeason: rr(Math.max(...seasons)) };
  } else if (inp.age !== undefined) {
    // Prospect: price his PEAK SEASON through the same machinery that prices an
    // MLB player's Now — his peak WAR / wRC+ / HR / SB as an everyday MLB
    // player at peak age. With the market input deliberately dropped (any
    // auction $ he carries prices his ROS role, not a peak season), the WAR-led
    // fallback + the fantasy-production layer at a full role approximate what
    // the auction calculator would say about that season preseason. Best yr =
    // that CEILING, undiscounted — bust/arrival risk lives in Keep, not here.
    // 3yr = the realistic near years: the ceiling bent by the maturation ramp
    // at his age and the arrival/bust deferral (a 19-yo in A-ball gives you
    // little over the NEXT three seasons even when the peak is big).
    const peakNow = liveValue(
      { ...inp, age: 27, level: 'MLB', marketBaseline: undefined, curWrcPlus: undefined, curEra20: undefined },
      s, { isMLB: true, ptCredit: 1 },
    ).present;
    const defer = keeperDeferral(inp.age, inp.level, inp.isPitcher, s.rebuilder);
    const near = [1, 2, 3].map((k) => peakNow * futureSeasonShape(inp.age! + k, inp.isPitcher) * defer);
    outlook = { next3: rr((near[0] + near[1] + near[2]) / 3), peakSeason: rr(peakNow) };
  }
  return { present, future, overall: overallValue(present, future), outlook };
}
