import { FollowedPlayer } from './types';

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

// Build normalizedName -> WAR from one tab's CSV. `nameHeader` locates the name
// column; the WAR column is the first header that trims to exactly "WAR".
function parseTab(csv: string, nameHeader: string): Map<string, number> {
  const rows = parseCsv(csv);
  const out = new Map<string, number>();
  if (rows.length < 2) return out;
  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => h.toLowerCase() === nameHeader);
  const warIdx = header.findIndex((h) => h === 'WAR');
  if (nameIdx < 0 || warIdx < 0) return out;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = cells[nameIdx];
    const war = parseFloat(cells[warIdx]);
    if (name && Number.isFinite(war)) out.set(normalizeName(name), war);
  }
  return out;
}

// 1-hour in-memory cache of the parsed sheet, keyed by sheet id. Hitting and
// pitching are kept SEPARATE — some names appear in both (position players who
// pitched), so we must pick WAR by the player's actual role, not merge.
let cache: { sheetId: string; at: number; hitters: Map<string, number>; pitchers: Map<string, number> } | null = null;
const TTL = 3600_000;

async function fetchCsvTab(sheetId: string, tab: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HotSheet/1.0' } });
  if (!res.ok) throw new Error(`WAR sheet fetch ${res.status}`);
  return res.text();
}

async function getWarMaps(sheetId: string): Promise<{ hitters: Map<string, number>; pitchers: Map<string, number> }> {
  const now = Date.now();
  if (cache && cache.sheetId === sheetId && now - cache.at < TTL) return cache;
  const [hitCsv, pitCsv] = await Promise.all([
    fetchCsvTab(sheetId, HIT_TAB),
    fetchCsvTab(sheetId, PIT_TAB),
  ]);
  const hitters = parseTab(hitCsv, 'name');
  const pitchers = parseTab(pitCsv, 'player');
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

// Parse one tab into snapshot rows (name + WAR + highest level).
function parseRows(csv: string, nameHeader: string, isPitcher: boolean): WarRow[] {
  const rows = parseCsv(csv);
  const out: WarRow[] = [];
  if (rows.length < 2) return out;
  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => h.toLowerCase() === nameHeader);
  const warIdx = header.findIndex((h) => h === 'WAR');
  const lvlIdx = header.findIndex((h) => h.toLowerCase() === 'highest level');
  if (nameIdx < 0 || warIdx < 0) return out;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = cells[nameIdx];
    const war = parseFloat(cells[warIdx]);
    if (name && Number.isFinite(war)) {
      out.push({ nameKey: normalizeName(name), displayName: name, isPitcher, level: lvlIdx >= 0 ? cells[lvlIdx] : undefined, war });
    }
  }
  return out;
}

// All WAR rows (both tabs) for a daily snapshot.
export async function getWarRows(sheetId: string): Promise<WarRow[]> {
  const [hitCsv, pitCsv] = await Promise.all([fetchCsvTab(sheetId, HIT_TAB), fetchCsvTab(sheetId, PIT_TAB)]);
  return [...parseRows(hitCsv, 'name', false), ...parseRows(pitCsv, 'player', true)];
}

// Join WAR to the given players by normalized name, using the role-appropriate
// sheet (pitchers → Peak Pitching, everyone else → Peak Hitting). Returns
// playerId -> WAR.
export async function fetchWarMap(
  players: FollowedPlayer[],
  sheetId: string
): Promise<Record<number, number>> {
  const { hitters, pitchers } = await getWarMaps(sheetId);
  const result: Record<number, number> = {};
  const misses: string[] = [];
  for (const p of players) {
    const key = normalizeName(p.fullName);
    const war = p.primaryPosition === 'P' ? pitchers.get(key) : hitters.get(key);
    if (war !== undefined) result[p.id] = war;
    else misses.push(p.fullName);
  }
  if (misses.length > 0) console.warn(`WAR: no sheet match for ${misses.length}:`, misses.slice(0, 20));
  return result;
}
