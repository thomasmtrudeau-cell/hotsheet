import { FollowedPlayer, PremiumMetrics, ProspectRanks, MetricRank, RegressionRow, HitterRegressionRow, ScoutingRow, ToolGrade, DefGrade } from './types';
import { AUCTION_VALUES } from './auction-values';
import { computeValue, DEFAULT_SETTINGS, FA_LINE, AUCTION_DIV } from './value-model';
import { getNamePositionPairs } from './player-index';

// Peak WAR pulled live from a published Google Sheet (two tabs). Premium-only;
// the API route enforces that. Dormant unless WAR_SHEET_ID is configured.
// Source since 2026-07-14: the "StS Source Data" spreadsheet's raw tabs (updates
// more easily than the old Hot Sheet Projections file). Same header contract:
// hitting has one exact "WAR" col + "DEF" + "wRC+"; pitching WAR is "WAR (20 TBFG)".

const HIT_TAB = 'peak hitting raw';
const CUR_HIT_TAB = '2025 hitting raw'; // authoritative CURRENT-year hitter projection (per Jordan) — peak tab lacks it, so hitter PV was running on peak rate
const PIT_TAB = 'pitching raw';

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
// Market baseline from the auction calculator — cross-position calibrated ($ is
// a $). We subtract the role's free-agent line (freely available on the wire)
// and normalize to the PV scale; computeValue() blends it in. Kept here because
// the auction table + FA lines are server-side reference data.
// Hitter replacement line is $3 (not $5): the $4–5 auction bats are typically guys
// we don't trust to actually get the playing time, so the real "freely available"
// line sits lower — anyone above $3 carries some market value.
function marketBaselineFor(auctionId?: string): number | undefined {
  if (!auctionId) return undefined;
  const a = AUCTION_VALUES[auctionId.trim()];
  if (!a) return undefined;
  return Math.max(0, a.d - FA_LINE[a.r]) / AUCTION_DIV;
}

// Pitcher WAR lives in the column labeled 'WAR (20 TBFG)' (col BB) — the
// reliever-adjusted figure. The plain 'WAR' columns under-credit relievers
// (Griffin Jax reads 1.6 there vs 2.69 here; Clase 2.15 vs 3.52). But some
// pitchers have a BLANK 'WAR (20 TBFG)' cell (e.g. an injured arm whose per-20-TBF
// normalization didn't compute) while the plain 'WAR' is populated — so we read
// the 20-TBFG value per row and fall back to plain 'WAR' when it's empty, rather
// than dropping the player entirely. Hitters just use plain 'WAR'.
function warCols(header: string[], isPitcher: boolean): { primary: number; fallback: number } {
  const plain = header.findIndex((h) => h === 'WAR');
  if (isPitcher) {
    const tbfg = header.findIndex((h) => h === 'WAR (20 TBFG)');
    return { primary: tbfg >= 0 ? tbfg : plain, fallback: plain };
  }
  return { primary: plain, fallback: plain };
}
function readWar(cells: string[], wc: { primary: number; fallback: number }): number {
  let w = wc.primary >= 0 ? parseFloat(cells[wc.primary]) : NaN;
  if (!Number.isFinite(w) && wc.fallback >= 0 && wc.fallback !== wc.primary) w = parseFloat(cells[wc.fallback]);
  return w;
}

function parseTab(csv: string, nameHeader: string, isPitcher: boolean): Map<string, PremiumMetrics> {
  const rows = parseCsv(csv);
  const out = new Map<string, PremiumMetrics>();
  const keptStale = new Map<string, boolean>(); // did the kept row for this name use an "sa" id?
  if (rows.length < 2) return out;
  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => h.toLowerCase() === nameHeader);
  const idIdx = header.findIndex((h) => h.toLowerCase() === 'id');
  const warCol = warCols(header, isPitcher);
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
  const ipgIdx = isPitcher ? header.findIndex((h) => h === 'IP/G') : -1;
  const rpWarIdx = isPitcher ? header.findIndex((h) => h === 'RP WAR') : -1;
  const curWrcIdx = isPitcher ? -1 : header.findIndex((h) => h === 'wRC+ - current year only');
  const curEraIdx = isPitcher ? header.findIndex((h) => h === 'era 20 tbf/g - current year') : -1;
  if (nameIdx < 0) return out;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = cells[nameIdx];
    if (!name) continue;
    const m: PremiumMetrics = {};
    const war = readWar(cells, warCol);
    if (Number.isFinite(war)) m.war = war;
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
        m.def = d >= 6 ? 'double-plus' : d >= 2 ? 'plus' : d <= -6 ? 'double-minus' : d <= -2 ? 'minus' : undefined;
      }
    }
    const age = ageIdx >= 0 ? parseFloat(cells[ageIdx]) : NaN;
    const curWrc = curWrcIdx >= 0 ? parseFloat(cells[curWrcIdx]) : NaN;
    const curEra = curEraIdx >= 0 ? parseFloat(cells[curEraIdx]) : NaN;
    // Stash the raw value-model inputs so the client can recompute PV/FV against
    // the user's league settings.
    if (Number.isFinite(hrVal)) m.hr = hrVal;
    if (Number.isFinite(sbVal)) m.sb = sbVal;
    if (Number.isFinite(curWrc)) m.curWrcPlus = curWrc;
    if (Number.isFinite(curEra)) m.curEra20 = curEra;
    if (levelIdx >= 0 && cells[levelIdx]) m.level = cells[levelIdx];
    if (Number.isFinite(age)) m.age = age;
    const mkt = marketBaselineFor(idIdx >= 0 ? cells[idIdx] : undefined);
    if (mkt !== undefined) m.marketBaseline = mkt;
    if (defIdx >= 0) { const dv = parseFloat(cells[defIdx]); if (Number.isFinite(dv)) m.defRuns = dv; }
    if (idIdx >= 0) {
      const av = AUCTION_VALUES[String(cells[idIdx] ?? '').trim()];
      if (av) m.auctionRaw = av.d;
      if (!isPitcher) { if (av?.pos) m.pos = av.pos; if (av?.pa !== undefined) m.pa = av.pa; }
      else if (av?.ip !== undefined) m.ip = av.ip;
    }
    if (ipgIdx >= 0) { const iv = parseFloat(cells[ipgIdx]); if (Number.isFinite(iv)) m.ipg = iv; }
    // PURE-RP WAR (Jordan, 2026-08-07): the sheet's 'RP WAR' column prices the
    // arm at actual reliever usage (no leverage baked in). It's populated for
    // EVERY pitcher ("his WAR if used in relief" — Skubal has one too), so only
    // a pure RP (IP/G < 2.01) takes it — his 20-TBFG figure is starter-workload
    // talent he'll never cash (Morejón read 4.4). rpWar tells the value model
    // the role conversion is already priced, so it must not dock again.
    if (isPitcher && rpWarIdx >= 0 && m.ipg !== undefined && m.ipg < 2.01) {
      const rw = parseFloat(cells[rpWarIdx]);
      if (Number.isFinite(rw)) { m.war = rw; m.rpWar = true; }
    }
    // Bake a DEFAULT-settings PV/FV as the payload fallback (position unknown at
    // parse time, so scarcity is neutral here; the client refines it).
    if (m.war !== undefined) {
      const tv = computeValue({
        isPitcher, war: m.war, rpWar: m.rpWar, peakWrcPlus: m.peakWrcPlus, era20: m.era20,
        hr: m.hr, sb: m.sb, curWrcPlus: m.curWrcPlus, curEra20: m.curEra20,
        age: m.age, level: m.level, marketBaseline: m.marketBaseline,
        pa: m.pa, auctionRaw: m.auctionRaw,
      }, DEFAULT_SETTINGS);
      m.presentValue = tv.present; m.futureValue = tv.future;
    }
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

// Competition-style ranking (ties share the better rank) over one metric.
// Only players carrying the metric count toward `of`.
function rankBy<T>(items: T[], val: (t: T) => number | undefined, asc = false): Map<T, MetricRank> {
  const ranked = items
    .map((t) => ({ t, v: val(t) }))
    .filter((x): x is { t: T; v: number } => x.v !== undefined && Number.isFinite(x.v));
  ranked.sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
  const out = new Map<T, MetricRank>();
  for (let i = 0, r = 1; i < ranked.length; i++) {
    if (i > 0 && ranked[i].v !== ranked[i - 1].v) r = i + 1;
    out.set(ranked[i].t, { r, of: ranked.length });
  }
  return out;
}

// Stamp every player's rank in the StS universe onto his metrics, per role
// population: hitters on peak WAR / peak wRC+ / combined HR+SB, pitchers on
// peak WAR / ERA-20 (ascending). Runs once per sheet parse, so the snapshot,
// /api/war, and the scouting join all carry the SAME ranks.
function assignProspectRanks(hitters: Map<string, PremiumMetrics>, pitchers: Map<string, PremiumMetrics>): void {
  const hs = [...hitters.values()], ps = [...pitchers.values()];
  const hWar = rankBy(hs, (m) => m.war);
  const hWrc = rankBy(hs, (m) => m.peakWrcPlus);
  const hHrSb = rankBy(hs, (m) => (m.hr !== undefined && m.sb !== undefined ? m.hr + m.sb : undefined));
  const hHr = rankBy(hs, (m) => m.hr);
  const hSb = rankBy(hs, (m) => m.sb);
  for (const m of hs) {
    const ranks: ProspectRanks = {};
    const w = hWar.get(m); if (w) ranks.war = w;
    const c = hWrc.get(m); if (c) ranks.wrc = c;
    const d = hHrSb.get(m); if (d) ranks.hrSb = d;
    const h = hHr.get(m); if (h) ranks.hr = h;
    const b = hSb.get(m); if (b) ranks.sb = b;
    if (ranks.war || ranks.wrc || ranks.hrSb) m.ranks = ranks;
  }
  const pWar = rankBy(ps, (m) => m.war);
  const pEra = rankBy(ps, (m) => m.era20, true);
  for (const m of ps) {
    const ranks: ProspectRanks = {};
    const w = pWar.get(m); if (w) ranks.war = w;
    const e = pEra.get(m); if (e) ranks.era = e;
    if (ranks.war || ranks.era) m.ranks = ranks;
  }
}

// Short in-memory cache of the parsed sheet, keyed by sheet id. Kept brief so
// edits to the Google Sheet surface on the site within ~a minute. Hitting and
// pitching are kept SEPARATE — some names appear in both (position players who
// pitched), so we must pick metrics by the player's actual role, not merge.
let cache: { sheetId: string; at: number; hitters: Map<string, PremiumMetrics>; pitchers: Map<string, PremiumMetrics> } | null = null;
const TTL = 600_000; // 10 minutes — the sheet updates a few times a day, not by the second

// The published sheet's htmlview embeds every tab's name and gid (shared with
// oopsy.ts, which pioneered the name→gid lookup after the 7/27 dead-gid trap).
export type SheetTab = { name: string; gid: string };
export async function fetchSheetTabs(sheetId: string): Promise<SheetTab[]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, { headers: { 'User-Agent': 'HotSheet/1.0' }, cache: 'no-store' });
  if (!res.ok) return [];
  const html = await res.text();
  const tabs: SheetTab[] = [];
  const re = /\{name: "([^"]*)", pageUrl: "[^"]*?gid=(\d+)/g;
  let m;
  while ((m = re.exec(html))) tabs.push({ name: m[1].replace(/\\\//g, '/'), gid: m[2] });
  return tabs;
}

// gviz/tq?tqx=out:csv RESPECTS an active basic filter on the tab. 2026-07-31 a
// filter left on 'peak hitting raw' hid every established MLB hitter from gviz
// (Tom saw the full tab; the app got 3.4k prospect rows) — Kwan priced at 0.0
// and the stale sa-id Hao-Yu Lee dup was the only Lee left to serve. The
// /export?format=csv endpoint ignores filters and returns the full grid, so it
// is the primary read; gviz-by-tab-name survives only as the fallback when the
// htmlview gid lookup fails.
let tabGidCache: { sheetId: string; at: number; byName: Map<string, string> } | null = null;
const TAB_GID_TTL = 6 * 3600_000;
async function gidFor(sheetId: string, tab: string): Promise<string | undefined> {
  if (!tabGidCache || tabGidCache.sheetId !== sheetId || Date.now() - tabGidCache.at > TAB_GID_TTL) {
    try {
      const tabs = await fetchSheetTabs(sheetId);
      if (tabs.length > 0) tabGidCache = { sheetId, at: Date.now(), byName: new Map(tabs.map((t) => [t.name.trim().toLowerCase(), t.gid])) };
    } catch { /* keep whatever we had; caller falls back to gviz */ }
  }
  return tabGidCache?.sheetId === sheetId ? tabGidCache.byName.get(tab.trim().toLowerCase()) : undefined;
}

async function fetchCsvTab(sheetId: string, tab: string): Promise<string> {
  const gid = await gidFor(sheetId, tab);
  if (gid !== undefined) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}&_cb=${Math.floor(Date.now() / 3600_000)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'HotSheet/1.0' }, cache: 'no-store' });
    if (res.ok) return res.text();
  }
  // Fallback: gviz by tab name (filter-sensitive — see above — but better than
  // nothing when the htmlview lookup is unavailable). Cache-bust Google's CDN
  // and bypass Next's fetch cache so we always read the latest published sheet.
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_cb=${Math.floor(Date.now() / 3600_000)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HotSheet/1.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`WAR sheet fetch ${res.status}`);
  return res.text();
}

async function getPremiumMaps(sheetId: string): Promise<{ hitters: Map<string, PremiumMetrics>; pitchers: Map<string, PremiumMetrics> }> {
  const now = Date.now();
  if (cache && cache.sheetId === sheetId && now - cache.at < TTL) return cache;
  try {
    const [hitCsv, pitCsv, curHitCsv] = await Promise.all([
      fetchCsvTab(sheetId, HIT_TAB),
      fetchCsvTab(sheetId, PIT_TAB),
      Promise.race([
        fetchCsvTab(sheetId, CUR_HIT_TAB).catch(() => ''),
        new Promise<string>((res) => setTimeout(() => res(''), 4000)), // don't let it gate pricing
      ]),
    ]);
    const hitters = parseTab(hitCsv, 'name', false);
    const pitchers = parseTab(pitCsv, 'player', true);
    // Backfill hitter CURRENT-year wRC+ from the dedicated current tab — the peak
    // tab doesn't carry it, so without this PV's production layer falls back to
    // the PEAK rate (a slumping hitter reads at his ceiling). Joined by name.
    if (curHitCsv) {
      const rows = parseCsv(curHitCsv);
      if (rows.length > 1) {
        const h = rows[0].map((x) => x.trim());
        const ni = h.findIndex((x) => x.toLowerCase() === 'name');
        const ci = h.findIndex((x) => x === 'wRC+ - current year only');
        const ci2 = ci >= 0 ? ci : h.findIndex((x) => x === 'wRC+'); // fall back to the tab's headline current wRC+
        if (ni >= 0 && ci2 >= 0) {
          for (let r = 1; r < rows.length; r++) {
            const nm = rows[r][ni]?.trim();
            if (!nm) continue;
            const cw = parseFloat(rows[r][ci2]);
            const m = hitters.get(normalizeName(nm));
            if (m && Number.isFinite(cw)) m.curWrcPlus = Math.round(cw);
          }
        }
      }
    }
    // A transient bad/empty response must not clobber good data — keep the last
    // good cache rather than blanking every player's metrics to zero. Same for a
    // parse with no established-MLB anchor (a filtered/partial tab read): the
    // prospect rows look plentiful but every regular would price at 0.0.
    const anchored = [...hitters.values()].some((m) => (m.war ?? 0) >= SNAPSHOT_ANCHOR_WAR);
    if ((hitters.size === 0 && pitchers.size === 0) || !anchored) {
      if (cache && cache.sheetId === sheetId) return cache;
    }
    assignProspectRanks(hitters, pitchers);
    cache = { sheetId, at: now, hitters, pitchers };
    return cache;
  } catch (err) {
    if (cache && cache.sheetId === sheetId) {
      console.warn('WAR sheet refetch failed — serving stale cache:', err);
      return cache; // stale-on-error: better slightly old than all-zeros
    }
    throw err;
  }
}

export interface WarRow {
  nameKey: string;
  displayName: string;
  isPitcher: boolean;
  level?: string;
  war: number;
  wrc?: number;    // hitters — peak wRC+ (trend history)
  era20?: number;  // pitchers — peak ERA/20 (trend history)
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
  const warCol = warCols(header, isPitcher);
  const lvlIdx = header.findIndex((h) => h.toLowerCase() === 'highest level');
  const rateIdx = isPitcher
    ? header.findIndex((h) => h === 'era 20 tbf/g')
    : header.findIndex((h) => h === 'wRC+');
  if (nameIdx < 0 || warCol.primary < 0) return [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = cells[nameIdx];
    const war = readWar(cells, warCol);
    if (!name || !Number.isFinite(war)) continue;
    const key = normalizeName(name);
    const stale = idIdx >= 0 ? isStaleId(cells[idIdx] ?? '') : false;
    if (byKey.has(key) && !(keptStale.get(key) && !stale)) continue;
    const rate = rateIdx >= 0 ? parseFloat(cells[rateIdx]) : NaN;
    byKey.set(key, {
      nameKey: key, displayName: name, isPitcher, level: lvlIdx >= 0 ? cells[lvlIdx] : undefined, war,
      wrc: !isPitcher && Number.isFinite(rate) ? Math.round(rate) : undefined,
      era20: isPitcher && Number.isFinite(rate) ? Math.round(rate * 100) / 100 : undefined,
    });
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

// A slim, serializable snapshot of the whole parsed premium sheet — the daily cron
// writes this to Storage so /api/war can join against it instead of pulling ~7MB of
// gviz CSV on every cold start. Keyed by normalized name, same as the live maps.
export interface SnapshotChange {
  at: string;       // when the sheet's numbers last actually differed
  warMoved: number; // players whose WAR moved ≥ 0.05 in that capture
  newPlayers: number;
  topMovers: { name: string; from?: number; to?: number }[];
}
export interface PremiumSnapshot {
  version?: number;
  capturedAt: string; // when this capture was taken (fetch time, not change time)
  lastChange?: SnapshotChange; // carried forward across no-change captures
  hitters: Record<string, PremiumMetrics>;
  pitchers: Record<string, PremiumMetrics>;
}
// Bump to invalidate every stored snapshot at once (consumers reject other
// versions and fall back to the live sheet until a good capture self-heals).
// v2: 2026-07-22 — flushed a capture taken mid-sheet-recalc that was fresh and
// large yet held blank-forfeited dedups (wrong Hao-Yu Lee row, no Doyle).
// v3: 2026-07-26 — snapshots now carry per-metric StS-universe ranks.
// v4: 2026-07-31 — flushed captures taken through gviz while a basic filter on
// 'peak hitting raw' hid every established MLB hitter (Kwan 0.0, stale Lee 2.7).
// v5: 2026-08-07 — pure relievers' WAR now ingested from the sheet's role-priced
// 'RP WAR' column; flush so starter-workload 20-TBFG reliever WARs don't linger.
// v6: 2026-08-13 — per-metric HR/600 and SB/600 ranks added to ProspectRanks.
// v7: 2026-08-19 — auctionRaw added (Now's rate×PA decomposition needs it);
// flush so cached snapshots without it don't silently fall back to the old
// market/WAR blend forever (Rafaela read $21 instead of $17 on a v6 snapshot).
export const SNAPSHOT_VERSION = 7;
// Quality bar shared by every snapshot producer/consumer. The full sheet holds
// ~9k rows (~8k unique names after dedup); a capture taken while the sheet is
// mid-recalc parses far fewer (blank metric cells drop the row), so anything
// under the floor is a broken capture — never serve or store it. Age cap is
// 36h: the cron refreshes daily, so older means the refresh pipeline is broken
// and live data beats a days-old join.
export const SNAPSHOT_MIN_ENTRIES = 3000;
export const SNAPSHOT_MAX_AGE_MS = 36 * 3_600_000;
// A structurally-valid capture can still be missing its ESTABLISHED-MLB rows
// while thousands of prospect rows sail past the size floor (the 07-31 filter
// incident: 3.4k rows, no Judge/Kwan/Soto). A full hitter parse always contains
// at least one 5+ WAR star, so a capture without one is a partial universe.
export const SNAPSHOT_ANCHOR_WAR = 5;
export function snapshotHasMlbAnchor(snap: PremiumSnapshot | null | undefined): boolean {
  return Object.values(snap?.hitters ?? {}).some((m) => (m.war ?? 0) >= SNAPSHOT_ANCHOR_WAR);
}
// The one quality bar every consumer should apply before serving a snapshot.
export function snapshotUsable(snap: PremiumSnapshot | null | undefined): boolean {
  if (!snap || snap.version !== SNAPSHOT_VERSION) return false;
  const fresh = Boolean(snap.capturedAt) && Date.now() - Date.parse(snap.capturedAt) < SNAPSHOT_MAX_AGE_MS;
  return fresh && snapshotSize(snap) >= SNAPSHOT_MIN_ENTRIES && snapshotHasMlbAnchor(snap);
}
export function snapshotSize(snap: PremiumSnapshot | null | undefined): number {
  if (!snap?.hitters || !snap?.pitchers) return 0;
  return Object.keys(snap.hitters).length + Object.keys(snap.pitchers).length;
}
export async function buildPremiumSnapshot(sheetId: string): Promise<PremiumSnapshot> {
  const { hitters, pitchers } = await getPremiumMaps(sheetId);
  return {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    hitters: Object.fromEntries(hitters),
    pitchers: Object.fromEntries(pitchers),
  };
}
// Rebuild the snapshot from the live sheet and store it when it passes the
// quality bar. Shared by the daily cron, the /api/war live-fallback self-heal,
// and the health check's repair path. Returns the stored snapshot, or null
// when the rebuild didn't qualify (caller keeps whatever it had).
// Compare two captures' WAR maps — the "did yesterday's stats actually flow
// through?" signal behind the OOPSY freshness badge. WAR-focused by design;
// null when nothing moved, so the caller carries the previous stamp forward
// (the badge reports real change time, not fetch time).
function diffSnapshots(prev: PremiumSnapshot, next: PremiumSnapshot): SnapshotChange | null {
  const movers: { name: string; from?: number; to?: number; d: number }[] = [];
  let warMoved = 0, newPlayers = 0;
  for (const side of ['hitters', 'pitchers'] as const) {
    const p = prev[side] ?? {}, n = next[side] ?? {};
    for (const [k, m] of Object.entries(n)) {
      const pm = p[k];
      if (!pm) { newPlayers++; continue; }
      if (pm.war === undefined && m.war === undefined) continue;
      const d = Math.abs((pm.war ?? 0) - (m.war ?? 0));
      if (d >= 0.05) { warMoved++; movers.push({ name: k, from: pm.war, to: m.war, d }); }
    }
  }
  if (!warMoved && !newPlayers) return null;
  movers.sort((a, b) => b.d - a.d);
  return { at: next.capturedAt, warMoved, newPlayers, topMovers: movers.slice(0, 5).map(({ name, from, to }) => ({ name, from, to })) };
}
export async function repairPremiumSnapshot(
  sheetId: string,
  storage: { from(bucket: string): {
    upload(path: string, body: string, opts: { upsert: boolean; contentType: string }): Promise<{ error: { message: string } | null }>;
    download(path: string): Promise<{ data: { text(): Promise<string> } | null }>;
  } },
): Promise<PremiumSnapshot | null> {
  const snap = await buildPremiumSnapshot(sheetId);
  if (snapshotSize(snap) < SNAPSHOT_MIN_ENTRIES || !snapshotHasMlbAnchor(snap)) return null;
  // Stamp when the numbers last CHANGED (vs the previous capture, any version —
  // even a flushed-version capture is a valid diff baseline).
  try {
    const { data } = await storage.from('war').download('war_premium.json');
    if (data) {
      const prev = JSON.parse(await data.text()) as PremiumSnapshot;
      snap.lastChange = diffSnapshots(prev, snap) ?? prev.lastChange;
    }
  } catch { /* first capture or unreadable previous — no change stamp yet */ }
  const { error } = await storage.from('war')
    .upload('war_premium.json', JSON.stringify(snap), { upsert: true, contentType: 'application/json' });
  if (error) {
    console.error('premium snapshot upload:', error.message);
    return null;
  }
  return snap;
}
// Same name-join as fetchPremiumMap, but against a Storage snapshot (no fetch).
export function premiumFromSnapshot(players: FollowedPlayer[], snap: PremiumSnapshot): Record<number, PremiumMetrics> {
  const result: Record<number, PremiumMetrics> = {};
  for (const p of players) {
    const key = normalizeName(p.fullName);
    const m = p.primaryPosition === 'P' ? snap.pitchers[key] : snap.hitters[key];
    if (m) result[p.id] = m;
  }
  return result;
}

// Actual current-year pitching, pulled live from the MLB/MiLB stats API across
// every level. Keyed by normalized name (the same join key the sheet uses); when
// a pitcher has thrown at multiple levels we keep the one with the most innings
// (his primary current role). Cached ~30 min. Season stamped in via `season`.
const SPORT_LEVEL: Record<number, string> = { 1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'A+', 14: 'A', 16: 'Rk' };
type ActualStat = { era: number; ip: number; level: string; role: 'SP' | 'RP'; playerId?: number; teamId?: number; team?: string };
let actualCache: { at: number; season: number; map: Map<string, ActualStat> } | null = null;
const ACTUAL_TTL = 30 * 60 * 1000;
async function fetchActualPitcherStats(season: number): Promise<Map<string, ActualStat>> {
  if (actualCache && actualCache.season === season && Date.now() - actualCache.at < ACTUAL_TTL) return actualCache.map;
  const byName = new Map<string, ActualStat>();
  await Promise.all(Object.keys(SPORT_LEVEL).map(async (sidStr) => {
    const sid = Number(sidStr);
    try {
      const res = await fetch(
        `https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&season=${season}&sportId=${sid}&limit=2000&playerPool=all`,
        { headers: { 'User-Agent': 'HotSheet/1.0' }, cache: 'no-store' }
      );
      if (!res.ok) return;
      const d = await res.json();
      const splits = d?.stats?.[0]?.splits ?? [];
      for (const s of splits) {
        const name: string | undefined = s?.player?.fullName;
        const era = parseFloat(s?.stat?.era);
        const ip = parseFloat(s?.stat?.inningsPitched);
        if (!name || !Number.isFinite(era) || !Number.isFinite(ip)) continue;
        const gs = parseInt(s?.stat?.gamesStarted, 10) || 0;
        const g = parseInt(s?.stat?.gamesPlayed, 10) || 0;
        const key = normalizeName(name);
        const cur = byName.get(key);
        if (!cur || ip > cur.ip) byName.set(key, {
          era, ip, level: SPORT_LEVEL[sid],
          role: g > 0 && gs / g < 0.5 ? 'RP' : 'SP',
          playerId: s?.player?.id, teamId: s?.team?.id, team: s?.team?.name,
        });
      }
    } catch { /* skip this level */ }
  }));
  actualCache = { at: Date.now(), season, map: byName };
  return byName;
}

// SP regression: the sheet's PEAK (true-talent) ERA/20 projection vs the pitcher's
// ACTUAL current-year ERA from the MLB/MiLB API. delta = actual − peak, so a
// pitcher running ABOVE his projection (positive delta) is a buy-low bounce-back
// candidate; running UNDER it (negative) is a sell-high (regression up looms).
// Starters only (sheet IP/G ≥ 3.5) with real innings this year (≥ MIN_IP), which
// also drops guys who haven't actually pitched. Level = where he's actually
// throwing. The client applies the ERA / level / gap filters. Premium.
const REGRESSION_MIN_IP = 20;
export async function getSpRegression(sheetId: string, includeRelievers = false): Promise<{ rows: RegressionRow[] }> {
  const csv = await fetchCsvTab(sheetId, PIT_TAB);
  const rows = parseCsv(csv);
  if (rows.length < 2) return { rows: [] };
  const h = rows[0].map((x) => x.trim());
  const pi = h.findIndex((x) => x.toLowerCase() === 'player');
  const peakI = h.findIndex((x) => x === 'era 20 tbf/g');
  const ipgI = h.findIndex((x) => x === 'IP/G');
  const idI = h.findIndex((x) => x.toLowerCase() === 'id');
  if (pi < 0 || peakI < 0) return { rows: [] };

  const actual = await fetchActualPitcherStats(new Date().getUTCFullYear());

  const byKey = new Map<string, RegressionRow>();
  const keptStale = new Map<string, boolean>();
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const name = c[pi]?.trim();
    if (!name) continue;
    const peak = parseFloat(c[peakI]);
    const ipg = ipgI >= 0 ? parseFloat(c[ipgI]) : NaN;
    if (!Number.isFinite(peak)) continue;
    if (!includeRelievers && Number.isFinite(ipg) && ipg < 3.5) continue; // starters only (SP + SP prospects) unless the full pitcher pool was requested
    const key = normalizeName(name);
    const a = actual.get(key);
    if (!a || a.ip < REGRESSION_MIN_IP) continue; // must have real current-year innings
    const stale = idI >= 0 ? isStaleId(c[idI] ?? '') : false;
    if (byKey.has(key) && !(keptStale.get(key) && !stale)) continue;
    byKey.set(key, { nameKey: key, player: name, level: a.level, peakEra20: peak, currentEra20: a.era, delta: a.era - peak, ip: a.ip, role: a.role, playerId: a.playerId, teamId: a.teamId, team: a.team });
    keptStale.set(key, stale);
  }
  return { rows: [...byKey.values()] };
}

// Scouting: every projected player with a peak-WAR ceiling + level, age, and the
// headline metric/tool tags — so the client can filter prospects by a WAR slider
// and level (incl. rookie ball). Reads both tabs; dedupes per (name, role). Premium.

// Hitter regression (EXPERIMENTAL): both sides come from the sheet — the peak
// wRC+ projection vs the sheet's own current-year wRC+ (park-adjusted by nature
// of wRC+). delta = current − peak: positive = running over the peak projection
// (sell-high), negative = under it (buy-low… or just a pre-peak kid developing,
// which is why the UI carries age). Premium.
export async function getHitterRegression(sheetId: string): Promise<{ rows: HitterRegressionRow[] }> {
  const csv = await fetchCsvTab(sheetId, HIT_TAB);
  const rows = parseCsv(csv);
  if (rows.length < 2) return { rows: [] };
  const h = rows[0].map((x) => x.trim());
  const pi = h.findIndex((x) => x.toLowerCase() === 'name');
  const peakI = h.findIndex((x) => x === 'wRC+');
  const curI = h.findIndex((x) => x === 'wRC+ - current year only');
  const idI = h.findIndex((x) => x.toLowerCase() === 'id');
  const sbI = h.findIndex((x) => x === 'SB/600');
  const hrI = h.findIndex((x) => x === 'HR');
  const defI = h.findIndex((x) => x === 'DEF');
  let ageI = h.findIndex((x) => x.toLowerCase() === 'max age');
  if (ageI < 0) ageI = h.findIndex((x) => x.toLowerCase() === 'age');
  const lvlI = h.findIndex((x) => x.toLowerCase() === 'highest level');
  if (pi < 0 || peakI < 0 || curI < 0) return { rows: [] };

  const byKey = new Map<string, HitterRegressionRow>();
  const keptStale = new Map<string, boolean>();
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const name = c[pi]?.trim();
    if (!name) continue;
    const peak = parseFloat(c[peakI]);
    const cur = parseFloat(c[curI]);
    if (!Number.isFinite(peak) || !Number.isFinite(cur)) continue; // needs real current-year PA
    const key = normalizeName(name);
    const stale = idI >= 0 ? isStaleId(c[idI] ?? '') : false;
    if (byKey.has(key) && !(keptStale.get(key) && !stale)) continue;
    const sb = sbI >= 0 ? parseFloat(c[sbI]) : NaN;
    const hr = hrI >= 0 ? parseFloat(c[hrI]) : NaN;
    const def = defI >= 0 ? parseFloat(c[defI]) : NaN;
    const age = ageI >= 0 ? parseFloat(c[ageI]) : NaN;
    const speed: ToolGrade | undefined = Number.isFinite(sb) ? (sb >= 34 ? 'double-plus' : sb >= 24 ? 'plus' : undefined) : undefined;
    const power: ToolGrade | undefined = Number.isFinite(hr) ? (hr >= 30 ? 'double-plus' : hr >= 22 ? 'plus' : undefined) : undefined;
    let dual: ToolGrade | undefined;
    if (Number.isFinite(sb) && Number.isFinite(hr) && sb >= 12 && hr >= 12) {
      const combined = sb + hr;
      dual = combined >= 40 ? 'double-plus' : combined >= 30 ? 'plus' : undefined;
    }
    const defG: DefGrade | undefined = Number.isFinite(def) ? (def >= 6 ? 'double-plus' : def >= 2 ? 'plus' : def <= -6 ? 'double-minus' : def <= -2 ? 'minus' : undefined) : undefined;
    byKey.set(key, {
      nameKey: key, player: name, level: lvlI >= 0 ? c[lvlI]?.trim() : undefined,
      age: Number.isFinite(age) ? age : undefined,
      peakWrc: Math.round(peak), curWrc: Math.round(cur), delta: Math.round(cur - peak),
      speed, power, dual, def: defG,
    });
    keptStale.set(key, stale);
  }
  return { rows: Array.from(byKey.values()) };
}


// Value Board: every projected player's raw model inputs + display name, so the
// client can compute PV/FV/lens grades in bulk against the user's league
// settings (same computeValue the Trade Checker uses — minus live layers).
const boardCache = new Map<string, { at: number; rows: ValueBoardRow[] }>();
export type ValueBoardRow = { player: string; nameKey: string; isPitcher: boolean } & PremiumMetrics;
// side: 'bat' | 'pit' — one tab per request so the client can render hitters
// immediately and stream pitchers in behind (a combined cold fetch took ~20s).
export async function getValueBoardInputs(sheetId: string, side: 'bat' | 'pit'): Promise<{ rows: ValueBoardRow[] }> {
  const ck = `${sheetId}|${side}`;
  const hit = boardCache.get(ck);
  // 60-min TTL: the sheet's numbers move ~once a day (see the freshness badge),
  // and this cache fronts a ~7MB CSV fetch + ~9k-row parse per tab. At 5 min it
  // expired in lockstep with the page's 5-min auto-refresh, so one open board
  // tab re-parsed the whole sheet twelve times an hour — the single biggest
  // Fluid Active CPU line on the (free) Vercel team (2026-08-08 limit email).
  if (hit && Date.now() - hit.at < 60 * 60_000) return { rows: hit.rows };
  const isPitcher = side === 'pit';
  const nameHeader = isPitcher ? 'player' : 'name';
  const csv = await fetchCsvTab(sheetId, isPitcher ? PIT_TAB : HIT_TAB);
  const metrics = parseTab(csv, nameHeader, isPitcher);
  // parseTab keys by normalized name — recover the display spelling.
  const raw = parseCsv(csv);
  const h = raw[0]?.map((x) => x.trim()) ?? [];
  const pi = h.findIndex((x) => x.toLowerCase() === nameHeader);
  const names = new Map<string, string>();
  if (pi >= 0) for (let r = 1; r < raw.length; r++) {
    const n = raw[r][pi]?.trim();
    if (n) { const k = normalizeName(n); if (!names.has(k)) names.set(k, n); }
  }
  const round = (v?: number) => (v === undefined ? undefined : Math.round(v * 1000) / 1000);
  const rows: ValueBoardRow[] = [];
  for (const [key, m] of metrics) {
    // Slim payload: only the fields the board consumes, rounded (the full
    // metrics object with tool grades etc. tripled the JSON size).
    rows.push({
      player: names.get(key) ?? key, nameKey: key, isPitcher,
      war: round(m.war), peakWrcPlus: m.peakWrcPlus, era20: round(m.era20),
      hr: round(m.hr), sb: round(m.sb), curWrcPlus: m.curWrcPlus, curEra20: round(m.curEra20),
      age: m.age, level: m.level, marketBaseline: round(m.marketBaseline),
      defRuns: round(m.defRuns), ipg: round(m.ipg), pos: m.pos, rpWar: m.rpWar,
      pa: m.pa, ip: m.ip, auctionRaw: round(m.auctionRaw),
    });
  }
  boardCache.set(ck, { at: Date.now(), rows });
  return { rows };
}

function parseScoutTab(csv: string, nameHeader: string, isPitcher: boolean): ScoutingRow[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0].map((x) => x.trim());
  const pi = header.findIndex((x) => x.toLowerCase() === nameHeader);
  const idI = header.findIndex((x) => x.toLowerCase() === 'id');
  const warCol = warCols(header, isPitcher);
  const wrcI = isPitcher ? -1 : header.findIndex((x) => x === 'wRC+');
  const eraI = isPitcher ? header.findIndex((x) => x === 'era 20 tbf/g') : -1;
  const sbI = isPitcher ? -1 : header.findIndex((x) => x === 'SB/600');
  const hrI = isPitcher ? -1 : header.findIndex((x) => x === 'HR');
  const defI = isPitcher ? -1 : header.findIndex((x) => x === 'DEF');
  let ageI = header.findIndex((x) => x.toLowerCase() === 'max age');
  if (ageI < 0) ageI = header.findIndex((x) => x.toLowerCase() === 'age');
  const lvlI = header.findIndex((x) => x.toLowerCase() === 'highest level');
  const rpI = isPitcher ? header.findIndex((x) => x.toLowerCase() === '1 if rp') : -1;
  if (pi < 0 || warCol.primary < 0) return [];

  const byKey = new Map<string, ScoutingRow>();
  const keptStale = new Map<string, boolean>();
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const name = c[pi]?.trim();
    if (!name) continue;
    const war = readWar(c, warCol);
    if (!Number.isFinite(war)) continue;
    const key = normalizeName(name);
    const stale = idI >= 0 ? isStaleId(c[idI] ?? '') : false;
    if (byKey.has(key) && !(keptStale.get(key) && !stale)) continue;
    const sb = sbI >= 0 ? parseFloat(c[sbI]) : NaN;
    const hr = hrI >= 0 ? parseFloat(c[hrI]) : NaN;
    const def = defI >= 0 ? parseFloat(c[defI]) : NaN;
    const age = ageI >= 0 ? parseFloat(c[ageI]) : NaN;
    const wrc = wrcI >= 0 ? parseFloat(c[wrcI]) : NaN;
    const era = eraI >= 0 ? parseFloat(c[eraI]) : NaN;
    const speed: ToolGrade | undefined = Number.isFinite(sb) ? (sb >= 34 ? 'double-plus' : sb >= 24 ? 'plus' : undefined) : undefined;
    const power: ToolGrade | undefined = Number.isFinite(hr) ? (hr >= 30 ? 'double-plus' : hr >= 22 ? 'plus' : undefined) : undefined;
    let dual: ToolGrade | undefined;
    if (Number.isFinite(sb) && Number.isFinite(hr) && sb >= 12 && hr >= 12) {
      const combined = sb + hr;
      dual = combined >= 40 ? 'double-plus' : combined >= 30 ? 'plus' : undefined;
    }
    const defGrade: DefGrade | undefined = Number.isFinite(def)
      ? (def >= 6 ? 'double-plus' : def >= 2 ? 'plus' : def <= -6 ? 'double-minus' : def <= -2 ? 'minus' : undefined)
      : undefined;
    byKey.set(key, {
      nameKey: key, player: name, level: lvlI >= 0 ? c[lvlI] : undefined, isPitcher, war,
      // Pitcher role comes straight off the sheet; hitter positions are joined
      // by name from the roster index in getScouting (the sheet has no pos
      // column, and its id column is FanGraphs, not MLBAM — no id join possible).
      pos: rpI >= 0 ? (c[rpI]?.trim() === '1' ? 'RP' : 'SP') : undefined,
      age: Number.isFinite(age) ? age : undefined,
      wrcPlus: Number.isFinite(wrc) ? Math.round(wrc) : undefined,
      era20: Number.isFinite(era) ? era : undefined,
      speed, power, dual, def: defGrade,
    });
    keptStale.set(key, stale);
  }
  return [...byKey.values()];
}

// Fold the MLB API's position abbreviations into the filterable buckets the
// scouting UI offers. Unknown/unmatched players keep pos undefined and only
// appear under "All".
export function bucketPos(abbrev: string): string | undefined {
  if (['C', '1B', '2B', '3B', 'SS', 'DH'].includes(abbrev)) return abbrev;
  if (['LF', 'CF', 'RF', 'OF'].includes(abbrev)) return 'OF';
  if (abbrev === 'TWP') return 'DH'; // two-way player's hitting row
  return undefined;
}

export async function getScouting(sheetId: string): Promise<{ rows: ScoutingRow[] }> {
  const [hitCsv, pitCsv] = await Promise.all([fetchCsvTab(sheetId, HIT_TAB), fetchCsvTab(sheetId, PIT_TAB)]);
  const rows = [...parseScoutTab(hitCsv, 'name', false), ...parseScoutTab(pitCsv, 'player', true)];
  // Join the StS-universe ranks from the premium maps (same parse, usually
  // cache-warm) so scouting shows the identical ranks the cards do.
  try {
    const maps = await getPremiumMaps(sheetId);
    for (const r of rows) {
      const ranks = (r.isPitcher ? maps.pitchers : maps.hitters).get(r.nameKey)?.ranks;
      if (ranks) r.ranks = ranks;
    }
  } catch { /* ranks are an enrichment — never fail the list over them */ }
  // Hitter positions + orgs: name join against the full-roster index (the sheet
  // has no position/org column and its ids are FanGraphs, so a name join is the
  // only way; pitchers already got SP/RP from the "1 if RP" column). For
  // positions, index entries whose position is P are other people (pitchers)
  // from the hitter row's perspective and are skipped; two same-named HITTERS at
  // different positions are genuinely ambiguous, so those names stay unlabeled
  // rather than risk a wrong label. Orgs join the same way but side-aware
  // (pitcher rows match P entries, hitter rows non-P), with the same
  // ambiguity-means-unlabeled rule.
  try {
    const pairs = await getNamePositionPairs();
    const posByName = new Map<string, string | null>(); // null = ambiguous
    type OrgInfo = { org: string; orgAbbrev?: string };
    const orgBySideName = new Map<string, OrgInfo | null>(); // "h|key" / "p|key"; null = ambiguous
    const noteOrg = (sideKey: string, org: string, orgAbbrev?: string) => {
      const existing = orgBySideName.get(sideKey);
      if (existing === undefined) orgBySideName.set(sideKey, { org, orgAbbrev });
      else if (existing !== null && existing.org !== org) orgBySideName.set(sideKey, null);
    };
    for (const { name, pos, org, orgAbbrev } of pairs) {
      const key = normalizeName(name);
      const bucket = bucketPos(pos);
      if (bucket) {
        const existing = posByName.get(key);
        if (existing === undefined) posByName.set(key, bucket);
        else if (existing !== bucket) posByName.set(key, null);
      }
      if (org) {
        // TWP plays both sides — index him under both so either row finds him.
        if (pos === 'P' || pos === 'TWP') noteOrg(`p|${key}`, org, orgAbbrev);
        if (pos !== 'P') noteOrg(`h|${key}`, org, orgAbbrev);
      }
    }
    for (const r of rows) {
      if (!r.isPitcher) {
        const p = posByName.get(r.nameKey);
        if (p) r.pos = p;
      }
      const o = orgBySideName.get(`${r.isPitcher ? 'p' : 'h'}|${r.nameKey}`);
      if (o) { r.org = o.org; r.orgAbbrev = o.orgAbbrev; }
    }
  } catch { /* positions/orgs are an enrichment — never fail the list over them */ }
  return { rows };
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
