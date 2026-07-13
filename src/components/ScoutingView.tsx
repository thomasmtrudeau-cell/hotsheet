'use client';

import { useState, useEffect, useMemo } from 'react';
import { ScoutingRow } from '@/lib/types';
import PremiumTeaser from './PremiumTeaser';

interface ScoutingViewProps {
  rows: ScoutingRow[];
  loading: boolean;
  isPremium: boolean;
  isFollowing: (name: string) => boolean;
}

const FILTERS_KEY = 'hotsheet_scouting_filters';
const LEVELS = ['MLB', 'AAA', 'AA', 'A+', 'A', 'Rk'] as const;
type Level = (typeof LEVELS)[number];
type Pos = 'all' | 'hitter' | 'pitcher';

function levelBucket(lvl?: string): Level {
  const l = (lvl ?? '').toUpperCase();
  if (l.includes('MLB') || l.includes('MAJOR')) return 'MLB';
  if (l.includes('AAA')) return 'AAA';
  if (l.includes('AA')) return 'AA';
  if (l.includes('A+') || l.includes('HIGH')) return 'A+';
  if (l === 'A' || l.includes('LOW') || l.includes('SINGLE')) return 'A';
  return 'Rk';
}

function Tools({ r }: { r: ScoutingRow }) {
  const chip = 'px-1 py-0.5 rounded text-[9px] font-bold';
  return (
    <span className="inline-flex gap-1">
      {r.dual && <span className={`${chip} bg-amber-500/20 text-amber-200`}>⚡💪{r.dual === 'double-plus' ? '40+' : '30+'}</span>}
      {!r.dual && r.power && <span className={`${chip} bg-amber-500/20 text-amber-200`}>💪{r.power === 'double-plus' ? '++' : '+'}</span>}
      {!r.dual && r.speed && <span className={`${chip} bg-amber-500/20 text-amber-200`}>⚡{r.speed === 'double-plus' ? '++' : '+'}</span>}
      {r.def && <span className={`${chip} ${r.def.includes('plus') ? 'bg-green-500/20 text-green-300' : 'bg-red-500/15 text-red-300'}`}>🧤{r.def === 'double-plus' ? '++' : r.def === 'plus' ? '+' : r.def === 'double-minus' ? '−−' : '−'}</span>}
    </span>
  );
}

export default function ScoutingView({ rows, loading, isPremium, isFollowing }: ScoutingViewProps) {
  const [minWar, setMinWar] = useState(2.0);
  const [levels, setLevels] = useState<Set<Level>>(new Set(LEVELS));
  const [pos, setPos] = useState<Pos>('all');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (typeof s.minWar === 'number') setMinWar(s.minWar);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(s.levels) && s.levels.length) setLevels(new Set(s.levels));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (s.pos === 'all' || s.pos === 'hitter' || s.pos === 'pitcher') setPos(s.pos);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify({ minWar, levels: [...levels], pos })); } catch { /* ignore */ }
  }, [minWar, levels, pos]);

  const toggleLevel = (l: Level) => setLevels((prev) => {
    const next = new Set(prev);
    if (next.has(l)) next.delete(l); else next.add(l);
    return next.size ? next : prev;
  });

  const filtered = useMemo(() => rows
    .filter((r) => r.war >= minWar && levels.has(levelBucket(r.level)) && (pos === 'all' || (pos === 'pitcher') === r.isPitcher))
    .sort((a, b) => b.war - a.war)
    .slice(0, 200), [rows, minWar, levels, pos]);

  if (!isPremium) return <PremiumTeaser />;
  if (loading && rows.length === 0) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div>
      <p className="text-[11px] text-zinc-500 mb-3">Every projected player by peak-WAR ceiling — scout prospects across all levels, rookie ball included.</p>

      {/* Filters */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
        <label className="flex items-center gap-2 text-zinc-400">
          WAR ≥ <span className="font-mono font-bold text-amber-300 w-8">{minWar.toFixed(1)}</span>
          <input type="range" min={1.0} max={5.0} step={0.1} value={minWar} onChange={(e) => setMinWar(parseFloat(e.target.value))} className="accent-amber-500 w-40 cursor-pointer" />
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Levels</span>
          {LEVELS.map((l) => (
            <button key={l} onClick={() => toggleLevel(l)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${levels.has(l) ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>{l}</button>
          ))}
        </div>
        <div className="flex rounded overflow-hidden border border-zinc-700">
          {(['all', 'hitter', 'pitcher'] as const).map((p) => (
            <button key={p} onClick={() => setPos(p)}
              className={`px-2 py-0.5 text-[11px] cursor-pointer ${pos === p ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              {p === 'all' ? 'All' : p === 'hitter' ? 'Hitters' : 'Pitchers'}
            </button>
          ))}
        </div>
        <span className="text-zinc-600 ml-auto">{filtered.length} shown</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-[11px] text-zinc-600 py-8 text-center">No players match these filters.</p>
      ) : (
        <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800/60">
          {filtered.map((r) => (
            <div key={r.nameKey + (r.isPitcher ? 'p' : 'h')} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-zinc-100 truncate">{r.player}</span>
                <span className="text-[10px] text-zinc-500">{r.isPitcher ? 'P' : 'H'}</span>
                <span className="text-[10px] text-amber-400/80">{levelBucket(r.level)}</span>
                {r.age !== undefined && <span className="text-[10px] text-zinc-600">{Number.isInteger(r.age) ? r.age : r.age.toFixed(1)}yo</span>}
                {isFollowing(r.player) && <span className="text-[10px] text-blue-300" title="In your list">★</span>}
                <Tools r={r} />
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap font-mono shrink-0">
                {r.isPitcher
                  ? (r.era20 !== undefined && <span className="text-zinc-500">{r.era20.toFixed(2)} ERA/20</span>)
                  : (r.wrcPlus !== undefined && <span className="text-zinc-500">{r.wrcPlus} wRC+</span>)}
                <span className="text-amber-300 font-bold w-10 text-right">{r.war.toFixed(1)} WAR</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
