import { FollowedPlayer, PremiumMetrics } from './types';

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
// A row's id is "stale" when it keeps the old minor-league id (prefixed "sa")
// after a promotion. The sheet occasionally has BOTH the stale row and the
// correct numeric-id row for the same player (name-change cases like Lee,
// Antonacci, Ingle). Per the sheet owner, the non-"sa" id is the correct one.
function isStaleId(id: string): boolean {
  return /^\s*sa/i.test(id);
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
