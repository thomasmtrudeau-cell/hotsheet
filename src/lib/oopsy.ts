import { parseCsv, normalizeName } from './war';
import { OopsyPitcher, OopsyHitter } from './types';

// OOPSY weekly projections — a separate published Google Sheet with two tabs.
// Read by STABLE gid (the tabs are renamed with the week date each update, but
// the gid never changes). Premium-only; the API route enforces that. Dormant
// unless OOPSY_SHEET_ID is configured.
const PITCH_GID = '854749414';
const HIT_GID = '1891665849';
const TTL = 5 * 60_000; // 5 min

let cache: { sheetId: string; at: number; pitchers: OopsyPitcher[]; hitters: OopsyHitter[]; week?: string } | null = null;

async function fetchCsvByGid(sheetId: string, gid: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}&_cb=${Date.now()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HotSheet/1.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`OOPSY sheet fetch ${res.status}`);
  return res.text();
}

// The tabs are renamed with the projection week's Monday each update (e.g.
// "7/13 pitching"), and the published sheet's htmlview lists those names — so the
// week label comes from the DATA, not the calendar (a stale sheet shows its real
// week). Returns e.g. "Jul 13–19" or undefined if the parse fails; never throws.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
async function fetchWeekLabel(sheetId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, { headers: { 'User-Agent': 'HotSheet/1.0' }, cache: 'no-store' });
    if (!res.ok) return undefined;
    const html = await res.text();
    const m = html.match(/name: "(\d{1,2})\\?\/(\d{1,2})[^"]*"/);
    if (!m) return undefined;
    const mo = parseInt(m[1], 10), day = parseInt(m[2], 10);
    if (!mo || !day || mo > 12 || day > 31) return undefined;
    // Week runs Mon..Sun from the tab's date.
    const year = new Date().getFullYear();
    const end = new Date(year, mo - 1, day + 6);
    const sameMonth = end.getMonth() === mo - 1;
    return `${MONTHS[mo - 1]} ${day}–${sameMonth ? '' : `${MONTHS[end.getMonth()]} `}${end.getDate()}`;
  } catch { return undefined; }
}

const col = (header: string[], ...names: string[]) => {
  for (const name of names) {
    const i = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
};
const startsWith = (header: string[], prefix: string) => header.findIndex((h) => h.trim().toLowerCase().startsWith(prefix));

function parsePitchers(csv: string): OopsyPitcher[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const h = rows[0];
  // Column A flips between "Player" and "Name" across weekly exports (7/20
  // shipped as "Name" and the whole tab parsed to zero) — accept both.
  const pi = col(h, 'Player', 'Name'), di = col(h, 'Day'), ei = col(h, 'ERA'), oi = col(h, 'Opponent'), ki = col(h, 'Park'), ti = col(h, 'Team');
  const out: OopsyPitcher[] = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const player = c[pi]?.trim();
    if (!player) continue;
    const era = parseFloat(c[ei]);
    if (!Number.isFinite(era)) continue;
    out.push({
      nameKey: normalizeName(player), player,
      day: di >= 0 ? c[di] : '', era,
      opponent: oi >= 0 ? c[oi] : '', park: ki >= 0 ? c[ki] : '', team: ti >= 0 ? c[ti] : '',
      rank: out.length + 1, // sheet is pre-sorted best ERA first
    });
  }
  return out;
}

function parseHitters(csv: string): OopsyHitter[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const h = rows[0];
  const pi = col(h, 'Player', 'Name'), gi = col(h, 'Projected games'), pai = col(h, 'Projected PA');
  const wi = startsWith(h, 'wrc+'), fi = startsWith(h, 'fantasy value'), ri = col(h, 'Rank');
  const out: OopsyHitter[] = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const player = c[pi]?.trim();
    if (!player) continue;
    const num = (i: number) => { const v = i >= 0 ? parseFloat(c[i]) : NaN; return Number.isFinite(v) ? v : undefined; };
    out.push({
      nameKey: normalizeName(player), player,
      projGames: num(gi), projPA: num(pai), wrcPlus: num(wi), fantasyZ: num(fi),
      rank: num(ri) ?? out.length + 1,
    });
  }
  return out;
}

export async function getOopsy(sheetId: string): Promise<{ pitchers: OopsyPitcher[]; hitters: OopsyHitter[]; week?: string }> {
  const now = Date.now();
  if (cache && cache.sheetId === sheetId && now - cache.at < TTL) {
    return { pitchers: cache.pitchers, hitters: cache.hitters, week: cache.week };
  }
  const [pc, hc, week] = await Promise.all([fetchCsvByGid(sheetId, PITCH_GID), fetchCsvByGid(sheetId, HIT_GID), fetchWeekLabel(sheetId)]);
  const pitchers = parsePitchers(pc);
  const hitters = parseHitters(hc);
  cache = { sheetId, at: now, pitchers, hitters, week };
  return { pitchers, hitters, week };
}
