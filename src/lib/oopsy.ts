import { parseCsv, normalizeName, fetchSheetTabs } from './war';
import { OopsyPitcher, OopsyHitter } from './types';

// OOPSY weekly projections — a separate published Google Sheet with two tabs.
// Tab gids are resolved by NAME from the published htmlview each fetch: the
// 7/27 export replaced the tabs outright (new gids) instead of renaming them,
// and gviz silently serves the FIRST tab when asked for a dead gid — so a
// hardcoded gid can return the wrong tab's data without erroring. The old gids
// survive only as a last-resort fallback when the htmlview parse fails.
// Premium-only; the API route enforces that. Dormant unless OOPSY_SHEET_ID is
// configured.
const FALLBACK_PITCH_GID = '854749414';
const FALLBACK_HIT_GID = '1891665849';
const TTL = 5 * 60_000; // 5 min

let cache: { sheetId: string; at: number; pitchers: OopsyPitcher[]; hitters: OopsyHitter[]; week?: string } | null = null;

// /export?format=csv rather than gviz: gviz respects an active basic filter on
// the tab (the 07-31 WAR-sheet incident hid every MLB hitter from the app);
// export always returns the full grid, and a dead gid 404s loudly instead of
// gviz's silent first-tab fallback.
async function fetchCsvByGid(sheetId: string, gid: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}&_cb=${Date.now()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HotSheet/1.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`OOPSY sheet fetch ${res.status}`);
  return res.text();
}

// The published sheet's htmlview embeds every tab's name and gid (shared parser
// lives in war.ts).
type Tab = { name: string; gid: string };
const fetchTabs = (sheetId: string): Promise<Tab[]> => fetchSheetTabs(sheetId);

// Tabs are named for the projection week's Monday, e.g. "7/27 pitching".
const tabDate = (name: string): number => {
  const m = name.match(/(\d{1,2})\/(\d{1,2})/);
  return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : -1;
};
// "hitting" is a substring-safe test only because /hit/ never matches "pitching".
function pickTab(tabs: Tab[], want: 'pitching' | 'hitting'): Tab | undefined {
  const c = tabs.filter((t) => (want === 'pitching' ? /pitch/i.test(t.name) : /hit/i.test(t.name) && !/pitch/i.test(t.name)));
  if (c.length === 0) return undefined;
  return c.reduce((a, b) => (tabDate(b.name) >= tabDate(a.name) ? b : a));
}

// Week label comes from the tab NAME, not the calendar — a stale sheet shows
// its real week. Returns e.g. "Jul 13–19" or undefined; never throws.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function weekLabel(tabName: string | undefined): string | undefined {
  const m = tabName?.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return undefined;
  const mo = parseInt(m[1], 10), day = parseInt(m[2], 10);
  if (!mo || !day || mo > 12 || day > 31) return undefined;
  // Week runs Mon..Sun from the tab's date.
  const year = new Date().getFullYear();
  const end = new Date(year, mo - 1, day + 6);
  const sameMonth = end.getMonth() === mo - 1;
  return `${MONTHS[mo - 1]} ${day}–${sameMonth ? '' : `${MONTHS[end.getMonth()]} `}${end.getDate()}`;
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
  // The 7/27 export renamed "Projected games/PA" to bare "G"/"PA" and dropped
  // the fantasy-value and Rank columns — accept both generations.
  const pi = col(h, 'Player', 'Name'), gi = col(h, 'Projected games', 'G'), pai = col(h, 'Projected PA', 'PA');
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
  const tabs = await fetchTabs(sheetId).catch(() => [] as Tab[]);
  const pitchTab = pickTab(tabs, 'pitching');
  const hitTab = pickTab(tabs, 'hitting');
  const week = weekLabel(pitchTab?.name ?? hitTab?.name);
  const [pc, hc] = await Promise.all([
    fetchCsvByGid(sheetId, pitchTab?.gid ?? FALLBACK_PITCH_GID),
    fetchCsvByGid(sheetId, hitTab?.gid ?? FALLBACK_HIT_GID),
  ]);
  const pitchers = parsePitchers(pc);
  const hitters = parseHitters(hc);
  cache = { sheetId, at: now, pitchers, hitters, week };
  return { pitchers, hitters, week };
}
