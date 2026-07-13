'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { SearchResult, PremiumMetrics, InjuryStatus, isMLBSystem } from '@/lib/types';
import { homeParkMultiplier } from '@/lib/parks';
import PremiumTeaser from './PremiumTeaser';

interface TradeCheckerProps {
  isPremium: boolean;
}

type Side = 'A' | 'B';

function Chips({ m, isPitcher, pv, fv, injured, risk, role }: { m?: PremiumMetrics; isPitcher: boolean; pv: number; fv: number; injured?: boolean; risk?: { name: string; position: string; kind?: 'il' | 'depth'; adjacent?: boolean }; role?: { label: string; factor: number } }) {
  const chip = 'px-1.5 py-0.5 rounded text-[10px] font-bold';
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      <span className={`${chip} bg-blue-500/25 text-blue-200`} title="Present value — win-now">PV {pv.toFixed(1)}</span>
      <span className={`${chip} bg-fuchsia-500/25 text-fuchsia-200`} title="Future value — keeper/dynasty">FV {fv.toFixed(1)}</span>
      {role && role.factor < 1 && <span className={`${chip} bg-zinc-600/40 text-zinc-300`} title="IL-aware playing-time role over the team's recent games">{role.label}</span>}
      {injured && <span className={`${chip} bg-red-500/20 text-red-400`} title="On the injured list">IL</span>}
      {risk && <span className={`${chip} bg-amber-500/20 text-amber-300`} title={`${risk.name} (${risk.position}) ${risk.kind === 'depth' ? 'pushing up from the minors' : 'on the IL'} — ${risk.adjacent ? 'a positional logjam that could shuffle his reps' : 'a direct threat to his reps'}`}>⚠ PT</span>}
      {m?.age !== undefined && <span className={`${chip} bg-zinc-700/50 text-zinc-300`} title="Projection age">{Math.round(m.age)} yo</span>}
      {m?.war !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.war.toFixed(1)} WAR</span>}
      {m && !isPitcher && m.peakWrcPlus !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.peakWrcPlus} wRC+</span>}
      {m && isPitcher && m.era20 !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.era20.toFixed(2)} ERA/20</span>}
      {m && !isPitcher && m.dual && <span className={`${chip} bg-amber-500/20 text-amber-200`}>⚡💪{m.dual === 'double-plus' ? '40+' : '30+'}</span>}
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
  const [ptRisk, setPtRisk] = useState<Record<number, { name: string; position: string; kind?: 'il' | 'depth' } | undefined>>({});
  const [roles, setRoles] = useState<Record<number, { label: string; factor: number }>>({}); // IL-aware playing-time role
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch { setResults([]); }
  }, []);

  useEffect(() => {
    const all = [...sideA, ...sideB];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (all.length === 0) { setMetrics({}); setInjuries({}); setPtRisk({}); setRoles({}); return; }
    let active = true;
    // IL-aware playing-time role per hitter (few players in a trade, so per-player
    // team-game-log fetches are fine). Docks PV for part-time / bench guys.
    Promise.all(all.filter((p) => p.primaryPosition !== 'P' && isMLBSystem(p.sportId)).map(async (p) => {
      try {
        const r = await fetch(`/api/stats/gamelog?playerId=${p.id}&sportId=${p.sportId}&pitcher=0&teamId=${p.currentTeam.id}`);
        const d = await r.json();
        const entries: Array<{ dnp?: boolean }> = d.entries ?? [];
        const hasDnp = entries.some((e) => e.dnp);
        if (!hasDnp || entries.length < 10) return [p.id, null] as const;
        const rate = entries.filter((e) => !e.dnp).length / entries.length;
        const role = rate >= 0.8 ? { label: 'Everyday', factor: 1 } : rate >= 0.5 ? { label: 'Part-time', factor: 0.85 } : { label: 'Bench', factor: 0.7 };
        return [p.id, role] as const;
      } catch { return [p.id, null] as const; }
    })).then((pairs) => {
      if (!active) return;
      const m: Record<number, { label: string; factor: number }> = {};
      for (const [id, role] of pairs) if (role) m[id] = role;
      setRoles(m);
    });
    fetch('/api/war', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: all }) })
      .then((r) => r.json()).then((d) => { if (active) setMetrics(d && typeof d === 'object' ? d : {}); }).catch(() => active && setMetrics({}));
    fetch('/api/players/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: all.map((p) => ({ ...p, followedAt: '' })) }) })
      .then((r) => r.json())
      .then((d) => {
        if (!active || !Array.isArray(d)) return;
        const inj: Record<number, InjuryStatus | undefined> = {};
        const pr: Record<number, { name: string; position: string; kind?: 'il' | 'depth' } | undefined> = {};
        for (const p of d) { inj[p.id] = p.injury; pr[p.id] = p.playingTimeRisk; }
        setInjuries(inj); setPtRisk(pr);
      })
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

  // Present value: injured players lose most of it, a returning teammate (PT
  // risk) docks it, and the home park nudges it (wRC+ is already park-adjusted,
  // so this is a light real-life-output touch).
  // Perpetual job-security discount: low-WAR bats are always a slump/call-up from
  // losing the job, even if full-time now. 1B/DH get slack — their WAR is
  // positionally deflated, so a good bat (high wRC+) secures the spot.
  const jobSecurity = (p: SearchResult) => {
    if (p.primaryPosition === 'P') return 1;
    const war = metrics[p.id]?.war;
    if (war === undefined) return 1;
    let f = war >= 2.0 ? 1.0 : war >= 1.5 ? 0.93 : war >= 1.0 ? 0.85 : 0.7;
    if ((p.primaryPosition === '1B' || p.primaryPosition === 'DH') && (metrics[p.id]?.peakWrcPlus ?? 0) >= 110) {
      f = Math.min(1, f + 0.1);
    }
    return f;
  };
  // Playing-time dock: a direct (same-position) IL return is the most imminent
  // hit; a minors pusher is slower; a positional logjam (adjacent spot) is the
  // lightest touch.
  const ptDock = (r?: { kind?: 'il' | 'depth'; adjacent?: boolean }) =>
    !r ? 1 : r.adjacent ? 0.95 : r.kind === 'depth' ? 0.9 : 0.8;
  const pvOf = (p: SearchResult) =>
    (metrics[p.id]?.presentValue ?? 0)
    * (injuries[p.id] ? 0.6 : 1)
    * ptDock(ptRisk[p.id])
    * (roles[p.id]?.factor ?? 1)
    * jobSecurity(p)
    * homeParkMultiplier(p.currentTeam.name, p.primaryPosition === 'P');
  const fvOf = (p: SearchResult) => metrics[p.id]?.futureValue ?? 0;
  // Freely-available replacement level: an unbalanced trade opens roster spots
  // you refill off the wire, so the side receiving FEWER players gets that many
  // theoretical replacements baked in. Present value is repeatable (there's
  // always another streamer producing a little), so it scales linearly. Keeper
  // value is NOT — you can grab maybe one decent free prospect, and each extra
  // open spot yields a worse guy, so it diminishes toward a low cap.
  const PV_REPL = 0.4; // a freely-available ~1-WAR body, per spot
  const FV_CAP = 2.0;  // the best a freed spot can grab is ~one 2-FV free prospect
  const fillCount = (side: Side) => Math.max(0, (side === 'A' ? sideB : sideA).length - (side === 'A' ? sideA : sideB).length);
  const pvFill = (n: number) => n * PV_REPL;
  const fvFill = (n: number) => FV_CAP * (1 - Math.pow(0.5, n)); // 1.0, 1.5, 1.75 … → 2.0
  const sumPv = (s: SearchResult[], side: Side) => s.reduce((t, p) => t + pvOf(p), 0) + pvFill(fillCount(side));
  const sumFv = (s: SearchResult[], side: Side) => s.reduce((t, p) => t + fvOf(p), 0) + fvFill(fillCount(side));
  const pvDiff = sumPv(sideA, 'A') - sumPv(sideB, 'B');
  const fvDiff = sumFv(sideA, 'A') - sumFv(sideB, 'B');
  const edge = (d: number, unit: string) =>
    Math.abs(d) < 1 ? `${unit}: even` : `${unit}: ${d > 0 ? 'you get' : 'you give'} +${Math.abs(d).toFixed(1)}`;

  const renderColumn = (side: Side, players: SearchResult[]) => {
    const fill = fillCount(side);
    return (
    <div className="flex-1 min-w-0 rounded-lg border border-zinc-800 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-300">You {side === 'A' ? 'get' : 'give'}</span>
        <span className="text-[11px] font-bold"><span className="text-blue-200">PV {sumPv(players, side).toFixed(1)}</span> · <span className="text-fuchsia-200">FV {sumFv(players, side).toFixed(1)}</span></span>
      </div>
      {players.length === 0 && fill === 0 ? (
        <p className="text-[11px] text-zinc-600 py-4 text-center">Search above, then tap <strong>+{side}</strong>.</p>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-zinc-100 truncate">{p.fullName} <span className="text-[11px] text-zinc-500">{p.primaryPosition}</span></div>
                <Chips m={metrics[p.id]} isPitcher={p.primaryPosition === 'P'} pv={pvOf(p)} fv={fvOf(p)} injured={Boolean(injuries[p.id])} risk={ptRisk[p.id]} role={roles[p.id]} />
              </div>
              <button onClick={() => remove(p.id, side)} className="shrink-0 text-zinc-600 hover:text-red-400 cursor-pointer text-sm" title="Remove">✕</button>
            </div>
          ))}
          {fill > 0 && (
            <div className="flex items-start justify-between gap-2 border-t border-dashed border-zinc-800 pt-2" title="An unbalanced trade opens roster spots you refill off the wire — theoretical replacement players baked in.">
              <div className="min-w-0">
                <div className="text-sm text-zinc-400 italic truncate">+{fill} free-agent fill</div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300/80">PV {pvFill(fill).toFixed(1)}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-fuchsia-500/15 text-fuchsia-300/80">FV {fvFill(fill).toFixed(1)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    );
  };

  return (
    <div>
      <div className="relative max-w-xl mb-4">
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

      {(sideA.length > 0 || sideB.length > 0) && (
        <div className="mb-4 text-center text-sm flex flex-wrap justify-center gap-x-4">
          <span className="text-blue-200 font-semibold">{edge(pvDiff, 'Now')}</span>
          <span className="text-fuchsia-200 font-semibold">{edge(fvDiff, 'Keeper')}</span>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3">
        {renderColumn('A', sideA)}
        {renderColumn('B', sideB)}
      </div>
      <p className="text-[11px] text-zinc-600 mt-3">
        <strong className="text-blue-300">PV</strong> (present) is WAR-driven — WAR captures total value including an everyday role — anchored by the auction market (cross-position) and current-year form, then discounted for injury, a returning/pushing teammate, a part-time role, and job security (low-WAR bats carry a standing risk; 1B/DH who hit get slack). <strong className="text-fuchsia-300">FV</strong> (future/keeper) = peak ceiling × age × distance to the majors. Premium — a work in progress.
      </p>
    </div>
  );
}
