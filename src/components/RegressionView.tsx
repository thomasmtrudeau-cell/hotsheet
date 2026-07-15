'use client';

import { useState, useEffect, useMemo } from 'react';
import { RegressionRow, HitterRegressionRow } from '@/lib/types';
import { HOME_PARK_PF } from '@/lib/parks';
import PremiumTeaser from './PremiumTeaser';
import Tooltip from './Tooltip';

// IL tooltip from real MLB data only (no speculation): type, since-date +
// days on the IL, and the injury reason.
function ilTooltip(r: RegressionRow): string {
  let head = `On the ${r.ilLabel ?? 'IL'}`;
  if (r.ilSince) {
    const days = Math.max(0, Math.round((Date.now() - new Date(r.ilSince + 'T00:00:00Z').getTime()) / 86_400_000));
    head += ` since ${r.ilSince} (${days} day${days === 1 ? '' : 's'})`;
  }
  return r.ilNote ? `${head}\n${r.ilNote}` : head;
}

interface RegressionViewProps {
  rows: RegressionRow[];
  hitters: HitterRegressionRow[];
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
            <div key={r.nameKey} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs px-1 py-1">
              <div className="min-w-0 flex-1 basis-[200px] flex items-center gap-1.5">
                <span className="text-zinc-100 truncate">{r.player}</span>
                <span className="text-[10px] text-amber-400/80">{levelBucket(r.level)}</span>
                {r.role && <span className={`text-[10px] ${r.role === 'RP' ? 'text-purple-300/80' : 'text-zinc-500'}`} title={r.role === 'RP' ? 'Pitching in relief this year' : 'In the rotation'}>{r.role}</span>}
                {r.il && <Tooltip text={ilTooltip(r)}><span className="text-[10px] px-1 rounded bg-red-500/20 text-red-400 cursor-help">IL</span></Tooltip>}
                {isFollowing(r.player) && <span className="text-[10px] text-blue-300" title="In your list">★</span>}
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap font-mono ml-auto">
                {(() => {
                  const pf = r.team ? HOME_PARK_PF[r.team] : undefined;
                  if (pf === undefined || Math.abs(pf - 100) < 3) return null;
                  const friendly = pf < 100; // low run factor = pitcher park
                  return (
                    <Tooltip text={`${r.team} plays ${friendly ? 'pitcher' : 'hitter'}-friendly (park factor ${pf}). His ACTUAL ERA is ${friendly ? 'flattered' : 'inflated'} by the park — the projection is park-neutral, so read the gap with that in mind.`}>
                      <span className={`text-[10px] px-1 rounded font-sans cursor-help ${friendly ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>park{friendly ? '+' : '−'}</span>
                    </Tooltip>
                  );
                })()}
                <span className={accent}>{r.delta > 0 ? '+' : ''}{r.delta.toFixed(2)}</span>
                <span className="text-zinc-500">{r.currentEra20.toFixed(2)} ERA{r.ip ? ` (${Math.round(r.ip)} IP)` : ''} · <Tooltip text="Park-neutral true-talent projection — what he'd pitch to in a neutral park at a normalized 20-BF/G workload."><span className="underline decoration-dotted decoration-zinc-700">{r.peakEra20.toFixed(2)} proj</span></Tooltip></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function HitTools({ r }: { r: HitterRegressionRow }) {
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

function HitList({ title, subtitle, rows, tone, isFollowing }: { title: string; subtitle: string; rows: HitterRegressionRow[]; tone: 'sell' | 'buy'; isFollowing: (name: string) => boolean }) {
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
            <div key={r.nameKey} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs px-1 py-1">
              <div className="min-w-0 flex-1 basis-[200px] flex items-center gap-1.5">
                <span className="text-zinc-100 truncate">{r.player}</span>
                <span className="text-[10px] text-amber-400/80">{levelBucket(r.level)}</span>
                {r.age !== undefined && <span className="text-[10px] text-zinc-600">{Math.round(r.age)}yo</span>}
                {r.age !== undefined && r.age <= 24 && r.delta < 0 && (
                  <Tooltip text="Pre-peak: the projection is his PEAK — running under it at his age is development, not decline. Don't read this gap as a fade.">
                    <span className="text-[10px] px-1 rounded bg-sky-500/20 text-sky-300 cursor-help">pre-peak</span>
                  </Tooltip>
                )}
                <HitTools r={r} />
                {isFollowing(r.player) && <span className="text-[10px] text-blue-300" title="In your list">★</span>}
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap font-mono ml-auto">
                <span className={accent}>{r.delta > 0 ? '+' : ''}{r.delta}</span>
                <span className="text-zinc-500">{r.curWrc} now · <Tooltip text="Peak wRC+ projection — his ceiling season, not necessarily this season."><span className="underline decoration-dotted decoration-zinc-700">{r.peakWrc} peak</span></Tooltip></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RegressionView({ rows, hitters, loading, isPremium, isFollowing }: RegressionViewProps) {
  const [mode, setMode] = useState<'pitchers' | 'hitters'>('pitchers');
  const [regSide, setRegSide] = useState<'sell' | 'buy'>('buy'); // one full-width list at a time — room for badges
  const [eraCut, setEraCut] = useState(4.3);
  const [gap, setGap] = useState(0.3);
  const [wrcCut, setWrcCut] = useState(100);  // hitters: peak wRC+ ≥
  const [wGap, setWGap] = useState(10);       // hitters: min |current − peak|
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
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (typeof s.wrcCut === 'number') setWrcCut(s.wrcCut);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (typeof s.wGap === 'number') setWGap(s.wGap);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (s.mode === 'pitchers' || s.mode === 'hitters') setMode(s.mode);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (s.regSide === 'sell' || s.regSide === 'buy') setRegSide(s.regSide);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify({ eraCut, gap, wrcCut, wGap, mode, regSide, levels: [...levels] })); } catch { /* ignore */ }
  }, [eraCut, gap, wrcCut, wGap, mode, regSide, levels]);

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

  const { hotBats, coldBats } = useMemo(() => {
    const inScope = hitters.filter((r) => r.peakWrc >= wrcCut && levels.has(levelBucket(r.level)));
    return {
      hotBats: inScope.filter((r) => r.delta >= wGap).sort((a, b) => b.delta - a.delta).slice(0, 60),
      coldBats: inScope.filter((r) => r.delta <= -wGap).sort((a, b) => a.delta - b.delta).slice(0, 60),
    };
  }, [hitters, wrcCut, wGap, levels]);

  if (!isPremium) return <PremiumTeaser context="regression" />;
  if (loading && rows.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex rounded-lg overflow-hidden border border-zinc-700 w-fit mb-3">
        <button onClick={() => setMode('pitchers')} className={`px-3 py-1.5 text-sm font-medium cursor-pointer ${mode === 'pitchers' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>Pitchers</button>
        <button onClick={() => setMode('hitters')} className={`px-3 py-1.5 text-sm font-medium cursor-pointer ${mode === 'hitters' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>Bats <span className="text-[9px] uppercase tracking-wide opacity-70 align-middle">exp</span></button>
      </div>

      {mode === 'hitters' ? (
      <>
      <p className="text-[11px] text-zinc-500 mb-3">
        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-semibold mr-1.5">EXPERIMENTAL</span>
        Hitters whose <span className="text-zinc-300">current-year wRC+</span> has drifted from their{' '}
        <span className="text-zinc-300 underline decoration-dotted cursor-help" title="The sheet's peak wRC+ projection — his ceiling season. A pre-peak player normally runs UNDER it; that's development, not decline.">peak wRC+ projection</span>.
        Note the projection is <span className="text-zinc-300">peak</span>, so young pre-peak bats may not project this well right now (they get a <span className="text-sky-300">pre-peak</span> tag). Rest-of-season OOPSY projections may come later.
      </p>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
        <label className="flex items-center gap-2 text-zinc-400">
          Peak wRC+ ≥ <span className="font-mono font-bold text-zinc-100 w-8">{wrcCut}</span>
          <input type="range" min={80} max={140} step={1} value={wrcCut} onChange={(e) => setWrcCut(parseInt(e.target.value, 10))} className="accent-emerald-500 w-32 cursor-pointer" />
        </label>
        <label className="flex items-center gap-2 text-zinc-400">
          Min gap <span className="font-mono font-bold text-zinc-100 w-8">{wGap}</span>
          <input type="range" min={5} max={40} step={1} value={wGap} onChange={(e) => setWGap(parseInt(e.target.value, 10))} className="accent-emerald-500 w-32 cursor-pointer" />
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

      <div className="flex rounded-lg overflow-hidden border border-zinc-700 w-fit mb-3">
        <button onClick={() => setRegSide('buy')} className={`px-3 py-1.5 text-sm font-medium cursor-pointer ${regSide === 'buy' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>⬇️ Buy low</button>
        <button onClick={() => setRegSide('sell')} className={`px-3 py-1.5 text-sm font-medium cursor-pointer ${regSide === 'sell' ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>⬆️ Sell high</button>
      </div>
      {regSide === 'sell'
        ? <HitList title="⬆️ Sell high" subtitle="His current wRC+ is running ABOVE what his skills project — hitting over his head. Sell while the line looks great." rows={hotBats} tone="sell" isFollowing={isFollowing} />
        : <HitList title="⬇️ Buy low" subtitle="His current wRC+ is BELOW what his skills project — the bat is better than the results so far (mind the pre-peak tag on young guys)." rows={coldBats} tone="buy" isFollowing={isFollowing} />}
      </>
      ) : (
      <>
      <p className="text-[11px] text-zinc-500 mb-3">
        Starters (SP &amp; SP prospects) whose <span className="text-zinc-300">actual current-year ERA</span> (live from the MLB/MiLB API, min {' '}20 IP) has drifted from their{' '}
        <span className="text-zinc-300 underline decoration-dotted cursor-help" title="The sheet's 'era 20 tbf/g' column — the regressed true-talent projection: what he should pitch to over a full, normalized 20-batters-faced-per-game workload. (ERA/20 runs ~0.2 above traditional ERA, so on-talent arms sit slightly negative.)">peak (true-talent) ERA/20 projection</span> <span className="text-zinc-500">(park-neutral — 🏟 flags pitchers whose actual ERA is park-flattered/inflated)</span>
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

      <div className="flex rounded-lg overflow-hidden border border-zinc-700 w-fit mb-3">
        <button onClick={() => setRegSide('buy')} className={`px-3 py-1.5 text-sm font-medium cursor-pointer ${regSide === 'buy' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>⬇️ Buy low</button>
        <button onClick={() => setRegSide('sell')} className={`px-3 py-1.5 text-sm font-medium cursor-pointer ${regSide === 'sell' ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>⬆️ Sell high</button>
      </div>
      {regSide === 'sell'
        ? <List title="⬆️ Sell high" subtitle="His actual ERA is BETTER than his rest-of-season talent projection — results this good usually don't last. Trade him while the surface stats shine." rows={sellHighs} tone="sell" isFollowing={isFollowing} />
        : <List title="⬇️ Buy low" subtitle="His actual ERA is WORSE than his rest-of-season talent projection — the skills say he's better than the results. Acquire while the price is down." rows={buyLows} tone="buy" isFollowing={isFollowing} />}
      </>
      )}
    </div>
  );
}
