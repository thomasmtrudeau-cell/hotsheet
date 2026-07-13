// Regenerates src/lib/auction-values.ts from FanGraphs auction-calculator CSV
// exports. These are the market-vetted present-value reference points; refresh
// them when the season's projections update.
//
//   node scripts/build-auction-values.mjs <pitchers.csv> <hitters.csv>
//
// Each CSV must have the standard auction-calculator columns, including
// `Dollars`, `POS`, `PlayerId` (FanGraphs) and `MLBAMID` (MLBAM). We key the
// output by BOTH id types so it joins whichever the WAR sheet's `id` uses.
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
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const h = rows[0].map((x) => x.trim());
  const di = h.indexOf('Dollars'), pi = h.indexOf('POS');
  const fgi = h.indexOf('PlayerId'), mi = h.indexOf('MLBAMID');
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const d = parseFloat(c[di]);
    if (!Number.isFinite(d)) continue;
    const pos = (c[pi] || '').trim();
    const role = isPitch ? (pos === 'SP' ? 'SP' : 'RP') : 'HIT';
    const v = { d: Math.round(d * 10) / 10, r: role };
    for (const k of [String(c[fgi] || '').trim(), String(c[mi] || '').trim()]) {
      if (k && !(k in out)) out[k] = v;
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

const lines = [
  '// Auction-calculator dollar values as a market-vetted PRESENT-VALUE reference.',
  "// Keyed by BOTH FanGraphs PlayerId and MLBAM id so it joins whichever the WAR",
  '// sheet\'s `id` column carries. r = role for the free-agent replacement line',
  '// (SP ~ $1, RP ~ $3, HIT ~ $5 are freely available). Regenerate with',
  '// scripts/build-auction-values.mjs when the season\'s projections update.',
  "export type AuctionRole = 'SP' | 'RP' | 'HIT';",
  'export const AUCTION_VALUES: Record<string, { d: number; r: AuctionRole }> = {',
  ...Object.keys(out).sort().map((k) => `  '${k}': { d: ${out[k].d}, r: '${out[k].r}' },`),
  '};',
  '',
];
writeFileSync(new URL('../src/lib/auction-values.ts', import.meta.url), lines.join('\n'));
console.log(`Wrote ${Object.keys(out).length} keyed entries to src/lib/auction-values.ts`);
