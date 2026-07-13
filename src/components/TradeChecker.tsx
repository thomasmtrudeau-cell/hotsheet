'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { SearchResult, PremiumMetrics, InjuryStatus } from '@/lib/types';
import PremiumTeaser from './PremiumTeaser';

interface TradeCheckerProps {
  isPremium: boolean;
}

type Side = 'A' | 'B';
type Mode = 'adjusted' | 'peak';

// Compact premium chips for a player in the trade columns.
function Chips({ m, isPitcher, value, injured }: { m?: PremiumMetrics; isPitcher: boolean; value: number; injured?: boolean }) {
  const chip = 'px-1.5 py-0.5 rounded text-[10px] font-bold';
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      <span className={`${chip} bg-fuchsia-500/25 text-fuchsia-200`} title="Trade value in the selected mode">Val {value.toFixed(1)}</span>
      {injured && <span className={`${chip} bg-red-500/20 text-red-400`} title="On the injured list">IL</span>}
      {m?.war !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.war.toFixed(1)} WAR</span>}
      {m && !isPitcher && m.peakWrcPlus !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.peakWrcPlus} wRC+</span>}
      {m && isPitcher && m.era20 !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.era20.toFixed(2)} ERA/20</span>}
      {m && !isPitcher && m.speed && <span className={`${chip} bg-sky-500/20 text-sky-300`}>⚡{m.speed === 'double-plus' ? '++' : '+'}</span>}
      {m && !isPitcher && m.power && <span className={`${chip} bg-rose-500/20 text-rose-300`}>💪{m.power === 'double-plus' ? '++' : '+'}</span>}
      {m && !isPitcher && m.dual && !(m.speed && m.power) && <span className={`${chip} bg-amber-500/20 text-amber-200`}>⚡💪{m.dual === 'double-plus' ? '40+' : '30+'}</span>}
      {m && !isPitcher && m.def && <span className={`${chip} ${m.def.includes('plus') ? 'bg-green-500/20 text-green-300' : 'bg-red-500/15 text-red-300'}`}>🧤{m.def === 'double-plus' ? '++' : m.def === 'plus' ? '+' : m.def === 'double-minus' ? '−−' : '−'}</span>}
    </div>
  );
}

export default function TradeChecker({ isPremium }: TradeCheckerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [sideA, setSideA] = useState<SearchResult[]>([]);
  const [sideB, setSideB] = useState<SearchResult[]>([]);
  const [metrics, setMetrics] = useState<Record<number, PremiumMetrics>>({});
  const [injuries, setInjuries] = useState<Record<number, InjuryStatus | undefined>>({});
  const [mode, setMode] = useState<Mode>('adjusted');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch { setResults([]); }
  }, []);

  // Refresh premium metrics + injury status whenever either side changes.
  useEffect(() => {
    const all = [...sideA, ...sideB];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (all.length === 0) { setMetrics({}); setInjuries({}); return; }
    let active = true;
    fetch('/api/war', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: all }) })
      .then((r) => r.json()).then((d) => { if (active) setMetrics(d && typeof d === 'object' ? d : {}); }).catch(() => active && setMetrics({}));
    fetch('/api/players/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: all.map((p) => ({ ...p, followedAt: '' })) }) })
      .then((r) => r.json())
      .then((d) => { if (active && Array.isArray(d)) { const inj: Record<number, InjuryStatus | undefined> = {}; for (const p of d) inj[p.id] = p.injury; setInjuries(inj); } })
      .catch(() => {});
    return () => { active = false; };
  }, [sideA, sideB]);

  if (!isPremium) return <PremiumTeaser />;

  const inTrade = (id: number) => sideA.some((p) => p.id === id) || sideB.some((p) => p.id === id);
  const add = (r: SearchResult, side: Side) => {
    if (inTrade(r.id)) return;
    (side === 'A' ? setSideA : setSideB)((prev) => [...prev, r]);
    setQuery(''); setResults([]); setOpen(false);
  };
  const remove = (id: number, side: Side) =>
    (side === 'A' ? setSideA : setSideB)((prev) => prev.filter((p) => p.id !== id));

  // Value for a player in the current mode; adjusted mode also discounts injuries.
  const valueOf = (p: SearchResult) => {
    const m = metrics[p.id];
    if (!m) return 0;
    let v = (mode === 'peak' ? m.tradeValuePeak : m.tradeValue) ?? 0;
    if (mode === 'adjusted' && injuries[p.id]) v *= 0.85;
    return v;
  };
  const sumVal = (side: SearchResult[]) => side.reduce((t, p) => t + valueOf(p), 0);
  const diff = sumVal(sideA) - sumVal(sideB);

  const renderColumn = (side: Side, players: SearchResult[]) => (
    <div className="flex-1 min-w-0 rounded-lg border border-zinc-800 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-300">You {side === 'A' ? 'get' : 'give'}</span>
        <span className="text-xs text-fuchsia-200 font-bold">{sumVal(players).toFixed(1)} value</span>
      </div>
      {players.length === 0 ? (
        <p className="text-[11px] text-zinc-600 py-4 text-center">Search above, then tap <strong>+{side}</strong>.</p>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-zinc-100 truncate">{p.fullName} <span className="text-[11px] text-zinc-500">{p.primaryPosition}</span></div>
                <Chips m={metrics[p.id]} isPitcher={p.primaryPosition === 'P'} value={valueOf(p)} injured={Boolean(injuries[p.id])} />
              </div>
              <button onClick={() => remove(p.id, side)} className="shrink-0 text-zinc-600 hover:text-red-400 cursor-pointer text-sm" title="Remove">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-xl">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); if (debounceRef.current) clearTimeout(debounceRef.current); debounceRef.current = setTimeout(() => search(e.target.value), 300); }}
            onFocus={() => query.length >= 2 && setOpen(true)}
            placeholder="Search a player to add to the trade…"
            className="w-full px-4 py-2.5 bg-zinc-800/80 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 text-sm"
          />
          {open && query.length >= 2 && results.length > 0 && (
            <div className="absolute z-40 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-72 overflow-y-auto">
              {results.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50 last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-100 truncate">{r.fullName}</div>
                    <div className="text-[11px] text-zinc-500">{r.primaryPosition} · {r.currentTeam.name}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {(['A', 'B'] as const).map((s) => (
                      <button key={s} onClick={() => add(r, s)} disabled={inTrade(r.id)}
                        className="px-2 py-1 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-default cursor-pointer">+{s}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Peak vs time/risk-adjusted value */}
        <div className="flex rounded-lg overflow-hidden border border-zinc-700 shrink-0">
          {(['adjusted', 'peak'] as const).map((mo) => (
            <button key={mo} onClick={() => setMode(mo)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${mode === mo ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
              title={mo === 'adjusted' ? 'Discounts far-away prospects, age, and injuries' : 'Raw ceiling — no time/risk discount'}>
              {mo === 'adjusted' ? 'Adjusted' : 'Peak'}
            </button>
          ))}
        </div>
      </div>

      {(sideA.length > 0 || sideB.length > 0) && (
        <div className="mb-4 text-center text-sm">
          {Math.abs(diff) < 2
            ? <span className="text-zinc-300">Fair trade — within a couple of value points.</span>
            : <span className="text-emerald-300 font-semibold">Edge to the side you {diff > 0 ? 'get' : 'give'} — by {Math.abs(diff).toFixed(1)} value</span>}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3">
        {renderColumn('A', sideA)}
        {renderColumn('B', sideB)}
      </div>
      <p className="text-[11px] text-zinc-600 mt-3">
        {mode === 'adjusted'
          ? 'Adjusted value: WAR above the 2.4 replacement bar + fantasy (wRC+/HR/SB), discounted for age, distance from the majors, and injuries.'
          : 'Peak value: the raw ceiling (WAR-surplus + fantasy), no time or risk discount.'} Premium.
      </p>
    </div>
  );
}
