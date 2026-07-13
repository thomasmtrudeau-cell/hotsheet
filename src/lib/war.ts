import { FollowedPlayer, PremiumMetrics, RegressionRow } from './types';
import { AUCTION_VALUES, AuctionRole } from './auction-values';

// Peak WAR pulled live from a published Google Sheet (two tabs). Premium-only;
// the API route enforces that. Dormant unless WAR_SHEET_ID is configured.

const HIT_TAB = 'Peak Hitting';
const PIT_TAB = 'Peak Pitching';

// Normalize a player name for joining sheet rows to followed players: drop
// diacritics, punctuation, and generational suffixes; lowercase; collapse space.
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields + embedded commas).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Build normalizedName -> premium metrics from one tab's CSV. `nameHeader`
// locates the name column. WAR is the header that trims to exactly "WAR". The
// role-specific extra metric is peak wRC+ (hitting, header "wRC+") or ERA/20 TBF
// (pitching, header "era 20 tbf/g") — matched exactly so the many "current
// year"/"no reg" variants in the sheet are never picked up by mistake.
// A row is "stale" (a duplicate to skip) when its id is NOT a clean numeric id:
// either blank OR prefixed "sa" (the old minor-league id kept after a promotion).
// The sheet sometimes has both the stale row and the correct numeric-id row for
// the same player (name-change cases like Lee, Antonacci, Ingle) — e.g. a blank
// "Hao-Yu Lee" (2.7) alongside the real "Hao Yu Lee" id 30080 (2.24). Prefer the
// row with a real numeric id.
function isStaleId(id: string): boolean {
  const t = id.trim();
  return t === '' || /^sa/i.test(t);
}

// --- Value model: Present Value (win-now) + Future Value (keeper) ---
// Context: 28-keeper, 20-team league (~560 keepers), so "replacement" isn't a raw
// 2.4-WAR line — the 2.4-WAR guys on the wire are stuck in bad roles or the
// minors. A healthy MLB regular clears that bar on role alone.
//  - Present Value: current-year production, and only really counts if he's in
//    the majors now (a great AA line doesn't help you win this week).
//  - Future Value: peak (true-talent) ceiling, aged + discounted by distance to
//    the majors — the keeper/dynasty number.
function ageMultiplier(age?: number): number {
  if (age === undefined) return 1.0;
  if (age <= 22) return 1.25;
  if (age <= 25) return 1.15;
  if (age <= 28) return 1.0;
  if (age <= 31) return 0.9;
  return 0.8;
}

function proximityMultiplier(level?: string): number {
  const l = (level ?? '').toUpperCase();
  if (l.includes('MLB') || l.includes('MAJOR')) return 1.0;
  if (l.includes('AAA')) return 0.92;
  if (l.includes('AA')) return 0.82;
  if (l.includes('A+') || l.includes('HIGH')) return 0.72;
  if (l.includes('A')) return 0.62;
  return 0.5;
}

// How much a player's current production translates to present value — MLB is
// the only place it fully counts.
function presentLevelFactor(level?: string): number {
  const l = (level ?? '').toUpperCase();
  if (l.includes('MLB') || l.includes('MAJOR')) return 1.0;
  if (l.includes('AAA')) return 0.3;
  return 0.1;
}

// Market-vetted present value from the auction calculator. Auction $ is
// cross-position calibrated (a dollar is a dollar), which our production-based
// PV is NOT — hitter wRC+ and pitcher ERA/20 live on different scales, so a
// star hitter used to read far above a comparable ace. We subtract the role's
// free-agent line (freely available on the wire) and normalize to the PV scale.
const FA_LINE: Record<AuctionRole, number> = { SP: 1, RP: 3, HIT: 5 };
const AUCTION_DIV = 5; // $ above the FA line per 1.0 of present value
const MARKET_WEIGHT = 0.6; // how much the market baseline drives present value
function marketPv(auctionId?: string): number | undefined {
  if (!auctionId) return undefined;
  const a = AUCTION_VALUES[auctionId.trim()];
  if (!a) return undefined;
  return Math.max(0, a.d - FA_LINE[a.r]) / AUCTION_DIV;
}

function computePvFv(opts: {
  isPitcher: boolean; war?: number; peakWrcPlus?: number; hr?: number; sb?: number; era20?: number;
  curWrcPlus?: number; curEra20?: number; age?: number; level?: string; auctionId?: string;
}): { present: number; future: number } | undefined {
  if (opts.war === undefined) return undefined;

  // Future value: peak WAR above the ~2.0 keeper bar (a 28×20 keeper league keeps
  // ~560 players, so a sub-2-WAR ceiling is barely keepable). Fantasy is a bonus
  // that mostly only helps players already over the bar — it shouldn't rescue an
  // aging 1.8-WAR bat into keeper relevance.
  const KEEPER_BAR = 2.0;
  let fantasy = 0;
  if (opts.isPitcher) { if (opts.era20 !== undefined) fantasy = Math.max(0, 4.0 - opts.era20); }
  else {
    if (opts.peakWrcPlus !== undefined) fantasy += Math.max(0, (opts.peakWrcPlus - 100) / 20);
    if (opts.hr !== undefined) fantasy += opts.hr / 25;
    if (opts.sb !== undefined) fantasy += opts.sb / 25;
  }
  const warTerm = Math.max(0, opts.war - KEEPER_BAR) * 3;
  const fantasyTerm = fantasy * (opts.war > KEEPER_BAR ? 1 : 0.15);
  const future = (warTerm + fantasyTerm) * ageMultiplier(opts.age) * proximityMultiplier(opts.level);

  // Present value: current-year production (fall back to peak if no current data).
  let prod = 0;
  if (opts.isPitcher) {
    const e = opts.curEra20 ?? opts.era20;
    if (e !== undefined) prod = Math.max(0, (5.0 - e) * 2);
  } else {
    const w = opts.curWrcPlus ?? opts.peakWrcPlus;
    if (w !== undefined) prod = Math.max(0, (w - 85) / 8);
  }
  const productionPv = prod * presentLevelFactor(opts.level);

  // Blend the market baseline in as a frame of reference. Auction $ assumes a
  // static full-season role; our dynamic PT/injury/job-security discounts (applied
  // downstream) are what handle the day-to-day risk a low-WAR guy actually carries,
  // so we only borrow the market's cross-position calibration here.
  const mkt = marketPv(opts.auctionId);
  const present = mkt !== undefined ? MARKET_WEIGHT * mkt + (1 - MARKET_WEIGHT) * productionPv : productionPv;

  const r = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
  return { present: r(present), future: r(future) };
}

function parseTab(csv: string, nameHeader: string, isPitcher: boolean): Map<string, PremiumMetrics> {
  const rows = parseCsv(csv);
  const out = new Map<string, PremiumMetrics>();
  const keptStale = new Map<string, boolean>(); // did the kept row for this name use an "sa" id?
  if (rows.length < 2) return out;
  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => h.toLowerCase() === nameHeader);
  const idIdx = header.findIndex((h) => h.toLowerCase() === 'id');
  const warIdx = header.findIndex((h) => h === 'WAR');
  const extraIdx = isPitcher
    ? header.findIndex((h) => h === 'era 20 tbf/g')
    : header.findIndex((h) => h === 'wRC+');
  // Hitter tool tags (peak projections): elite SB/600 → Speed, elite HR → Power,
  // and DEF (bidirectional defensive value).
  const sbIdx = isPitcher ? -1 : header.findIndex((h) => h === 'SB/600');
  const hrIdx = isPitcher ? -1 : header.findIndex((h) => h === 'HR');
  const defIdx = isPitcher ? -1 : header.findIndex((h) => h === 'DEF');
  // Age column: hitting sheet uses "max age", pitching sheet uses "age".
  let ageIdx = header.findIndex((h) => h.toLowerCase() === 'max age');
  if (ageIdx < 0) ageIdx = header.findIndex((h) => h.toLowerCase() === 'age');
  const levelIdx = header.findIndex((h) => h.toLowerCase() === 'highest level');
  const curWrcIdx = isPitcher ? -1 : header.findIndex((h) => h === 'wRC+ - current year only');
  const curEraIdx = isPitcher ? header.findIndex((h) => h === 'era 20 tbf/g - current year') : -1;
  if (nameIdx < 0) return out;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = cells[nameIdx];
    if (!name) continue;
    const m: PremiumMetrics = {};
    if (warIdx >= 0) {
      const war = parseFloat(cells[warIdx]);
      if (Number.isFinite(war)) m.war = war;
    }
    if (extraIdx >= 0) {
      const v = parseFloat(cells[extraIdx]);
      if (Number.isFinite(v)) {
        if (isPitcher) m.era20 = v;
        else m.peakWrcPlus = Math.round(v);
      }
    }
    // Tool grades from peak projections (percentile-calibrated): plus ≈ top ~12%,
    // double-plus ≈ top ~3-4%.
    const sbVal = sbIdx >= 0 ? parseFloat(cells[sbIdx]) : NaN;
    const hrVal = hrIdx >= 0 ? parseFloat(cells[hrIdx]) : NaN;
    if (Number.isFinite(sbVal)) m.speed = sbVal >= 34 ? 'double-plus' : sbVal >= 24 ? 'plus' : undefined;
    if (Number.isFinite(hrVal)) m.power = hrVal >= 30 ? 'double-plus' : hrVal >= 22 ? 'plus' : undefined;
    // Dual-threat: genuine power+speed combo (both ≥12), 30+ = plus, 40+ = elite.
    if (Number.isFinite(sbVal) && Number.isFinite(hrVal) && sbVal >= 12 && hrVal >= 12) {
      const combined = sbVal + hrVal;
      m.dual = combined >= 40 ? 'double-plus' : combined >= 30 ? 'plus' : undefined;
    }
    if (defIdx >= 0) {
      const d = parseFloat(cells[defIdx]);
      if (Number.isFinite(d)) {
        m.def = d >= 8 ? 'double-plus' : d >= 4 ? 'plus' : d <= -9 ? 'double-minus' : d <= -5 ? 'minus' : undefined;
      }
    }
    const age = ageIdx >= 0 ? parseFloat(cells[ageIdx]) : NaN;
    const curWrc = curWrcIdx >= 0 ? parseFloat(cells[curWrcIdx]) : NaN;
    const curEra = curEraIdx >= 0 ? parseFloat(cells[curEraIdx]) : NaN;
    const tv = computePvFv({
      isPitcher, war: m.war, peakWrcPlus: m.peakWrcPlus,
      hr: Number.isFinite(hrVal) ? hrVal : undefined,
      sb: Number.isFinite(sbVal) ? sbVal : undefined,
      era20: m.era20,
      curWrcPlus: Number.isFinite(curWrc) ? curWrc : undefined,
      curEra20: Number.isFinite(curEra) ? curEra : undefined,
      age: Number.isFinite(age) ? age : undefined,
      level: levelIdx >= 0 ? cells[levelIdx] : undefined,
      auctionId: idIdx >= 0 ? cells[idIdx] : undefined,
    });
    if (tv) { m.presentValue = tv.present; m.futureValue = tv.future; }
    if (m.war === undefined && m.era20 === undefined && m.peakWrcPlus === undefined) continue;
    const key = normalizeName(name);
    const stale = idIdx >= 0 ? isStaleId(cells[idIdx] ?? '') : false;
    // On a duplicate name, only overwrite when the kept row was the stale (sa)
    // dup and this one is the correct (non-sa) row.
    if (out.has(key) && !(keptStale.get(key) && !stale)) continue;
    out.set(key, m);
    keptStale.set(key, stale);
  }
  return out;
}

// Short in-memory cache of the parsed sheet, keyed by sheet id. Kept brief so
// edits to the Google Sheet surface on the site within ~a minute. Hitting and
// pitching are kept SEPARATE — some names appear in both (position players who
// pitched), so we must pick metrics by the player's actual role, not merge.
let cache: { sheetId: string; at: number; hitters: Map<string, PremiumMetrics>; pitchers: Map<string, PremiumMetrics> } | null = null;
const TTL = 60_000; // 1 minute

async function fetchCsvTab(sheetId: string, tab: string): Promise<string> {
  // Cache-bust Google's CDN and bypass Next's fetch cache so we always read the
  // latest published sheet, not a stale copy.
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_cb=${Date.now()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HotSheet/1.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`WAR sheet fetch ${res.status}`);
  return res.text();
}

async function getPremiumMaps(sheetId: string): Promise<{ hitters: Map<string, PremiumMetrics>; pitchers: Map<string, PremiumMetrics> }> {
  const now = Date.now();
  if (cache && cache.sheetId === sheetId && now - cache.at < TTL) return cache;
  const [hitCsv, pitCsv] = await Promise.all([
    fetchCsvTab(sheetId, HIT_TAB),
    fetchCsvTab(sheetId, PIT_TAB),
  ]);
  const hitters = parseTab(hitCsv, 'name', false);
  const pitchers = parseTab(pitCsv, 'player', true);
  cache = { sheetId, at: now, hitters, pitchers };
  return cache;
}

export interface WarRow {
  nameKey: string;
  displayName: string;
  isPitcher: boolean;
  level?: string;
  war: number;
}

// Parse one tab into snapshot rows (name + WAR + highest level), deduped by name
// preferring the correct (non-"sa") id — same rule as the display join — so the
// daily snapshot never stores the stale dup's WAR.
function parseRows(csv: string, nameHeader: string, isPitcher: boolean): WarRow[] {
  const rows = parseCsv(csv);
  const byKey = new Map<string, WarRow>();
  const keptStale = new Map<string, boolean>();
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => h.toLowerCase() === nameHeader);
  const idIdx = header.findIndex((h) => h.toLowerCase() === 'id');
  const warIdx = header.findIndex((h) => h === 'WAR');
  const lvlIdx = header.findIndex((h) => h.toLowerCase() === 'highest level');
  if (nameIdx < 0 || warIdx < 0) return [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = cells[nameIdx];
    const war = parseFloat(cells[warIdx]);
    if (!name || !Number.isFinite(war)) continue;
    const key = normalizeName(name);
    const stale = idIdx >= 0 ? isStaleId(cells[idIdx] ?? '') : false;
    if (byKey.has(key) && !(keptStale.get(key) && !stale)) continue;
    byKey.set(key, { nameKey: key, displayName: name, isPitcher, level: lvlIdx >= 0 ? cells[lvlIdx] : undefined, war });
    keptStale.set(key, stale);
  }
  return [...byKey.values()];
}

// All WAR rows (both tabs) for a daily snapshot.
export async function getWarRows(sheetId: string): Promise<WarRow[]> {
  const [hitCsv, pitCsv] = await Promise.all([fetchCsvTab(sheetId, HIT_TAB), fetchCsvTab(sheetId, PIT_TAB)]);
  return [...parseRows(hitCsv, 'name', false), ...parseRows(pitCsv, 'player', true)];
}

// Join premium metrics to the given players by normalized name, using the
// role-appropriate sheet (pitchers → Peak Pitching, everyone else → Peak
// Hitting). Hitters carry WAR + peak wRC+; pitchers carry WAR + ERA/20 TBF.
// Returns playerId -> PremiumMetrics.
export async function fetchPremiumMap(
  players: FollowedPlayer[],
  sheetId: string
): Promise<Record<number, PremiumMetrics>> {
  const { hitters, pitchers } = await getPremiumMaps(sheetId);
  const result: Record<number, PremiumMetrics> = {};
  const misses: string[] = [];
  for (const p of players) {
    const key = normalizeName(p.fullName);
    const m = p.primaryPosition === 'P' ? pitchers.get(key) : hitters.get(key);
    if (m) result[p.id] = m;
    else misses.push(p.fullName);
  }
  if (misses.length > 0) console.warn(`Premium: no sheet match for ${misses.length}:`, misses.slice(0, 20));
  return result;
}

// SP regression: peak vs current-year ERA/20 for starters (IP/G ≥ 3.5). Sell-highs
// are pitching well UNDER their true-talent projection (regression up looms);
// buy-lows are pitching OVER it (positive regression). Premium.
export async function getSpRegression(sheetId: string): Promise<{ sellHighs: RegressionRow[]; buyLows: RegressionRow[] }> {
  const csv = await fetchCsvTab(sheetId, PIT_TAB);
  const rows = parseCsv(csv);
  if (rows.length < 2) return { sellHighs: [], buyLows: [] };
  const h = rows[0].map((x) => x.trim());
  const pi = h.findIndex((x) => x.toLowerCase() === 'player');
  const peakI = h.findIndex((x) => x === 'era 20 tbf/g');
  const curI = h.findIndex((x) => x === 'era 20 tbf/g - current year');
  const ipgI = h.findIndex((x) => x === 'IP/G');
  const lvlI = h.findIndex((x) => x.toLowerCase() === 'highest level');
  const idI = h.findIndex((x) => x.toLowerCase() === 'id');
  if (pi < 0 || peakI < 0 || curI < 0) return { sellHighs: [], buyLows: [] };

  const byKey = new Map<string, RegressionRow>();
  const keptStale = new Map<string, boolean>();
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const name = c[pi]?.trim();
    if (!name) continue;
    const peak = parseFloat(c[peakI]);
    const cur = parseFloat(c[curI]);
    const ipg = ipgI >= 0 ? parseFloat(c[ipgI]) : NaN;
    if (!Number.isFinite(peak) || !Number.isFinite(cur)) continue;
    if (Number.isFinite(ipg) && ipg < 3.5) continue; // starters only
    const key = normalizeName(name);
    const stale = idI >= 0 ? isStaleId(c[idI] ?? '') : false;
    if (byKey.has(key) && !(keptStale.get(key) && !stale)) continue;
    byKey.set(key, { nameKey: key, player: name, level: lvlI >= 0 ? c[lvlI] : undefined, peakEra20: peak, currentEra20: cur, delta: cur - peak });
    keptStale.set(key, stale);
  }
  const all = [...byKey.values()];
  return {
    sellHighs: all.filter((x) => x.delta <= -0.3).sort((a, b) => a.delta - b.delta).slice(0, 40),
    buyLows: all.filter((x) => x.delta >= 0.3).sort((a, b) => b.delta - a.delta).slice(0, 40),
  };
}

// WAR-only join (playerId -> WAR), used to sort the call-up / promotion
// discovery lists. Kept separate so those routes don't ship the richer metrics.
export async function fetchWarMap(
  players: FollowedPlayer[],
  sheetId: string
): Promise<Record<number, number>> {
  const map = await fetchPremiumMap(players, sheetId);
  const result: Record<number, number> = {};
  for (const [id, m] of Object.entries(map)) {
    if (m.war !== undefined) result[Number(id)] = m.war;
  }
  return result;
}
