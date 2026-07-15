'use client';

import { useState, useEffect, useMemo } from 'react';
import { ScoutingRow, SearchResult, FollowedPlayer, Group } from '@/lib/types';
import PremiumTeaser from './PremiumTeaser';

interface ScoutingViewProps {
  rows: ScoutingRow[];
  loading: boolean;
  isPremium: boolean;
  isFollowing: (name: string) => boolean;
  onFollow: (player: FollowedPlayer, groupIds?: string[]) => void;
  groups: Group[];
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

export default function ScoutingView({ rows, loading, isPremium, isFollowing, onFollow, groups }: ScoutingViewProps) {
  const [minWar, setMinWar] = useState(2.0);
  const [levels, setLevels] = useState<Set<Level>>(new Set(LEVELS));
  const [pos, setPos] = useState<Pos>('all');
  const [rowState, setRowState] = useState<Record<string, 'busy' | 'fail' | undefined>>({});
  const [openList, setOpenList] = useState<string | null>(null); // rowKey with the list-picker open

  // Scouting rows come from the projection sheet (name only, no MLB id) — resolve
  // through player search before following. Prefer an exact name match on the right
  // side of the ball, and a minor leaguer over a same-named big leaguer (this tab
  // is prospects).
  const resolve = async (r: ScoutingRow): Promise<SearchResult | null> => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(r.player)}`);
      const data: SearchResult[] = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
      const target = norm(r.player);
      const exact = data.filter((d) => norm(d.fullName) === target);
      const sided = (exact.length ? exact : data).filter((d) => (d.primaryPosition === 'P') === r.isPitcher);
      const cands = sided.length ? sided : exact.length ? exact : data;
      return cands.find((d) => d.sportId !== 1) ?? cands[0];
    } catch { return null; }
  };
  const followRow = async (r: ScoutingRow, rowKey: string, groupIds?: string[]) => {
    setOpenList(null);
    setRowState((s) => ({ ...s, [rowKey]: 'busy' }));
    const m = await resolve(r);
    if (!m) {
      setRowState((s) => ({ ...s, [rowKey]: 'fail' }));
      setTimeout(() => setRowState((s) => ({ ...s, [rowKey]: undefined })), 2500);
      return;
    }
    onFollow({
      id: m.id, fullName: m.fullName, primaryPosition: m.primaryPosition,
      currentTeam: m.currentTeam, sportId: m.sportId,
      parentOrg: m.parentOrg, parentOrgAbbrev: m.parentOrgAbbrev,
      followedAt: new Date().toISOString(),
    }, groupIds);
    setRowState((s) => ({ ...s, [rowKey]: undefined }));
  };

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

  if (!isPremium) return <PremiumTeaser context="scouting" />;
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
          {filtered.map((r) => {
            const rowKey = r.nameKey + (r.isPitcher ? 'p' : 'h');
            const st = rowState[rowKey];
            const followed = isFollowing(r.player);
            return (
            <div key={rowKey} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-xs">
              <div className="min-w-0 flex-1 basis-[240px] flex items-center gap-1.5">
                <span className="text-zinc-100 truncate">{r.player}</span>
                <span className="text-[10px] text-zinc-500">{r.isPitcher ? 'P' : 'H'}</span>
                <span className="text-[10px] text-amber-400/80">{levelBucket(r.level)}</span>
                {r.age !== undefined && <span className="text-[10px] text-zinc-600">{Number.isInteger(r.age) ? r.age : r.age.toFixed(1)}yo</span>}
                {followed && <span className="text-[10px] text-blue-300" title="In your list">★</span>}
                <Tools r={r} />
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap shrink-0 ml-auto">
                <span className="font-mono inline-flex items-center gap-2">
                  {r.isPitcher
                    ? (r.era20 !== undefined && <span className="text-zinc-500">{r.era20.toFixed(2)} ERA/20</span>)
                    : (r.wrcPlus !== undefined && <span className="text-zinc-500">{r.wrcPlus} wRC+</span>)}
                  <span className="text-amber-300 font-bold w-16 text-right shrink-0">{r.war.toFixed(1)} WAR</span>
                </span>
                {!followed && (
                  <span className="relative inline-flex">
                    <button onClick={() => followRow(r, rowKey)} disabled={st === 'busy'}
                      className={`px-2 py-0.5 rounded-l text-[10px] font-semibold cursor-pointer ${st === 'fail' ? 'bg-red-500/20 text-red-300' : st === 'busy' ? 'bg-zinc-700 text-zinc-400' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                      {st === 'busy' ? '…' : st === 'fail' ? 'Not found' : 'Follow'}
                    </button>
                    <button onClick={() => setOpenList(openList === rowKey ? null : rowKey)} disabled={st === 'busy' || groups.length === 0}
                      title={groups.length ? 'Follow straight into a list' : 'No lists yet'}
                      className={`px-1 py-0.5 rounded-r text-[10px] border-l border-blue-900/60 cursor-pointer ${st === 'busy' || groups.length === 0 ? 'bg-zinc-700 text-zinc-500' : 'bg-blue-700 hover:bg-blue-600 text-white'}`}>▾</button>
                    {openList === rowKey && (
                      <div className="absolute right-0 top-full mt-1 z-30 min-w-[140px] rounded-md border border-zinc-700 bg-zinc-800 shadow-xl overflow-hidden">
                        {groups.map((g) => (
                          <button key={g.id} onClick={() => followRow(r, rowKey, [g.id])}
                            className="block w-full text-left px-2.5 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-700 cursor-pointer">
                            → {g.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
