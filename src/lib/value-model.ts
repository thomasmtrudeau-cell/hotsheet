// Single source of truth for the PV/FV value model, shared by the server (which
// bakes a default into the premium payload) and the client (which recomputes
// live as the user changes their league settings). All the league-specific
// levers live here so the two stay in lockstep.

import { AUCTION_VALUES } from './auction-values';

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
  rpWar?: boolean;        // war is the sheet's role-priced 'RP WAR' (pure RP) — skip the RP role docks
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
  pa?: number;           // hitters — auction export's own ROS PA read (his sheet-level playing-time signal, pre-live-layer)
  auctionRaw?: number;   // the auction $ itself, UNFLOORED (can be negative) — Now decomposes this into a per-PA rate; marketBaseline has already floored the below-replacement signal away
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// How much an MLB player's projected talent (WAR) alone earns him the benefit
// of the doubt over his circumstances — 0 unproven, 1 essentially can't lose
// his job (~5+ WAR bats / ~4+ WAR arms). Shared by the season engine's
// opportunity-confidence blend (oppW) and fantasyProd's PT-credit floor below,
// so "how talented is he" means the same thing in both places.
function talentConfidence(war: number | undefined, isPitcher: boolean): number {
  return clamp(isPitcher ? ((war ?? 0) - 1.5) / 2.5 : ((war ?? 0) - 2) / 3, 0, 1);
}

// Keeper value is a DISCOUNTED SUM over the next several seasons, weighting NEXT
// year far more than distant ones (2027 >> 2030). Each future season is scaled
// by a gentle aging curve. Because the near years dominate the sum, an aging
// star who still projects well next year keeps real keeper value instead of
// being zeroed out — while youth compounds across many productive seasons. The
// aging curve is deliberately gentle: WAR already separates elite-aging from
// washed, since a low-WAR vet has little annual value to carry forward anyway.
const YEAR_DISCOUNT = 0.72;   // each year out is worth 72% of the prior year
const KEEPER_HORIZON = 7;     // seasons of keeper value considered

// Pure reliever (IP/G < 2.01), UNLESS his WAR already came in role-priced via
// the sheet's 'RP WAR' column (inp.rpWar) — that figure is usage-correct
// already, so treating him as a "pure RP" again would double-dock him.
function isPureReliever(inp: ValueInputs): boolean {
  return Boolean(inp.isPitcher && inp.ipg !== undefined && inp.ipg < 2.01 && !inp.rpWar);
}

// CLOSER TRAJECTORY (Tom, 2026-08-17): elite non-closer relievers (Morejon/
// Cade-Smith/Muñoz-before-them types) convert to closer at a far higher rate
// than middle relief, but the model had ZERO forward credit for that — saves
// value only ever arrives via the LIVE savesPremium layer, which needs an
// actual observed saves pace, so a shutdown 8th-inning arm with 0 saves reads
// on ERA/20 alone, same as a mop-up specialist with an identical rate line.
// This is a SKILL-ONLY PROXY: there's no bullpen depth-chart data (who's the
// incumbent closer, is there a vacancy) to actually know his odds, so it can't
// tell "next man up" from "buried behind a 3-year incumbent" — sized to nudge
// Keep/Upside, not to approximate a real closer's saves credit. Never touches
// Now (he hasn't gotten the job yet). Zeroed once he already has real saves
// value (currentSavesPremium) so he isn't credited twice for the same thing.
const CLOSER_ERA20_ELITE = 3.0;  // full proxy credit at/below this skill level
const CLOSER_ERA20_BAR = 4.2;    // credit fades to 0 above this (shaky/replacement arm)
const CLOSER_PROXY_CAP = 1.8;    // well under a real closer's ~5.0 savesPremium ceiling
function closerTrajectoryBonus(inp: ValueInputs, isRp: boolean, currentSavesPremium: number): number {
  if (!isRp || currentSavesPremium > 0.5) return 0;
  const era = inp.era20 ?? inp.curEra20;
  if (era === undefined) return 0;
  const conf = clamp((CLOSER_ERA20_BAR - era) / (CLOSER_ERA20_BAR - CLOSER_ERA20_ELITE), 0, 1);
  return conf * CLOSER_PROXY_CAP;
}

// Auction-$ display scale — the inverse of war.ts's marketBaselineFor
// ((auction$ − role FA line) / DIV): turns a value-model number back into its
// auction-dollar equivalent for the UI. Safe across every chip (Now/Keep/2yr/
// Upside/Overall) because Overall is deliberately normalized to a per-season
// reference card specifically so every chip shares this one scale (see the
// OV_* block below). Exported so war.ts's real marketBaselineFor and this
// display-only inverse can't drift apart.
export type AuctionRoleForDisplay = 'SP' | 'RP' | 'HIT';
export const FA_LINE: Record<AuctionRoleForDisplay, number> = { SP: 1, RP: 3, HIT: 3 };
export const AUCTION_DIV = 5; // $ above the FA line per 1.0 of value-model scale
// How much shallower/deeper than the 560-slot (20-team × 28-keeper) reference
// league this one is — >1 in a shallower league (fewer roster spots means a
// stronger player sits on the wire). Already the established convention for
// shifting a REPLACEMENT-LEVEL bar with league depth (keeperBarFor,
// replacementWar, Overall's waiver line all use it). Tom, 2026-08-19: a fixed
// per-team auction budget means dollars-per-roster-slot stays roughly constant
// regardless of team count (total $ and total slots both scale with team
// count) — so this factor belongs on the REPLACEMENT FLOOR (FA_LINE), not on
// the $-per-unit conversion above it (AUCTION_DIV stays fixed).
export function depthFactor(s: LeagueSettings): number {
  return Math.sqrt(560 / Math.max(1, s.teams * s.keepers));
}
export function toAuctionDollars(value: number, isPitcher: boolean, isRp: boolean, s: LeagueSettings = DEFAULT_SETTINGS): number {
  const role: AuctionRoleForDisplay = isPitcher ? (isRp ? 'RP' : 'SP') : 'HIT';
  return FA_LINE[role] * depthFactor(s) + value * AUCTION_DIV;
}

// ---- NOW (Tom, 2026-08-18): rate × confidence-adjusted playing time ----
// Now is supposed to track the auction calc closely — it's already rate × PA.
// The old model blended the sheet's $ with a separate WAR/production layer,
// which double-counted for a player already at or near full PT (Rafaela: $16
// sheet, $24 shown — no PT story, pure double count). The fix: decompose the
// SHEET's own $ into a per-PA rate, then re-apply that rate at a CONFIDENCE-
// ADJUSTED share of the league's real full-time ceiling (the highest ROS PA
// in the export — Caminero territory) instead of adding a second production
// term on top.
//
// The highest ROS PA among hitters in the current export — a live "what does
// full-time look like RIGHT NOW" reference (shrinks as the season empties out).
export const PA_CEILING = Math.max(
  60,
  ...Object.values(AUCTION_VALUES)
    .filter((v) => v.r === 'HIT' && v.pa !== undefined)
    .map((v) => v.pa as number),
);

// WAR-vs-role interaction (Tom, 2026-08-18): a player's CURRENT talent level
// relative to what a full-time role requires tells you how safe his playing
// time really is — independent of what the sheet's PA number says today.
// Weak WAR at real PA (a $15 Jake Burger) → platoon/DFA risk, so discount the
// credit his PA implies — worse WAR, bigger discount, no cliff. Strong WAR at
// low/no PA (a hot callup, a shutdown arm not yet trusted with saves) → the PA
// read is too conservative, so boost it instead.
const ROLE_WAR_BAR: Record<'hitter' | 'pitcher', number> = { hitter: 2.0, pitcher: 1.3 };
function jobSecurityConfidence(warProxy: number, isPitcher: boolean, paFrac?: number): number {
  const bar = ROLE_WAR_BAR[isPitcher ? 'pitcher' : 'hitter'];
  // A "tick", not a re-rating — the sheet's own $ is already the strongest
  // signal (Tom, 2026-08-18: Burger should read only SLIGHTLY below his $15,
  // not dramatically so). Narrow band keeps this a nudge on top of the market
  // read rather than something that can re-price a well-known star on its own.
  const raw = 1 + 0.08 * (warProxy - bar);
  // The BOOST side only means something when PA is actually suppressed — an
  // already-full-PT star's elite WAR is already fully reflected in his PA-
  // implied credit, nothing hidden left to reveal (an established $30 guy at
  // near-full PT was reading $36 before this gate — the same overshoot Tom
  // flagged for an injured Vlad, just without an injury excuse this time).
  // Shrinks toward neutral as paFrac approaches the ceiling. The DISCOUNT
  // side isn't gated — a real job-security risk exists whether he's playing
  // a lot or a little right now (Burger).
  if (raw > 1 && paFrac !== undefined) {
    const room = clamp(1 - paFrac, 0, 1);
    return 1 + (raw - 1) * room;
  }
  return clamp(raw, 0.8, 1.2);
}

// Which WAR figure should DRIVE that confidence read. Pitchers: peak WAR
// directly — stuff/command translate close to mature value fast, so a 21-yo's
// skill ERA is already close to his 26-yo projection (Tom, 2026-08-18).
// Hitters ramp far more slowly (Lara: peak wRC+ >110 but his ROS/current form
// is 82 — well below it), so his PEAK war overstates how much he's actually
// earning his playing time RIGHT NOW. Scale peak WAR down by how much of his
// peak RATE he's actually showing (floored at 0 — a current rate below
// replacement earns no current-talent credit at all, regardless of ceiling).
function currentWarProxy(inp: ValueInputs, curWrcOverride?: number): number {
  const peakWar = inp.war ?? 0;
  if (inp.isPitcher) return peakWar;
  const cur = curWrcOverride ?? inp.curWrcPlus;
  const peak = inp.peakWrcPlus;
  // Lara had an explicit current-vs-peak wRC+ read to key off (82 vs 113) — most
  // pre-peak hitters won't have that specific a signal available, but they ramp
  // to peak on the SAME curve regardless (Tom, 2026-08-18: "other than Lara we
  // need logic for how to approach their now WAR... before they are peak").
  // Default every pre-peak hitter to the age-based ramp (the same curve his Now
  // rate/warPv already uses elsewhere); only override it with the sharper
  // current-vs-peak-rate read when we actually have both numbers.
  if (cur === undefined || peak === undefined || peak <= 90) return peakWar * presentMaturity(inp.age);
  const ratio = clamp((cur - 90) / (peak - 90), 0, 1.3);
  return peakWar * ratio;
}

// His true $-per-PA productivity, read straight off the sheet (needs a real
// sample — under ~15 PA the export's own total is too noisy to divide out).
function hitterRatePerPA(inp: ValueInputs): number | undefined {
  // Also gated on marketBaseline (not just auctionRaw/pa): the talent-only
  // lenses (peakSeasons' Upside anchor, the not-in-export fallback) explicitly
  // null out marketBaseline to strip the market signal — without this same
  // gate here, auctionRaw/pa would leak his CURRENT market rate into what's
  // supposed to be a market-free ceiling read.
  if (inp.marketBaseline === undefined) return undefined;
  if (inp.auctionRaw === undefined || inp.pa === undefined || inp.pa < 15) return undefined;
  return inp.auctionRaw / inp.pa;
}

// Re-apply a $-per-PA rate at a confidence-adjusted share of the full-time PA
// ceiling, in value-model scale. paFrac can run above 1 (a confidence boost
// past what the sheet's own PA implies) or produce a negative surplus (a
// below-replacement rate scaled up by real playing time is a real negative
// signal, e.g. Lara) — floored at 0 like every other present-value path.
function presentFromRateAndPa(rateDollarPerPA: number, paFrac: number, isPitcher: boolean, isRp: boolean, s: LeagueSettings): number {
  const role: AuctionRoleForDisplay = isPitcher ? (isRp ? 'RP' : 'SP') : 'HIT';
  const fullPtSurplus = rateDollarPerPA * PA_CEILING - FA_LINE[role] * depthFactor(s); // can be negative
  return Math.max(0, fullPtSurplus * clamp(paFrac, 0, 1.15)) / AUCTION_DIV;
}

// ---- UPSIDE (Tom, 2026-08-18): full-PT dollar value from category production
// ALONE — wRC+/HR/SB (pitchers: ERA/20) at a full season, no WAR, no park, no
// market anchor. fantasyRate() already computes exactly that shape (it's the
// pure "if he plays, what does he produce" rate used elsewhere as a
// SUPPLEMENTARY layer at DYN_W=0.7) — reused here as the ENTIRE basis, so it
// needs its own dollarization scale rather than the borrowed one. First-pass
// calibration (hand-checked against a few representative lines, not a full
// regression) — sanity-check against real $30/$40 players and retune if off.
// This SAME number anchors the peakSeasons ceiling lens below, so Keep/
// Overall's "how much of his ceiling does he get" blend and the standalone
// Upside chip are always talking about the same ceiling.
const UPSIDE_SCALE_HIT = 0.68;
const UPSIDE_SCALE_PIT = 1.0;
function upsideValueScale(inp: ValueInputs, s: LeagueSettings): number {
  const f = fantasyRate(inp, s);
  return f * (inp.isPitcher ? UPSIDE_SCALE_PIT : UPSIDE_SCALE_HIT);
}
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
function survivalCurve(age: number | undefined, isPitcher: boolean, fWarKeeper: number, bar: number, len = KEEPER_HORIZON): number[] | undefined {
  if (age === undefined) return undefined;
  const out: number[] = [];
  let s = 1;
  for (let k = 1; k <= len; k++) {
    const a = age + k;
    const margin = fWarKeeper * ageRetention(a, isPitcher) - bar;
    // Pitcher arm attrition (Tom, 2026-08-07): an elite projection must not
    // clamp an ARM's career-end hazard to ~1% — TJ/breakdown risk runs ~5%+/yr
    // for even the best aging arms (the chart-only survivalTo always knew
    // this; the keeper curve didn't). Floor a 31+ pitcher's hazard at 5.5%.
    const floor = isPitcher && a >= 31 ? 0.055 : 0.01;
    s *= 1 - clamp(0.075 * (a - 34) - 0.21 * margin, floor, 0.85);
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

// The single, build-agnostic OVERALL value — a player's total dynasty asset
// worth, i.e. TRADE value. CUMULATIVE (Tom, 2026-08-07 #2): the discounted sum
// of every remaining season's value ABOVE the waiver-wire line, over his whole
// career — quality × quantity in one number, so longevity finally pays (a
// 23-yo ace's ages 31-33 count "at least a little bit"; a 33-yo's career
// simply runs out of seasons to sum). The discount is deliberately gentler
// than Keep's near-window weighting (0.85 vs 0.72): time preference lives in
// Now/2yr/Keep; Overall is the asset ledger. Normalized to an 8-season
// reference card so the scale stays per-season-like: a player with exactly 8
// flat seasons at value V reads V — more relevant years push him above his
// per-season value, fewer pull him below. The min(Now, REPL) baseline term (in
// liveValue) means a rostered scrub is still worth his sub-replacement Now,
// while a prospect contributes nothing this season and starts from 0.
export const OV_DISCOUNT = 0.85;      // long-tail annual decay from year 2 on
// Front-loaded (Tom, 2026-08-18): "weight the future but this season and next
// the most" — the step from Now to next season is steeper than the long-tail
// rate; from next season on, decay resumes at the gentler OV_DISCOUNT so a
// long career still keeps paying.
export const OV_NEAR_DISCOUNT = 0.7;
function ovWeight(k: number): number {
  if (k <= 0) return 1;
  if (k === 1) return OV_NEAR_DISCOUNT;
  return OV_NEAR_DISCOUNT * Math.pow(OV_DISCOUNT, k - 1);
}
export const OV_REPL = 0.7; // waiver-wire per-season line (mirrors the trade calc's PV replacement)
const OV_NORM = Array.from({ length: 8 }, (_, k) => ovWeight(k))
  .reduce((a, b) => a + b, 0); // the 8-season reference career, front-loaded shape
// Legacy blend — ONLY for the age-unknown fallback path, where there is no
// season vector to sum (old-scale future, so the old weighting is kept).
export function overallValue(now: number, keep: number): number {
  return (now + 2.31 * keep) / 3.31;
}

export function computeValue(inp: ValueInputs, s: LeagueSettings): { present: number; future: number; surv?: number[] } {
  if (inp.war === undefined) return { present: 0, future: 0 };
  const fmt = FORMAT[s.format];
  const scar = scarcityMult(inp.position, s);
  // Reliever role: limited innings cap fantasy production regardless of rate
  // quality (Mason Miller problem) — win-now docked hard, keeper value keeps
  // most of the ceiling (an elite RP arm is a rotation-conversion lottery
  // ticket; the trade view's saves premium adds closer value back on top).
  // ONLY when his WAR is the 20-TBFG starter-workload talent figure: a pure RP
  // ingested via the sheet's role-priced 'RP WAR' (inp.rpWar, Jordan 2026-08-07)
  // is already usage-correct — Jordan's RP WAR runs ≈0.55-0.6× the 20-TBFG
  // number, i.e. this dock computed upstream, so docking again double-charges.
  const isRp = isPureReliever(inp);
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
  // Long enough to cover the full-career horizon liveValue projects (the
  // pre-peak Keep shift and the cumulative Overall's run to ~age 43).
  // CAREER survival is a real-baseball fact, so its quality margin is pinned
  // to the 20-team/28-keeper baseline bar — using the LEAGUE bar made stars
  // "die" young in shallow leagues (a 10-team keeper bar is so high that
  // 34-yo Trout's margin went negative → ~40%/yr hazard → Keep 1.6). The
  // league's own bar still prices keeper ECONOMICS via netting elsewhere.
  const survBar = keeperBarFor({ ...s, teams: 20, keepers: 28 }, inp.isPitcher, inp.position);
  const surv = survivalCurve(inp.age, inp.isPitcher, fWarKeeper, survBar,
    Math.max(KEEPER_HORIZON + Math.max(0, 26 - ((inp.age ?? 26) + 1)),
      Math.min(25, 43 - (inp.age ?? 43))));
  const warTerm = keeperSeasons(inp.age, inp.isPitcher, (ret) => Math.max(0, fWarKeeper * ret - bar), surv) * growth;
  const fantasyTerm = fantasy * fantasyFade
    * keeperSeasons(inp.age, inp.isPitcher, (ret) => ret * (0.15 + 0.85 * clearsAt(fWarKeeper * ret)), surv);
  const future = (warTerm + fantasyTerm) * (isRp ? 0.8 : 1) * keeperDeferral(inp.age, inp.level, inp.isPitcher, s.rebuilder) * scar;

  // ---- Present (win-now): rate × confidence-adjusted playing time (Tom,
  // 2026-08-18 — see the NOW block above). Sheet-only baseline; liveValue
  // refines paFrac with the real game log / injury layer on top of this.
  const lvl = presentLevelFactor(inp.level);
  // A pre-peak player isn't producing his PEAK WAR yet — his current ability is
  // below the ceiling, so the peak-WAR component of PRESENT value is discounted by
  // age (a 21-yo's win-now value ≠ his age-27 projection). FV keeps the full
  // ceiling; this only touches what he's worth NOW.
  const warPv = Math.max(0, fWar - replacementWar(s)) * 1.8 * lvl * presentMaturity(inp.age) * (isRp ? 0.55 : 1);
  // Recomputed fresh from the RAW $ at the league's live depth-scaled FA_LINE
  // (Tom, 2026-08-19) rather than trusting the pre-baked marketBaseline (baked
  // server-side against DEFAULT_SETTINGS) — this is the path EVERY pitcher
  // uses, so without this a shallow-league pitcher would silently price off
  // the 20-team replacement floor. Falls back to the pre-baked value only when
  // auctionRaw isn't available (legacy cached payloads).
  const mktRole: AuctionRoleForDisplay = inp.isPitcher ? (isRp ? 'RP' : 'SP') : 'HIT';
  const mkt = inp.auctionRaw !== undefined
    ? Math.max(0, inp.auctionRaw - FA_LINE[mktRole] * depthFactor(s)) / AUCTION_DIV
    : (inp.marketBaseline ?? 0);
  const warProxy = currentWarProxy(inp);
  // A hitter with a real (≥15 PA) auction-export sample gets priced by
  // DECOMPOSING that $ into a per-PA rate and re-applying it at his (confidence-
  // adjusted) share of the league's live full-time ceiling — this IS the market
  // read, not a second layer stacked on top of it (the old wW/mW blend plus the
  // dynamic production layer downstream double-counted a full-PT player's own
  // production, Rafaela: $16 sheet → $24 shown). Pitchers and any hitter absent
  // from the export (or too thin a sample) fall back to the WAR/market blend,
  // scaled by the same confidence read.
  const hitterRate = !inp.isPitcher ? hitterRatePerPA(inp) : undefined;
  let present: number;
  if (hitterRate !== undefined) {
    const paFrac = inp.pa !== undefined ? inp.pa / PA_CEILING : 1;
    const conf = jobSecurityConfidence(warProxy, false, paFrac);
    present = presentFromRateAndPa(hitterRate, paFrac * conf, false, false, s);
  } else {
    const conf = jobSecurityConfidence(warProxy, inp.isPitcher);
    // Positional scarcity weighs mostly on KEEPER value (a scarce SS is hard to
    // replace on your roster); win-now production is closer to position-agnostic
    // (a run's a run today), so present value only feels scarcity at half strength.
    const scarPresent = 1 + (scar - 1) * 0.5;
    // Market-led when the player is IN the auction export (the good predictor) —
    // including when the market values him at/below replacement (mkt 0), which is a
    // real signal, not a reason to fall back. WAR-led fallback ONLY when he's absent
    // from the export entirely (marketBaseline undefined), so he isn't zeroed.
    // (Tom, 2026-08-18): fmt.mktW (~0.62) was calibrated assuming the dynamic
    // production layer ALSO contributed ~0.7 weight on top — this path (pitchers
    // always; hitters only when the sample's too thin to decompose) no longer
    // gets that layer when in-export (the double-count fix), so it needs to
    // trust the market close to fully now, or it silently underprices every
    // in-export pitcher (a $25 Miller-shape read $19 before this fix).
    const inExport = inp.marketBaseline !== undefined;
    const wW = inExport ? fmt.warW : 0.6;
    const mW = inExport ? 1.0 : 0;
    present = (wW * warPv + mW * mkt) * scarPresent * conf;
  }

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
  talentLens?: boolean;   // INTERNAL: this call prices the full-opportunity talent season — skip the season engine (it's what's being priced; also prevents recursion)
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
  // NO MARKET ANCHOR (the peak-priced lens strips it; out-of-export players
  // never had one): nothing else prices SB scarcity — wRC+ folds power in but
  // carries ZERO stolen-base value, so max(rate, counting) erases a speedster's
  // steals whenever his rate is decent (Konnor Griffin: 41 projected SB added
  // literally nothing to his Peak, 2026-08-08). Credit steals on top of the
  // rate in that case. Market-anchored paths are untouched — the auction $
  // already prices the category, and adding here would double-count it.
  const sbBonus = inp.marketBaseline === undefined
    ? (floorFmt?.sbFan ?? 1) * sbAgeFactor(inp.age) * (inp.sb ?? 0) / 18
    : 0;
  // TALENT FLOOR (Tom, 2026-08-13): a proven bat's rate skills don't evaporate
  // when his workload dips — an established stud whose PT is docked to, say,
  // 0.5 shouldn't score below a replacement-level regular playing every day at
  // the same auction $. Floor the credit toward how proven he is (talentConfidence,
  // the same signal that governs the Keep/Overall opportunity blend), scaled down
  // so it can meaningfully lift a real-but-partial role without rescuing a truly
  // NEAR-ZERO one (season-ending IL, buried in the minors) — those describe a guy
  // who isn't playing at all, which no amount of talent changes THIS season.
  const rawPt = L.ptCredit ?? 1;
  const ptCred = rawPt > 0.15 ? Math.max(rawPt, 0.55 * talentConfidence(inp.war, false)) : rawPt;
  return Math.max(rateProd + sbBonus, countingProd) * ptCred * mat;
}

// Structured "why is he priced this way" trace — computed only on demand (the
// trade card's why-panel). Numbers mirror exactly what the engine used.
export interface ValueExplain {
  now: {
    base: number; marketLed: boolean; fantasy: number; saves: number; ptHaircut: number; injuryMult: number; pvMults: number;
    rateMode: boolean;      // true = priced via the rate×PA-ceiling decomposition (an in-export hitter); false = the legacy WAR/market blend
    ratePerPA?: number;     // his sheet $-per-PA, rateMode only
    paFrac?: number;        // his confidence-adjusted share of the PA ceiling, rateMode only
    conf: number;           // job-security confidence multiplier (1 = neutral; >1 boosts, <1 discounts)
  };
  engine?: {
    oppW: number;          // opportunity confidence: 1 = full talent deference (≈5+ WAR bats / 4+ arms, or pre-peak)
    talentNow: number;     // his skills priced at a FULL everyday role (market/role docks stripped)
    shift: number;         // cover-the-peak window shift (pre-peak players)
    closerBonus: number;   // closer-trajectory proxy credit baked into the seasons below (Keep/Upside only, 0 for non-RPs and active closers)
    seasons: { age: number; observed: number; talent: number; used: number; surv: number }[];
    overall: { repl: number; baseline: number; surplus: number };
  };
}
export function liveValue(inp: ValueInputs, s: LeagueSettings, L: ValueLayers = {}, withExplain = false): { present: number; future: number; overall: number; outlook?: { next2: number; peakSeason: number }; explain?: ValueExplain } {
  const base = computeValue(inp, s);
  const ptCredit = L.ptCredit ?? 1;
  const injuryMult = L.injuryMult ?? 1;
  // Every live present multiplier except the injury dock (the floor un-docks it).
  const pvMults = (L.armPvMult ?? 1)
    * (L.ptDockEff ?? 1) * (L.jobSecurity ?? 1) * (L.earnBump ?? 1)
    * (L.platoonDock ?? 1) * (L.homePark ?? 1);
  // Present: refine computeValue's sheet-only NOW read with the LIVE signals a
  // trade card actually has (Tom, 2026-08-18). A hitter with a real auction-$
  // sample gets his playing-time share replaced by the live game-log ptCredit
  // when it's available (more current than the sheet's own PA read), and — if
  // he's hurt — un-docked to his NORMAL healthy role share rather than the
  // season-diluted sheet PA: the missed time gets backfilled by a replacement
  // elsewhere in the trade math (the "+1 roster spot freed" mechanic), so this
  // player's own number shouldn't eat that gap twice. His current-form rate
  // (rosWrc, when live) also refines the confidence read the same way the
  // sheet's curWrcPlus does in computeValue.
  const inExport = inp.marketBaseline !== undefined;
  const hitterRate = !inp.isPitcher ? hitterRatePerPA(inp) : undefined;
  const warProxy = currentWarProxy(inp, L.rosWrc);
  let present: number;
  let paFrac: number | undefined;
  let conf: number;
  let ptHaircut = 1;
  let prodTerm = 0;
  if (hitterRate !== undefined) {
    // No special injury un-dock (Tom, 2026-08-18: a full re-base to the PA
    // ceiling overshot badly — a $23 Vlad on the IL should read a TICK above
    // $23, not $27+, since the market will catch up to his return on its own).
    // Price him at his own real (already-diluted) PA share like anyone else;
    // the existing injuryMult severity dock is the injury signal, and the
    // now-narrower, PA-gated confidence keeps the "he'll be fine" nudge modest.
    paFrac = L.ptCredit !== undefined ? L.ptCredit : (inp.pa !== undefined ? inp.pa / PA_CEILING : 1);
    conf = jobSecurityConfidence(warProxy, false, paFrac);
    present = presentFromRateAndPa(hitterRate, paFrac * conf, false, false, s) * injuryMult * pvMults;
  } else {
    conf = jobSecurityConfidence(warProxy, inp.isPitcher);
    // No real auction-$ sample to decompose (a not-yet-priced hitter, or any
    // pitcher not currently rostered in a saves role) — WAR/market-led base
    // (computeValue already applied `conf` inside it), plus the rate-production
    // layer ONLY when he's absent from the export (in-export already prices
    // his production; adding it again is the double-count this whole pass
    // fixed for the common case).
    ptHaircut = L.isMLB && !inp.isPitcher ? 0.6 + 0.4 * ptCredit : 1;
    prodTerm = inExport ? 0 : DYN_W * fantasyProd(inp, L);
    present = (base.present * ptHaircut + prodTerm + (L.savesPremium ?? 0)) * injuryMult * pvMults;
  }
  // ---- The SEASON ENGINE: one projection, every number a view of it ----
  // (Tom, 2026-08-07): the old Keep priced a keeper SLOT over a 7-year horizon
  // (ceiling-vs-bar economics, its own unit system) while 3yr/Best yr walked
  // the player's actual value forward — two unrelated machines that could
  // disagree about the same player ("next year he's a 5.9" vs "Keep 3.7", the
  // Trout case). Now ONE per-season projection feeds every chip:
  //   Now     = this season (present, above — injuries and all);
  //   2yr     = avg of seasons 1–2, next year matters most;
  //   Peak    = his best remaining season (pre-peak: the priced peak itself);
  //   Keep    = his future seasons combined — YEAR_DISCOUNT-weighted per-season
  //             value, so it stays on the Now scale ("he's ~a 5/yr for you").
  //             COVER-THE-PEAK (Tom, 2026-08-07): a pre-peak player's Keep
  //             window slides forward to start at his prime (age 26), so the
  //             heavy near weights land on the seasons that define him as a
  //             keeper — otherwise a 21-yo with the SAME peak as a 24-yo reads
  //             a lower Keep purely because his peak sits later (the Lara-vs-
  //             Shaw case), double-charging the wait that the maturity ramp
  //             and keeperDeferral already price. Age 25+ is untouched;
  //   Overall = TRADE value: cumulative discounted surplus over the waiver
  //             line across his whole career (see the OV_* block) — quality ×
  //             quantity, so longevity pays.
  let outlook: { next2: number; peakSeason: number } | undefined;
  let future: number;
  let overall: number;
  let explain: ValueExplain | undefined;
  const rr = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
  if (inp.age !== undefined && !L.talentLens) {
    // Seasons to project: through ~age 43 (the cumulative Overall sums the
    // whole career; aging + survival zero the tail out on their own), and
    // never shorter than the pre-peak-shifted Keep window.
    const shift = Math.max(0, 26 - (inp.age + 1));
    const horizon = Math.max(KEEPER_HORIZON + shift, Math.min(25, 43 - inp.age));
    // Two lenses build the season vector; each season takes the better view:
    //
    // 1) WALK-FORWARD (players with a real Now): his current healthy value
    //    walked RELATIVELY along the aging curve — divide by today's shape,
    //    re-apply each future season's (a 34-yo producing 8.9 is already at
    //    his age-34 level; decline applies at the curve's RATE, never re-
    //    imposed from peak) × the quality-conditioned survival odds. The
    //    anchor un-docks an INJURED player's zeroed reps (ptCredit → 1): 0 PA
    //    on the IL is a this-season artifact, not his role — without this a
    //    hurt star's future seasons inherit his empty present.
    let walkSeasons: number[] | undefined;
    if (L.isMLB) {
      const surv = base.surv ?? [];
      const hp = L.homePark ?? 1;
      if (hitterRate !== undefined) {
        // Walk his REAL current per-PA rate forward along the SAME ramp/decline
        // curve Now uses (Tom, 2026-08-18) — at full established PA, since this
        // SEASON's specific role/PT uncertainty doesn't necessarily persist
        // (the opportunity-confidence blend below is what decides how much of
        // that persists). No injury un-dock needed here — an injury is THIS
        // season's story; walking the healthy rate forward already assumes he's
        // fine going forward.
        const shapeToday = Math.max(0.05, futureSeasonShape(inp.age, inp.isPitcher));
        walkSeasons = Array.from({ length: horizon }, (_, i) => {
          const shapeFuture = futureSeasonShape(inp.age! + i + 1, inp.isPitcher);
          const rateAtI = hitterRate * (shapeFuture / shapeToday);
          return presentFromRateAndPa(rateAtI, 1, false, false, s) * (surv[i] ?? 1)
            * (1 + (hp - 1) * Math.pow(0.75, i + 1));
        });
      } else {
        // Pitchers, and any hitter without a real auction-$ sample: legacy
        // walk-forward anchor (WAR/market blend), now consistently carrying
        // the job-security confidence multiplier `conf` computed above (via
        // base.present), with no separate production layer — see below.
        const injured = (L.injuryMult ?? 1) < 1;
        const oL = injured ? { ...L, ptCredit: 1 } : L;
        const oHaircut = !inp.isPitcher ? 0.6 + 0.4 * (oL.ptCredit ?? 1) : 1;
        // The market half of the base is injury-poisoned too: an IL'd player's
        // auction $ prices his depleted ROS reps (a ~34-IP Glasnow), not his
        // healthy per-season value — the same reason the peak-priced lens drops
        // marketBaseline. Re-derive the base WAR-led and take the better of the
        // two, so the un-dock can only lift the anchor, never lower it.
        const oBase = injured
          ? Math.max(base.present, computeValue({ ...inp, marketBaseline: undefined }, s).present)
          : base.present;
        // Future seasons carry the forward-looking arm fade (armFvMult — real
        // surgery/recurrence risk), not armPvMult's this-season availability nick.
        // homePark is NOT in the anchor: it's applied per-season below, fading.
        const oPvMults = (injured ? (L.armFvMult ?? 1) : (L.armPvMult ?? 1))
          * (L.ptDockEff ?? 1) * (L.jobSecurity ?? 1) * (L.earnBump ?? 1)
          * (L.platoonDock ?? 1);
        // No production top-up here regardless of export status (Tom, 2026-08-19):
        // adding it back for the NOT-in-export case reintroduced the exact double-
        // count this pass was fixing — a young player absent from the export with
        // big current SB/HR numbers but a low current-maturity shape got that
        // production credit divided by his small today's-shape and re-inflated
        // across future seasons, blowing PAST his own category-only ceiling
        // (Lara's walk-forward read ~5.7 vs an Upside ceiling of ~3.3 — Keep
        // exceeded Upside, which should be structurally impossible). The peak/
        // talent lens below already prices his category production cleanly
        // (it's the same number Upside uses); walkSeasons only needs to answer
        // "how good is his WAR/market read," not re-litigate his category stats.
        const anchorPv = (oBase * oHaircut + (L.savesPremium ?? 0)) * oPvMults;
        const annualPeakVal = anchorPv / Math.max(0.05, futureSeasonShape(inp.age, inp.isPitcher));
        // Today's park is a good bet for NEXT season and a coin flip five years
        // out — players change uniforms ~25%/yr (trades, free agency) — so the
        // park edge/dock fades toward neutral at that rate instead of riding his
        // whole career (Tom, 2026-08-09). Now keeps the full park (he plays
        // there this season); the peak-priced lens was always park-neutral.
        walkSeasons = Array.from({ length: horizon }, (_, i) =>
          annualPeakVal * futureSeasonShape(inp.age! + i + 1, inp.isPitcher) * (surv[i] ?? 1)
          * (1 + (hp - 1) * Math.pow(0.75, i + 1)));
      }
    }
    // 2) FULL-OPPORTUNITY (talent) lens — for EVERYONE (Tom, 2026-08-13):
    //    price his peak WAR / wRC+ / HR / SB / ERA-20 as an everyday MLB
    //    player through the same machinery that prices Now — market, playing
    //    time and role docks all stripped. His auction $ and observed role
    //    describe his CIRCUMSTANCES, not his talent (Emmet Sheehan demoted
    //    behind the Dodgers' rotation depth is a fact about the Dodgers).
    //    Pre-peak players price at peak age with the ramp + arrival deferral
    //    bending the season vector (bust/wait risk lives in Keep/Overall, so
    //    their Upside stays the undiscounted ceiling); established players
    //    age their peak metrics along the curve × survival from today.
    //    (Tom, 2026-08-18): the anchor is now the SAME category-only ceiling
    //    the standalone Upside chip uses (upsideValueScale) — Keep/Overall's
    //    "how much of his ceiling does he get" blend and the displayed Upside
    //    are always talking about the same number.
    let peakSeasons: number[] | undefined;
    let closerBonus = 0;
    const peakVal = upsideValueScale(inp, s);
    {
      const defer = keeperDeferral(inp.age, inp.level, inp.isPitcher, s.rebuilder);
      const survT = L.isMLB ? (base.surv ?? []) : []; // prospects: defer already carries the risk
      closerBonus = closerTrajectoryBonus(inp, isPureReliever(inp), L.savesPremium ?? 0);
      peakSeasons = Array.from({ length: horizon }, (_, i) =>
        peakVal * futureSeasonShape(inp.age! + i + 1, inp.isPitcher) * defer * (survT[i] ?? 1)
        + closerBonus * (survT[i] ?? 1));
    }
    // OPPORTUNITY CONFIDENCE (Tom, 2026-08-13): past ~5 WAR (hitters) / ~4
    // (pitchers — pitcher talent maps more directly onto WAR) an in-prime
    // player essentially cannot lose his job, so future seasons defer fully
    // to the fantasy skills; below that, blend from his OBSERVED walk-forward
    // seasons toward the full-opportunity talent seasons in proportion to the
    // confidence. Pre-peak/prospects stay fully talent-priced (arrival
    // deferral already hedges them). The blend can only lift a season — a
    // player whose observed value exceeds his talent price keeps it.
    // (Tom, 2026-08-18): hitters key off the SAME current-form-scaled WAR proxy
    // Now's confidence uses (not raw peak WAR) — a proven vet reads his real
    // current standing, not a Lara-style peak-WAR overcredit; pitchers still
    // use peak WAR directly (skill translates close to mature value fast).
    const oppW = !L.isMLB || inp.age < 26 ? 1 : talentConfidence(currentWarProxy(inp, L.rosWrc), inp.isPitcher);
    // Capped at the ceiling lens (Tom, 2026-08-19): peakSeasons IS the full-
    // opportunity ceiling for that season — no blend should be able to exceed
    // it, walk-forward included. Mostly a belt-and-suspenders invariant now
    // that the anchor fix above addresses the actual cause, but a real one:
    // "used" exceeding "talent" should be structurally impossible.
    const seasons = Array.from({ length: horizon }, (_, i) => {
      const wk = walkSeasons?.[i] ?? 0;
      const peak = peakSeasons?.[i] ?? 0;
      return Math.min(peak, wk + oppW * Math.max(0, peak - wk));
    });
    // Keep: the YEAR_DISCOUNT-weighted per-season combination of the future
    // seasons (this one excluded) — "what he's worth per year going forward,
    // near years counting most". Same scale as Now by construction. For a
    // pre-peak player the window starts `shift` seasons in (cover-the-peak,
    // see above), so the weights read his prime, not his ramp.
    let wSum = 0, vSum = 0, w = 1;
    for (let k = shift; k < shift + KEEPER_HORIZON; k++) { w *= YEAR_DISCOUNT; wSum += w; vSum += w * seasons[k]; }
    future = Math.max(0, vSum / wSum);
    // Upside chip (Tom, 2026-08-18): full-PT category-only ceiling, standalone
    // — no WAR/market/park, no blend with the walk-forward lens. See
    // upsideValueScale above.
    outlook = { next2: rr((seasons[0] + seasons[1]) / 2), peakSeason: rr(peakVal) };
    // Overall: cumulative discounted surplus over the waiver line across the
    // whole career (see the OV_* block) + the roster-spot baseline, front-
    // loaded onto this season + next (Tom, 2026-08-18) via ovWeight(). The
    // waiver line scales with league depth (mirrors the trade calc's
    // depthFactor): in a 10-team league the freely-available player is ~2×
    // better, so fringe MLB guys stop banking phantom career surplus (Akil
    // Baddoo out-ranked Trea Turner, 2026-08-13).
    const ovRepl = OV_REPL * Math.sqrt(560 / Math.max(1, s.teams * s.keepers));
    let ovSum = Math.max(0, present - ovRepl);
    for (let k = 0; k < seasons.length; k++) ovSum += ovWeight(k + 1) * Math.max(0, seasons[k] - ovRepl);
    overall = Math.min(present, ovRepl) + ovSum / OV_NORM;
    if (withExplain) {
      const survAll = base.surv ?? [];
      explain = {
        now: {
          base: base.present, marketLed: inExport,
          fantasy: prodTerm, saves: L.savesPremium ?? 0,
          ptHaircut, injuryMult, pvMults,
          rateMode: hitterRate !== undefined, ratePerPA: hitterRate, paFrac, conf,
        },
        engine: {
          oppW, talentNow: peakVal, shift, closerBonus,
          seasons: seasons.slice(0, 8).map((used, i) => ({
            age: inp.age! + i + 1,
            observed: walkSeasons?.[i] ?? 0,
            talent: peakSeasons?.[i] ?? 0,
            used,
            surv: survAll[i] ?? 1,
          })),
          overall: { repl: ovRepl, baseline: Math.min(present, ovRepl), surplus: ovSum / OV_NORM },
        },
      };
    }
  } else {
    // LEGACY fallback (age unknown — rare): the old slot-economics keeper value,
    // the durability-tilted ceiling floored by sustained production. Kept only
    // because the season engine can't walk an ageless player forward.
    const durable = warDurability(inp.war ?? 0, inp.isPitcher ? undefined : inp.position);
    const ceiling = base.future * (L.fvPtFactor ?? 1) * durable;
    const sustainTaper = clamp(((inp.war ?? 0) - 0.4) / 1.4, 0, 1);
    const healthyPv = (base.present * ptHaircut + DYN_W * fantasyProd(inp, L, FORMAT[s.format]) + (L.savesPremium ?? 0)) * pvMults;
    const FLOOR_REPL = 0.7; // per-season roster-spot value (mirrors the trade calc's PV replacement)
    const annualPv = healthyPv / presentMaturity(inp.age);
    const sustained = sustainTaper
      * keeperSeasons(inp.age, inp.isPitcher, (ret) => Math.max(0, (annualPv + FLOOR_REPL) * ret - FLOOR_REPL), base.surv);
    const savesFv = (L.savesPremium ?? 0) * 0.45 * keeperAgeFactor(inp.age, true);
    future = (Math.max(ceiling, sustained) + savesFv) * (L.armFvMult ?? 1);
    overall = overallValue(present, future);
  }
  return { present, future, overall, outlook, explain };
}
