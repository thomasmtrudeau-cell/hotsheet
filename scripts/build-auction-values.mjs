// Regenerates src/lib/auction-values.ts from FanGraphs auction-calculator CSV
// exports (OOPSY ROS). These are the market-vetted present-value reference points
// plus the depth-chart rest-of-season playing time (PA/IP) baked into the export.
//
//   node scripts/build-auction-values.mjs <pitchers.csv> <hitters.csv>
//
// Columns used: Dollars, POS, PA (hitters) / IP (pitchers), mHR + mSB (hitters —
// the dollarized power+speed category value, our ROS "counting" signal), PlayerId
// (FanGraphs) and MLBAMID (MLBAM). Output is keyed by BOTH id types so it joins
// whichever the WAR sheet's `id` column carries. AUCTION_AS_OF is stamped to today
// so the app's PT blend knows how fresh the snapshot is.
import { readFileSync, writeFileSync } from 'node:fs';

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
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function load(path, isPitch, out) {
  const rows = parseCsv(readFileSync(path, 'latin1'));
  const h = rows[0].map((x) => x.trim());
  const col = (name) => h.indexOf(name);
  const di = col('Dollars'), pi = col('POS'), fgi = col('PlayerId'), mi = col('MLBAMID');
  const pai = col('PA'), ipi = col('IP'), hri = col('mHR'), sbi = col('mSB');
  const num = (c, i) => { const v = parseFloat(c[i]); return Number.isFinite(v) ? v : undefined; };
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const d = num(c, di);
    if (d === undefined) continue;
    const pos = (c[pi] || '').trim();
    const role = isPitch ? (pos === 'SP' ? 'SP' : 'RP') : 'HIT';
    const v = { d: Math.round(d * 10) / 10, r: role, pos };
    if (isPitch) {
      const ip = num(c, ipi); if (ip !== undefined) v.ip = Math.round(ip);
    } else {
      const pa = num(c, pai); if (pa !== undefined) v.pa = Math.round(pa);
      // ROS "counting" value = dollarized power + speed contribution (mHR + mSB).
      const hr = num(c, hri) ?? 0, sb = num(c, sbi) ?? 0;
      v.cnt = Math.round((hr + sb) * 10) / 10;
    }
    for (const k of [String(c[fgi] || '').trim(), String(c[mi] || '').trim()]) {
      // Two-way players appear in both exports (Ohtani): keep the higher-dollar
      // entry — his primary fantasy role — not just whichever loaded first.
      if (k && (!(k in out) || v.d > out[k].d)) out[k] = v;
    }
  }
}

const [, , pitchCsv, hitCsv] = process.argv;
if (!pitchCsv || !hitCsv) {
  console.error('usage: node scripts/build-auction-values.mjs <pitchers.csv> <hitters.csv>');
  process.exit(1);
}
const out = {};
load(pitchCsv, true, out);
load(hitCsv, false, out);

const asOf = new Date().toISOString().slice(0, 10);
const entry = (v) => {
  const parts = [`d: ${v.d}`, `r: '${v.r}'`];
  if (v.pos) parts.push(`pos: '${v.pos}'`);
  if (v.pa !== undefined) parts.push(`pa: ${v.pa}`);
  if (v.ip !== undefined) parts.push(`ip: ${v.ip}`);
  if (v.cnt !== undefined) parts.push(`cnt: ${v.cnt}`);
  return `{ ${parts.join(', ')} }`;
};

const lines = [
  '// Auction-calculator dollar values as a market-vetted PRESENT-VALUE reference.',
  `// Both sides ingested ${asOf} from OOPSY ROS auction exports. Carries the`,
  '// first-listed POSITION, the FanGraphs Depth-Chart rest-of-season playing time',
  '// (pa hitters / ip pitchers), and cnt = the dollarized ROS power+speed value',
  '// (mHR + mSB) — a current-form counting signal for PV. Keyed by BOTH FanGraphs',
  "// PlayerId and MLBAM id so it joins whichever the WAR sheet's `id` carries.",
  '// Regenerate with scripts/build-auction-values.mjs when projections update.',
  "export type AuctionRole = 'SP' | 'RP' | 'HIT';",
  `export const AUCTION_AS_OF: string | null = '${asOf}';`,
  'export const AUCTION_VALUES: Record<string, { d: number; r: AuctionRole; pos?: string; pa?: number; ip?: number; cnt?: number }> = {',
  ...Object.keys(out).sort().map((k) => `  '${k}': ${entry(out[k])},`),
  '};',
  '',
];
writeFileSync(new URL('../src/lib/auction-values.ts', import.meta.url), lines.join('\n'));
console.log(`Wrote ${Object.keys(out).length} keyed entries to src/lib/auction-values.ts (asOf ${asOf})`);
