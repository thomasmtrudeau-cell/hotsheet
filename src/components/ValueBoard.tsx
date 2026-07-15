'use client';

import { useState, useEffect, useMemo } from 'react';
import { computeValue, abilityCurve, LeagueSettings } from '@/lib/value-model';
import { PremiumMetrics } from '@/lib/types';

type BoardRow = { player: string; nameKey: string; isPitcher: boolean } & PremiumMetrics;
type LensDef = { key: string; label: string; short: string; weights: number[]; fvShare: number };
type SortKey = 'war' | 'pv' | 'fv' | string; // lens shorts too

const LEVELS = ['MLB', 'AAA', 'AA', 'A+', 'A', 'Rk'] as const;
type Level = (typeof LEVELS)[number];
function levelBucket(lvl?: string): Level {
  const l = (lvl ?? '').toUpperCase();
  if (l.includes('MLB') || l.includes('MAJOR')) return 'MLB';
  if (l.includes('AAA')) return 'AAA';
  if (l.includes('AA')) return 'AA';
  if (l.includes('A+') || l.includes('HIGH')) return 'A+';
  if (l === 'A' || l.includes('LOW') || l.includes('SINGLE')) return 'A';
  return 'Rk';
}
const arrivalYear = (b: Level) => (b === 'AAA' ? 1 : b === 'AA' ? 2 : 3);

// The Value Board: every projected player scored by the BASE model (sheet + age
// curves + league settings) across all grades — an implicit ranking per build,
// for bulk calibration review. Live layers (park, injury, playing time, saves)
// apply only in the trade view, so a few rows (e.g. closers) read low here.
export default function ValueBoard({ settings, lenses, isFollowing }: {
  settings: LeagueSettings;
  lenses: LensDef[];
  isFollowing: (name: string) => boolean;
}) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<'all' | 'hitter' | 'pitcher'>('all');
  const [levels, setLevels] = useState<Set<Level>>(new Set(LEVELS));
  const [minWar, setMinWar] = useState(1.5);
  const [sort, setSort] = useState<SortKey>('OV');

  const [pitchersLoading, setPitchersLoading] = useState(false);
  useEffect(() => {
    // Hitters render immediately; pitchers stream in behind (each side is its
    // own sheet-tab fetch — combined they made a ~20s cold load).
    setLoading(true); setPitchersLoading(true);
    fetch('/api/values?side=bat')
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
    fetch('/api/values?side=pit')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.rows)) setRows((prev) => [...prev.filter((x) => !x.isPitcher), ...d.rows]); })
      .catch(() => {})
      .finally(() => setPitchersLoading(false));
  }, []);

  const graded = useMemo(() => {
    return rows.map((r) => {
      const inputs = {
        isPitcher: r.isPitcher, position: undefined,
        war: r.war, peakWrcPlus: r.peakWrcPlus, era20: r.era20, hr: r.hr, sb: r.sb,
        curWrcPlus: r.curWrcPlus, curEra20: r.curEra20,
        age: r.age, level: r.level, marketBaseline: r.marketBaseline,
        defRuns: r.defRuns, ipg: r.ipg,
      };
      const base = computeValue(inputs, settings);
      const bucket = levelBucket(r.level);
      const inMajors = bucket === 'MLB';
      const age = r.age ?? 27;
      // Per-season projection, mirroring the Trade Checker's base track.
      const seasons: number[] = [];
      if (inMajors) {
        const cur = abilityCurve(age, r.isPitcher) || 1;
        for (let k = 0; k <= 6; k++) seasons.push(k === 0 ? base.present : base.present * (abilityCurve(age + k, r.isPitcher) / cur));
      } else {
        const arr = arrivalYear(bucket);
        const peakAnnual = computeValue({ ...inputs, age: 27, level: 'MLB' }, settings).present;
        for (let k = 0; k <= 6; k++) seasons.push(k < arr ? 0 : peakAnnual * abilityCurve(age + k, r.isPitcher));
      }
      const grades: Record<string, number> = { PV: base.present, FV: base.future };
      for (const l of lenses) {
        const wSum = l.weights.reduce((a, b) => a + b, 0);
        const wa = l.weights.reduce((acc, w, k) => acc + w * (seasons[k] ?? 0), 0) / wSum;
        grades[l.short] = (1 - l.fvShare) * wa + l.fvShare * base.future;
      }
      return { ...r, bucket, grades };
    });
  }, [rows, settings, lenses]);

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    const arr = graded.filter((r) =>
      (r.war ?? 0) >= minWar &&
      levels.has(r.bucket) &&
      (pos === 'all' || (pos === 'pitcher') === r.isPitcher) &&
      (!f || r.player.toLowerCase().includes(f))
    );
    const key = sort;
    arr.sort((a, b) => (key === 'war' ? (b.war ?? 0) - (a.war ?? 0) : (b.grades[key] ?? 0) - (a.grades[key] ?? 0)));
    return arr.slice(0, 300);
  }, [graded, q, pos, levels, minWar, sort]);

  const toggleLevel = (l: Level) => setLevels((prev) => {
    const next = new Set(prev);
    if (next.has(l)) next.delete(l); else next.add(l);
    return next.size ? next : prev;
  });

  const cols: { key: SortKey; label: string }[] = [
    { key: 'war', label: 'WAR' }, { key: 'PV', label: 'PV' }, { key: 'FV', label: 'FV' },
    ...lenses.map((l) => ({ key: l.short, label: l.short })),
  ];

  if (loading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-orange-500 rounded-full animate-spin" />
        <p className="text-[11px] text-zinc-500">Pricing every projected player (thousands of them) — the first load can take ~10s, then it&apos;s cached.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] text-zinc-500 mb-3">
        Every projected player through the <span className="text-zinc-300">base model</span> (league-settings aware) — sort any column for an implicit ranking per build. Live layers (park, injury, playing time, <span className="text-zinc-400">saves</span>) apply only in the trade view, so closers and role-risk guys read differently there.
      </p>

      {/* Filters */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 mb-3 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name…"
          className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-orange-500 w-40" />
        <div className="flex rounded overflow-hidden border border-zinc-700">
          {(['all', 'hitter', 'pitcher'] as const).map((p) => (
            <button key={p} onClick={() => setPos(p)}
              className={`px-2 py-0.5 text-[11px] cursor-pointer ${pos === p ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              {p === 'all' ? 'All' : p === 'hitter' ? 'Hitters' : 'Pitchers'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Levels</span>
          {LEVELS.map((l) => (
            <button key={l} onClick={() => toggleLevel(l)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${levels.has(l) ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>{l}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-zinc-400">
          WAR ≥ <span className="font-mono font-bold text-amber-300 w-8">{minWar.toFixed(1)}</span>
          <input type="range" min={0} max={5} step={0.1} value={minWar} onChange={(e) => setMinWar(parseFloat(e.target.value))} className="accent-amber-500 w-32 cursor-pointer" />
        </label>
        <span className="text-zinc-600 ml-auto">{pitchersLoading && <span className="text-amber-400/80 mr-2">pitchers loading…</span>}{shown.length} shown{shown.length === 300 ? ' (top 300)' : ''}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 sticky top-0">
            <tr>
              <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-zinc-500">#</th>
              <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-zinc-500">Player</th>
              <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-zinc-500">Lvl</th>
              <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-zinc-500">Age</th>
              {cols.map((c) => (
                <th key={c.key} onClick={() => setSort(c.key)}
                  className={`px-2 py-1.5 text-right text-[10px] uppercase tracking-wider cursor-pointer hover:text-zinc-200 ${sort === c.key ? 'text-orange-300' : 'text-zinc-500'}`}>
                  {c.label}{sort === c.key ? ' ↓' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.nameKey + (r.isPitcher ? 'p' : 'h')} className="border-t border-zinc-800/60 hover:bg-zinc-800/30">
                <td className="px-2 py-1 text-zinc-600 font-mono">{i + 1}</td>
                <td className="px-2 py-1 text-zinc-100 whitespace-nowrap">
                  {r.player} <span className="text-zinc-600">{r.isPitcher ? (r.ipg !== undefined && r.ipg < 2.01 ? 'RP' : 'P') : 'H'}</span>
                  {isFollowing(r.player) && <span className="text-blue-300" title="In your list"> ★</span>}
                </td>
                <td className="px-2 py-1 text-amber-400/80">{r.bucket}</td>
                <td className="px-2 py-1 text-zinc-500">{r.age !== undefined ? Math.round(r.age) : '—'}</td>
                <td className="px-2 py-1 text-right font-mono text-amber-300">{(r.war ?? 0).toFixed(1)}</td>
                <td className="px-2 py-1 text-right font-mono text-blue-200">{r.grades.PV.toFixed(1)}</td>
                <td className="px-2 py-1 text-right font-mono text-fuchsia-200">{r.grades.FV.toFixed(1)}</td>
                {lenses.map((l) => (
                  <td key={l.short} className={`px-2 py-1 text-right font-mono ${sort === l.short ? 'text-orange-300 font-bold' : 'text-zinc-300'}`}>{r.grades[l.short].toFixed(1)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
