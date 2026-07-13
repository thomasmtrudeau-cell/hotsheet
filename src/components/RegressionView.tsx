'use client';

import { useState, useEffect, useMemo } from 'react';
import { RegressionRow } from '@/lib/types';
import PremiumTeaser from './PremiumTeaser';

interface RegressionViewProps {
  rows: RegressionRow[];
  loading: boolean;
  isPremium: boolean;
  isFollowing: (name: string) => boolean;
}

const FILTERS_KEY = 'hotsheet_regression_filters';
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

function List({ title, subtitle, rows, tone, isFollowing }: {
  title: string; subtitle: string; rows: RegressionRow[]; tone: 'sell' | 'buy'; isFollowing: (name: string) => boolean;
}) {
  const accent = tone === 'sell' ? 'text-red-300' : 'text-emerald-300';
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-zinc-800 p-3">
      <div className={`text-sm font-semibold ${accent}`}>{title}</div>
      <div className="text-[11px] text-zinc-500 mb-2">{subtitle}</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-zinc-600 py-4 text-center">Nothing matches these filters.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.nameKey} className="flex items-center justify-between gap-2 text-xs px-1 py-1">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-zinc-100 truncate">{r.player}</span>
                <span className="text-[10px] text-amber-400/80">{levelBucket(r.level)}</span>
                {r.role && <span className={`text-[10px] ${r.role === 'RP' ? 'text-purple-300/80' : 'text-zinc-500'}`} title={r.role === 'RP' ? 'Pitching in relief this year' : 'In the rotation'}>{r.role}</span>}
                {r.il && <span className="text-[10px] px-1 rounded bg-red-500/20 text-red-400" title="Currently on the IL — small sample / anomalous line">IL</span>}
                {isFollowing(r.player) && <span className="text-[10px] text-blue-300" title="In your list">★</span>}
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap font-mono">
                <span className={accent}>{r.delta > 0 ? '+' : ''}{r.delta.toFixed(2)}</span>
                <span className="text-zinc-500">{r.currentEra20.toFixed(2)} ERA{r.ip ? ` (${Math.round(r.ip)} IP)` : ''} · {r.peakEra20.toFixed(2)} proj</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RegressionView({ rows, loading, isPremium, isFollowing }: RegressionViewProps) {
  const [eraCut, setEraCut] = useState(4.3);
  const [gap, setGap] = useState(0.3);
  const [levels, setLevels] = useState<Set<Level>>(new Set(LEVELS));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (typeof s.eraCut === 'number') setEraCut(s.eraCut);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (typeof s.gap === 'number') setGap(s.gap);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(s.levels) && s.levels.length) setLevels(new Set(s.levels));
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify({ eraCut, gap, levels: [...levels] })); } catch { /* ignore */ }
  }, [eraCut, gap, levels]);

  const toggleLevel = (l: Level) => setLevels((prev) => {
    const next = new Set(prev);
    if (next.has(l)) next.delete(l); else next.add(l);
    return next.size ? next : prev; // never allow zero levels
  });

  const { sellHighs, buyLows } = useMemo(() => {
    const inScope = rows.filter((r) => r.peakEra20 <= eraCut && levels.has(levelBucket(r.level)));
    return {
      sellHighs: inScope.filter((r) => r.delta <= -gap).sort((a, b) => a.delta - b.delta).slice(0, 60),
      buyLows: inScope.filter((r) => r.delta >= gap).sort((a, b) => b.delta - a.delta).slice(0, 60),
    };
  }, [rows, eraCut, gap, levels]);

  if (!isPremium) return <PremiumTeaser />;
  if (loading && rows.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] text-zinc-500 mb-3">
        Starters (SP &amp; SP prospects) whose <span className="text-zinc-300">actual current-year ERA</span> (live from the MLB/MiLB API, min {' '}20 IP) has drifted from their{' '}
        <span className="text-zinc-300 underline decoration-dotted cursor-help" title="The sheet's 'era 20 tbf/g' column — the regressed true-talent projection: what he should pitch to over a full, normalized 20-batters-faced-per-game workload. (ERA/20 runs ~0.2 above traditional ERA, so on-talent arms sit slightly negative.)">peak (true-talent) ERA/20 projection</span>
        {' '}— the gap is the regression signal.
      </p>

      {/* Filters */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
        <label className="flex items-center gap-2 text-zinc-400">
          Peak ERA/20 ≤ <span className="font-mono font-bold text-zinc-100 w-9">{eraCut.toFixed(2)}</span>
          <input type="range" min={2.5} max={5.5} step={0.05} value={eraCut} onChange={(e) => setEraCut(parseFloat(e.target.value))} className="accent-emerald-500 w-32 cursor-pointer" />
        </label>
        <label className="flex items-center gap-2 text-zinc-400">
          Min gap <span className="font-mono font-bold text-zinc-100 w-9">{gap.toFixed(2)}</span>
          <input type="range" min={0.1} max={1.5} step={0.05} value={gap} onChange={(e) => setGap(parseFloat(e.target.value))} className="accent-emerald-500 w-32 cursor-pointer" />
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Levels</span>
          {LEVELS.map((l) => (
            <button key={l} onClick={() => toggleLevel(l)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${levels.has(l) ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <List title="⬆️ Sell high" subtitle="Pitching under their projection — regression up looms" rows={sellHighs} tone="sell" isFollowing={isFollowing} />
        <List title="⬇️ Buy low" subtitle="Pitching over their projection — bounce-back candidates" rows={buyLows} tone="buy" isFollowing={isFollowing} />
      </div>
    </div>
  );
}
