// Regenerates src/lib/auction-values.ts from Tom's published "Oopsy projections
// for Hot Sheet" Google Sheet (ROS auction-calculator dollar values, one Bats tab
// + one Arms tab, refreshed periodically):
//
//   node scripts/build-auction-values.mjs
//
// or, legacy mode, from raw FanGraphs auction-calculator CSV exports that still
// carry PlayerId/MLBAMID columns:
//
//   node scripts/build-auction-values.mjs <pitchers.csv> <hitters.csv>
//
// The published sheet has NO id columns (#, Name, Team, POS, ADP, PA/IP, m-cats,
// PTS, aPOS, Dollars), so names are resolved to ids two ways:
//   1. sts-replica's pipeline CSVs (mlb/milb bats+arms today.csv) — name+team →
//      FanGraphs PlayerId + MLBAMID, disambiguated by suffix/side/team/season;
//   2. unresolved names fall back to the StS WAR sheet itself (name → its `id`),
//      which is the exact id space the app joins AUCTION_VALUES against.
// Names that resolve nowhere are skipped and listed — by construction they can't
// join to a WAR-sheet row, so the app could never have shown them anyway.
//
// Columns used: Dollars, POS, PA (hitters) / IP (pitchers), mHR + mSB (hitters —
// the dollarized power+speed category value, our ROS "counting" signal). Output
// is keyed by every id the player is known under (FanGraphs + MLBAM) so it joins
// whichever the WAR sheet's `id` column carries. AUCTION_AS_OF is stamped to
// today so the app's PT blend knows how fresh the snapshot is.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Tom's published sheet (2PACX pub link — tab gids resolved by name each run).
const PUB_BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vT4k7NmUOxtVk9DetkTeajTNHHifTcUmBgdJ04-rjZqr9lFoT_ZTHu1jxWQXBORbutFWpsZCqof_AWx';
// StS WAR sheet (same one war.ts reads) — fallback name→id source.
const WAR_SHEET_ID = '1uqL_bssSZ9Njaji11vOUZaDknGFYy6gDmgdhIAyITWs';
const STS_DIR = process.env.STS_DIR ?? join(homedir(), 'sts-replica', 'data', 'import csv');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Two matching tiers: RAW keeps generational suffixes ("luis garcia jr" ≠ "luis
// garcia"), KEY strips them like war.ts normalizeName does.
const rawKey = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const nameKey = (s) => rawKey(s).replace(/\s+(jr|sr|ii|iii|iv|v)\b/g, '').trim();

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'HotSheet/1.0' } });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.text();
}

// Tab name+gid pairs from a sheet's htmlview/pubhtml page.
async function fetchTabs(url) {
  const html = await fetchText(url);
  let pairs = [...html.matchAll(/items.push\(\{name: "([^"]+)"[^}]*?gid=(\d+)/g)].map((m) => [m[1], m[2]]);
  if (!pairs.length) pairs = [...html.matchAll(/\{name: "([^"]+)", pageUrl: "[^"]*gid=(\d+)/g)].map((m) => [m[1], m[2]]);
  if (!pairs.length) pairs = [...html.matchAll(/id="sheet-button-(\d+)"[^>]*><a[^>]*>([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
  return pairs.map(([name, gid]) => ({ name: name.trim(), gid }));
}

// ---- id crosswalk from sts-replica pipeline CSVs -------------------------
// byRaw/byKey: nameKey -> fgid -> { mlbam, team, season, sides:Set }
function buildCrosswalk() {
  const byRaw = new Map(), byKey = new Map();
  const add = (map, k, fgid, mlbam, team, season, side) => {
    if (!k || !fgid) return;
    let m = map.get(k);
    if (!m) map.set(k, (m = new Map()));
    const prev = m.get(fgid);
    if (!prev) m.set(fgid, { mlbam, team, season, sides: new Set([side]) });
    else {
      prev.sides.add(side);
      if (season > prev.season) { prev.season = season; prev.team = team; }
      if (!prev.mlbam && mlbam) prev.mlbam = mlbam;
    }
  };
  const ingest = (file, side) => {
    const path = join(STS_DIR, file);
    if (!existsSync(path)) { console.warn(`crosswalk: missing ${path}`); return; }
    const rows = parseCsv(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    const h = rows[0].map((x) => x.trim());
    const ni = h.indexOf('Name'), fi = h.indexOf('PlayerId'), mi = h.indexOf('MLBAMID');
    const ti = h.indexOf('Team'), si = h.indexOf('Season');
    for (let r = 1; r < rows.length; r++) {
      const c = rows[r];
      const name = (c[ni] || '').trim(), fgid = (c[fi] || '').trim().replace(/^"|"$/g, '');
      if (!name || !fgid) continue;
      const mlbam = mi >= 0 ? (c[mi] || '').trim() : '';
      const team = (c[ti] || '').trim();
      const season = parseInt(c[si], 10) || 0;
      add(byRaw, rawKey(name), fgid, mlbam, team, season, side);
      add(byKey, nameKey(name), fgid, mlbam, team, season, side);
    }
  };
  ingest('mlb bats today.csv', 'hit');
  ingest('mlb arms today.csv', 'pit');
  ingest('milb bats today.csv', 'hit');
  ingest('milb arms today.csv', 'pit');
  // Backfill MLBAM ids for entries the milb files left blank.
  const lookupPath = join(STS_DIR, 'fgid to mlbamid.csv');
  if (existsSync(lookupPath)) {
    const fg2mlbam = new Map();
    const rows = parseCsv(readFileSync(lookupPath, 'utf8').replace(/^﻿/, ''));
    for (let r = 1; r < rows.length; r++) if (rows[r][0] && rows[r][1]) fg2mlbam.set(rows[r][0].trim(), rows[r][1].trim());
    for (const m of [...byRaw.values(), ...byKey.values()])
      for (const [fgid, v] of m) if (!v.mlbam && fg2mlbam.has(fgid)) v.mlbam = fg2mlbam.get(fgid);
  }
  return { byRaw, byKey };
}

// Narrow a candidate map down to one player: side → team → only-one-has-MLBAM →
// strictly-latest season. Returns [fgid, info] or null if still ambiguous.
function resolve(cands, side, team) {
  let list = [...cands.entries()];
  const narrow = (pred) => { const f = list.filter(pred); if (f.length >= 1) list = f; };
  narrow(([, v]) => v.sides.has(side));
  if (list.length > 1 && team) narrow(([, v]) => v.team === team);
  if (list.length > 1 && list.filter(([, v]) => v.mlbam).length === 1) narrow(([, v]) => !!v.mlbam);
  if (list.length > 1) {
    const best = Math.max(...list.map(([, v]) => v.season));
    if (list.filter(([, v]) => v.season === best).length === 1) narrow(([, v]) => v.season === best);
  }
  return list.length === 1 ? list[0] : null;
}

// ---- WAR-sheet fallback: name -> id, per side ----------------------------
async function buildWarNameIndex() {
  const tabs = await fetchTabs(`https://docs.google.com/spreadsheets/d/${WAR_SHEET_ID}/htmlview`);
  const gidFor = (name) => tabs.find((t) => t.name.toLowerCase() === name)?.gid;
  const index = { hit: new Map(), pit: new Map() };
  for (const [tab, side] of [['peak hitting raw', 'hit'], ['pitching raw', 'pit']]) {
    const gid = gidFor(tab);
    if (!gid) { console.warn(`WAR fallback: tab "${tab}" not found`); continue; }
    const rows = parseCsv(await fetchText(`https://docs.google.com/spreadsheets/d/${WAR_SHEET_ID}/export?format=csv&gid=${gid}`));
    const h = rows[0].map((x) => x.trim().toLowerCase());
    const ni = h.findIndex((x) => x === 'name' || x === 'player'), ii = h.indexOf('id');
    if (ni < 0 || ii < 0) { console.warn(`WAR fallback: no name/id cols in "${tab}"`); continue; }
    for (let r = 1; r < rows.length; r++) {
      const name = (rows[r][ni] || '').trim(), id = (rows[r][ii] || '').trim();
      if (!name || !id) continue;
      const k = nameKey(name);
      if (!index[side].has(k)) index[side].set(k, new Set());
      index[side].get(k).add(id);
    }
  }
  return index;
}

// ---- row ingestion --------------------------------------------------------
function makeValue(c, h, isPitch) {
  const col = (name) => h.indexOf(name);
  const num = (i) => { const v = parseFloat(String(c[i] ?? '').replace(/[$,]/g, '')); return Number.isFinite(v) ? v : undefined; };
  const d = num(col('Dollars'));
  if (d === undefined) return null;
  const pos = (c[col('POS')] || '').trim();
  const v = { d: Math.round(d * 10) / 10, r: isPitch ? (pos === 'SP' ? 'SP' : 'RP') : 'HIT', pos };
  if (isPitch) {
    const ip = num(col('IP')); if (ip !== undefined) v.ip = Math.round(ip);
  } else {
    const pa = num(col('PA')); if (pa !== undefined) v.pa = Math.round(pa);
    // ROS "counting" value = dollarized power + speed contribution (mHR + mSB).
    const hr = num(col('mHR')) ?? 0, sb = num(col('mSB')) ?? 0;
    v.cnt = Math.round((hr + sb) * 10) / 10;
    // PTS = the sum of the marginal CATEGORY dollars (mRBI + mR + mSB + mHR +
    // mOBP), i.e. Dollars stripped of the positional/replacement adjustment
    // (Dollars = PTS + aPOS + $1). The value model needs it to recover a real
    // per-PA rate: the category dollars are linear in PA around a common
    // zero-PA intercept, so (PTS - intercept) / PA is PA-invariant while
    // Dollars / PA is not. See PTS_AT_ZERO_PA in value-model.ts.
    const pts = num(col('PTS'));
    if (pts !== undefined) v.pts = Math.round(pts * 10) / 10;
  }
  return v;
}

// Two-way players appear on both sides (Ohtani): keep the higher-dollar entry —
// their primary fantasy role — not just whichever loaded first.
const emit = (out, keys, v) => {
  for (const k of keys) if (k && (!(k in out) || v.d > out[k].d)) out[k] = v;
};

// Legacy mode: FanGraphs export CSVs that carry PlayerId/MLBAMID directly.
function loadLegacy(path, isPitch, out) {
  const rows = parseCsv(readFileSync(path, 'latin1'));
  const h = rows[0].map((x) => x.trim());
  const fgi = h.indexOf('PlayerId'), mi = h.indexOf('MLBAMID');
  for (let r = 1; r < rows.length; r++) {
    const v = makeValue(rows[r], h, isPitch);
    if (v) emit(out, [String(rows[r][fgi] || '').trim(), String(rows[r][mi] || '').trim()], v);
  }
}

async function loadPublished(out) {
  const tabs = await fetchTabs(`${PUB_BASE}/pubhtml`);
  const tabFor = (re) => tabs.find((t) => re.test(t.name));
  const batsTab = tabFor(/bats/i), armsTab = tabFor(/arms/i);
  if (!batsTab || !armsTab) throw new Error(`Bats/Arms tabs not found; published tabs: ${tabs.map((t) => t.name).join(', ')}`);
  console.log(`tabs: "${batsTab.name}" (hitters), "${armsTab.name}" (pitchers)`);

  const { byRaw, byKey } = buildCrosswalk();
  // The WAR-sheet index is NOT a fallback-only source (Tom, 2026-08-24): the app
  // joins AUCTION_VALUES against the WAR sheet's OWN `id` column, so a row keyed
  // only by the crosswalk's FanGraphs/MLBAM pair silently fails to join whenever
  // the sheet carries a different id for that player. That's exactly what happens
  // to a promoted prospect — the crosswalk knows him by his MINOR-league FG id
  // ("sa3018514") while the WAR sheet has already switched to his major-league id
  // (30675), so Luis Lara's −$9.30 market read never reached the model and his Now
  // floated up to $22 on the WAR-led fallback path. 70 recently-promoted bats were
  // mispriced this way. So: always index the WAR sheet and key every row by the
  // UNION of the ids it's known under.
  const warIndex = await buildWarNameIndex();
  const stats = { matched: 0, warOnly: 0, warAlso: 0, noWarId: 0, skipped: [] };
  // A unique WAR-sheet id for this name; on a dup name prefer a lone non-stale
  // id (an "sa" id is the pre-promotion row the app itself skips).
  const warIdFor = (side, name) => {
    const ids = warIndex[side].get(nameKey(name));
    const live = ids && [...ids].filter((id) => !/^sa/i.test(id));
    return ids?.size === 1 ? [...ids][0] : live?.length === 1 ? live[0] : undefined;
  };

  for (const [tab, isPitch] of [[armsTab, true], [batsTab, false]]) {
    const rows = parseCsv(await fetchText(`${PUB_BASE}/pub?gid=${tab.gid}&single=true&output=csv`));
    const h = rows[0].map((x) => x.trim());
    if (h.indexOf('Name') < 0 || h.indexOf('Dollars') < 0)
      throw new Error(`tab "${tab.name}": expected Name/Dollars headers, got: ${h.join(', ')}`);
    if (rows.length < 300) throw new Error(`tab "${tab.name}": only ${rows.length} rows — truncated export?`);
    const ni = h.indexOf('Name'), ti = h.indexOf('Team');
    const side = isPitch ? 'pit' : 'hit';
    for (let r = 1; r < rows.length; r++) {
      const name = (rows[r][ni] || '').trim();
      const v = name && makeValue(rows[r], h, isPitch);
      if (!v) continue;
      const team = (rows[r][ti] || '').trim();
      const cands = byRaw.get(rawKey(name)) ?? byKey.get(nameKey(name));
      const hit = cands && resolve(cands, side, team);
      const warId = warIdFor(side, name);
      if (hit) {
        emit(out, [hit[0], hit[1].mlbam, warId], v);
        stats.matched++;
        if (warId && warId !== hit[0] && warId !== hit[1].mlbam) stats.warAlso++;
        // A row with NO WAR-sheet id can never join in the app (the WAR sheet is
        // the only id space it looks players up in) — the silent failure this
        // pass fixed. Most of these are simply players the WAR sheet doesn't
        // carry, so it's a report, not an error; a JUMP in the count means the
        // name matching drifted.
        else if (!warId) stats.noWarId++;
        continue;
      }
      if (warId) { emit(out, [warId], v); stats.warOnly++; }
      else stats.skipped.push(`${name} (${team || '?'}, ${side})`);
    }
  }
  console.log(`crosswalk-matched ${stats.matched} (${stats.warAlso} also keyed by a DIFFERENT WAR-sheet id), WAR-sheet-only ${stats.warOnly}, skipped ${stats.skipped.length}`);
  console.log(`${stats.noWarId} matched rows carry no WAR-sheet id (unjoinable in the app — expected for players the WAR sheet doesn't carry)`);
  if (stats.skipped.length) console.log(`skipped: ${stats.skipped.join('; ')}`);
  if (stats.matched < 800) throw new Error('fewer than 800 matched rows — source sheet or crosswalk looks broken, refusing to write');
}

const [, , pitchCsv, hitCsv] = process.argv;
const out = {};
if (pitchCsv && hitCsv) {
  loadLegacy(pitchCsv, true, out);
  loadLegacy(hitCsv, false, out);
} else {
  await loadPublished(out);
}

// AUCTION_AS_OF drives the app's playing-time blend (how stale the export's own
// PA/IP read is), so it must be the date the SHEET was pulled, not the date this
// script ran. Defaults to today; pass AUCTION_AS_OF=YYYY-MM-DD to re-key an
// existing export without back-dating or forward-dating it.
const asOf = process.env.AUCTION_AS_OF || new Date().toISOString().slice(0, 10);
const entry = (v) => {
  const parts = [`d: ${v.d}`, `r: '${v.r}'`];
  if (v.pos) parts.push(`pos: '${v.pos}'`);
  if (v.pa !== undefined) parts.push(`pa: ${v.pa}`);
  if (v.ip !== undefined) parts.push(`ip: ${v.ip}`);
  if (v.cnt !== undefined) parts.push(`cnt: ${v.cnt}`);
  if (v.pts !== undefined) parts.push(`pts: ${v.pts}`);
  return `{ ${parts.join(', ')} }`;
};

const lines = [
  '// Auction-calculator dollar values as a market-vetted PRESENT-VALUE reference.',
  `// Both sides ingested ${asOf} from Tom's published "Oopsy projections for Hot`,
  '// Sheet" Google Sheet (ROS auction export, Bats + Arms tabs). Carries the',
  '// first-listed POSITION, the rest-of-season playing time (pa hitters / ip',
  '// pitchers), and cnt = the dollarized ROS power+speed value (mHR + mSB) — a',
  '// current-form counting signal for PV. Keyed by every id the player is known',
  "// under (FanGraphs + MLBAM) so it joins whichever the WAR sheet's `id` carries.",
  '// Regenerate with scripts/build-auction-values.mjs when Tom updates the sheet.',
  "export type AuctionRole = 'SP' | 'RP' | 'HIT';",
  `export const AUCTION_AS_OF: string | null = '${asOf}';`,
  'export const AUCTION_VALUES: Record<string, { d: number; r: AuctionRole; pos?: string; pa?: number; ip?: number; cnt?: number; pts?: number }> = {',
  ...Object.keys(out).sort().map((k) => `  '${k}': ${entry(out[k])},`),
  '};',
  '',
];
writeFileSync(new URL('../src/lib/auction-values.ts', import.meta.url), lines.join('\n'));
console.log(`Wrote ${Object.keys(out).length} keyed entries to src/lib/auction-values.ts (asOf ${asOf})`);
