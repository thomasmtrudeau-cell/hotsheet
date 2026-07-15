'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { SearchResult, PremiumMetrics, InjuryStatus, isMLBSystem } from '@/lib/types';
import { homeParkMultiplier } from '@/lib/parks';
import { computeValue, presentMaturity, keeperAgeFactor, abilityCurve, LeagueSettings, DEFAULT_SETTINGS } from '@/lib/value-model';
import LeagueSettingsPanel from './LeagueSettingsPanel';
import PremiumTeaser from './PremiumTeaser';
import Tooltip from './Tooltip';
import ValueBoard from './ValueBoard';

const SETTINGS_KEY = 'hotsheet_league_settings';
// Build lenses. Every player already has a per-season value projection (k=0 is THIS
// season = his live PV; future seasons follow the age curve, injuries rebound,
// prospects ramp in at arrival). A lens scores him as a weighted AVERAGE of those
// seasons (his production over that window) PLUS a market-premium share of FV —
// because trade value is ASSET value: the market pays a real premium for ceiling +
// control window (one Skenes fetches a deGrom+Wheeler+Freeman haul), and even a
// win-now team shouldn't dump a young star for an old one — they'd flip him for
// more. fvShare rises the more future-leaning the build is. Overall weights the
// present most and decays outward; the team-build lenses re-center the window:
// win-now = this season + next (front-spiked), contender = the next few seasons
// (flatter), retooling EXCLUDES this season (you've conceded it), rebuild excludes
// the next two (ramps in at +2, full from +3).
export const BUILDS: { key: string; label: string; short: string; weights: number[]; fvShare: number; blurb: string }[] = [
  { key: 'overall', label: 'Overall', short: 'OV', weights: [1, 0.72, 0.52, 0.37, 0.27, 0.19, 0.14], fvShare: 0.45,
    blurb: 'This season counts most; each season out counts ~28% less. 45% of the score is the keeper-ceiling premium.' },
  { key: 'win-now', label: 'Win-now', short: 'NOW', weights: [1, 0.55, 0.15, 0, 0, 0, 0], fvShare: 0.15,
    blurb: 'Production weighting: ~60% this season, ~30% next, almost nothing beyond. Only 15% ceiling premium — pay for wins today.' },
  { key: 'contender', label: 'Contender', short: 'CTD', weights: [0.85, 1, 0.85, 0.5, 0.2, 0.05, 0], fvShare: 0.3,
    blurb: 'Production spread across the next ~3 seasons (next year weighted most). 30% ceiling premium.' },
  { key: 'retool', label: 'Retooling', short: 'RTL', weights: [0, 1, 1, 0.65, 0.35, 0.15, 0.05], fvShare: 0.45,
    blurb: 'This season ignored — you’ve conceded it. The next two seasons carry ~60% of the production weight. 45% ceiling premium.' },
  { key: 'rebuild', label: 'Rebuild', short: 'RBD', weights: [0, 0, 0.5, 1, 1, 0.9, 0.8], fvShare: 0.6,
    blurb: 'The next two seasons ignored; seasons +3 to +6 carry the weight. 60% ceiling premium — youth and upside rule.' },
];

interface TradeCheckerProps {
  isPremium: boolean;
}

type Side = 'A' | 'B';

function Chips({ m, isPitcher, pv, fv, lens, pending, saves, injured, risk, role }: { m?: PremiumMetrics; isPitcher: boolean; pv: number; fv: number; lens?: { label: string; value: number; title: string }; pending?: boolean; saves?: number; injured?: boolean; risk?: { name: string; position: string; kind?: 'il' | 'depth' | 'crowd'; adjacent?: boolean }; role?: { label: string; factor: number } }) {
  const chip = 'px-1.5 py-0.5 rounded text-[10px] font-bold';
  if (pending) {
    // Values are still being priced — pulse placeholders instead of misleading 0.0s.
    return (
      <div className="flex flex-wrap gap-1 mt-0.5">
        {['PV', 'FV', lens?.label ?? 'OV'].map((l) => (
          <span key={l} className={`${chip} bg-zinc-700/40 text-zinc-500 animate-pulse`}>{l} …</span>
        ))}
        <span className="text-[10px] text-zinc-600 self-center">pricing…</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      <Tooltip text="PV — present value: what he's worth THIS season. WAR + market base + live production (current rate × actual playing time × park), docked for injury, job security and playing-time threats."><span className={`${chip} bg-blue-500/25 text-blue-200`}>PV {pv.toFixed(1)}</span></Tooltip>
      <Tooltip text="FV — future/keeper value: his peak ceiling × age × distance to the majors, on the same scale as PV. Aging vets fade below their PV; young stars carry big FV."><span className={`${chip} bg-fuchsia-500/25 text-fuchsia-200`}>FV {fv.toFixed(1)}</span></Tooltip>
      {lens && <Tooltip text={lens.title}><span className={`${chip} bg-orange-500/25 text-orange-200`}>{lens.label} {lens.value.toFixed(1)}</span></Tooltip>}
      {role && role.factor < 1 && !injured && <span className={`${chip} bg-zinc-600/40 text-zinc-300`} title="IL-aware playing-time role over the team's recent games">{role.label}</span>}
      {injured && <span className={`${chip} bg-red-500/20 text-red-400`} title="On the injured list">IL</span>}
      {risk && <span className={`${chip} bg-amber-500/20 text-amber-300`} title={`${risk.name} (${risk.position}) ${risk.kind === 'crowd' ? 'shares the spot on the active roster' : risk.kind === 'depth' ? 'pushing up from the minors' : 'on the IL'} — ${risk.kind === 'crowd' ? 'reps are split while both are healthy' : risk.adjacent ? 'a positional logjam that could shuffle his reps' : 'a direct threat to his reps'}`}>⚠ PT</span>}
      {m?.age !== undefined && <span className={`${chip} bg-zinc-700/50 text-zinc-300`} title="Projection age">{Number.isInteger(m.age) ? m.age : m.age.toFixed(1)} yo</span>}
      {m?.war !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.war.toFixed(1)} WAR</span>}
      {m && !isPitcher && m.peakWrcPlus !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.peakWrcPlus} wRC+</span>}
      {m && isPitcher && m.era20 !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.era20.toFixed(2)} ERA/20</span>}
      {isPitcher && saves !== undefined && saves >= 10 && <span className={`${chip} bg-teal-500/20 text-teal-300`} title="Projected full-season saves at his current pace — the ninth-inning role carries fantasy value on its own. The PV credit is risk-adjusted: a closer with a poor ERA/20 projection is one bad stretch from losing the job (or being traded into a setup role).">🧯 ~{saves} SV</span>}
      {m && !isPitcher && m.dual && <span className={`${chip} bg-amber-500/20 text-amber-200`}>⚡💪{m.dual === 'double-plus' ? '40+' : '30+'}</span>}
      {m && !isPitcher && !m.dual && m.power && <span className={`${chip} bg-amber-500/20 text-amber-200`}>💪{m.power === 'double-plus' ? '++' : '+'}</span>}
      {m && !isPitcher && !m.dual && m.speed && <span className={`${chip} bg-amber-500/20 text-amber-200`}>⚡{m.speed === 'double-plus' ? '++' : '+'}</span>}
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
  const [faFills, setFaFills] = useState<SearchResult[]>([]); // real free agents you'd add back into opened roster spots
  const [metrics, setMetrics] = useState<Record<number, PremiumMetrics>>({});
  const [injuries, setInjuries] = useState<Record<number, InjuryStatus | undefined>>({});
  const [ptRisk, setPtRisk] = useState<Record<number, { name: string; position: string; kind?: 'il' | 'depth' | 'crowd' } | undefined>>({});
  const [roles, setRoles] = useState<Record<number, { label: string; factor: number; rate: number }>>({}); // actual playing-time (rate = fraction of games appeared in)
  const [batSides, setBatSides] = useState<Record<number, string | undefined>>({}); // L/R/S — for lefty platoon risk
  const [loadedIds, setLoadedIds] = useState<Set<number>>(new Set()); // ids whose sheet metrics have arrived (loading-skeleton gate)
  const [savesPace, setSavesPace] = useState<Record<number, number>>({}); // MLB pitchers: projected full-season saves
  const [bullpen, setBullpen] = useState<Array<{ nameKey: string; team?: string; role?: string; peakEra20: number; currentEra20: number }> | null>(null); // all RPs w/ projected+actual ERA (lazy)
  const [settings, setSettings] = useState<LeagueSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsCustomized, setSettingsCustomized] = useState(true); // assume yes until load says otherwise (no flash)
  const [tool, setTool] = useState<'trade' | 'board'>('trade'); // trade checker vs bulk value board
  const [buildKey, setBuildKey] = useState('overall'); // YOUR build lens (Overall / Win-now / Contender / Retooling / Rebuild)
  const [theirKey, setTheirKey] = useState('overall'); // THEIR build — view the same trade from the other side's posture
  const [addingFa, setAddingFa] = useState(false); // FA-add mode (triggered from a column)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  // League settings persist locally (cross-device sync is a later add).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSettings({ ...DEFAULT_SETTINGS, ...s, slots: { ...DEFAULT_SETTINGS.slots, ...(s.slots ?? {}) } });
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSettingsCustomized(false); // never saved settings — nudge them to set their league
      }
    } catch { /* ignore */ }
  }, []);
  // Deliberately NOT persisted — the lens always starts on Overall so the default
  // verdict is the neutral one; switch per-trade as needed.
  const updateBuild = useCallback((k: string) => setBuildKey(k), []);
  const updateSettings = useCallback((s: LeagueSettings) => {
    setSettings(s);
    setSettingsCustomized(true);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch { setResults([]); }
  }, []);

  // INCREMENTAL loading: only fetch data for players not seen yet and MERGE into
  // state — adding Bellinger must not re-fetch (and re-wait on) Caballero. A
  // mounted ref (not a per-effect flag) guards the merges, so an in-flight fetch
  // for player A isn't dropped when player B is added a second later.
  const fetchedRef = useRef<Set<number>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => {
    const all = [...sideA, ...sideB, ...faFills];
    if (all.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMetrics({}); setInjuries({}); setPtRisk({}); setRoles({}); setBatSides({}); setLoadedIds(new Set()); setSavesPace({});
      fetchedRef.current = new Set();
      return;
    }
    const fresh = all.filter((p) => !fetchedRef.current.has(p.id));
    if (fresh.length === 0) return;
    for (const p of fresh) fetchedRef.current.add(p.id);
    // IL-aware playing-time role per hitter (few players in a trade, so per-player
    // team-game-log fetches are fine). Majors-only — never dock prospects.
    Promise.all(fresh.filter((p) => p.primaryPosition !== 'P' && p.sportId === 1).map(async (p) => {
      try {
        const r = await fetch(`/api/stats/gamelog?playerId=${p.id}&sportId=${p.sportId}&pitcher=0&teamId=${p.currentTeam.id}`);
        const d = await r.json();
        const entries: Array<{ dnp?: boolean }> = d.entries ?? [];
        const hasDnp = entries.some((e) => e.dnp);
        if (!hasDnp || entries.length < 10) return [p.id, null] as const;
        const rate = entries.filter((e) => !e.dnp).length / entries.length;
        const role = { rate, label: rate >= 0.8 ? 'Everyday' : rate >= 0.5 ? 'Part-time' : 'Bench', factor: rate >= 0.8 ? 1 : rate >= 0.5 ? 0.85 : 0.7 };
        return [p.id, role] as const;
      } catch { return [p.id, null] as const; }
    })).then((pairs) => {
      if (!mountedRef.current) return;
      setRoles((prev) => {
        const m = { ...prev };
        for (const [id, role] of pairs) if (role) m[id] = role;
        return m;
      });
    });
    fetch('/api/war', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: fresh }) })
      .then((r) => r.json())
      .then((d) => {
        if (!mountedRef.current) return;
        if (d && typeof d === 'object') setMetrics((prev) => ({ ...prev, ...d }));
        setLoadedIds((prev) => new Set([...prev, ...fresh.map((p) => p.id)]));
      })
      .catch(() => mountedRef.current && setLoadedIds((prev) => new Set([...prev, ...fresh.map((p) => p.id)])));
    // Closers: saves are a ROLE stat the WAR/rate model can't see (Jansen read
    // PV 0.0). Pull actual saves and project to a full-season pace.
    Promise.all(fresh.filter((p) => p.primaryPosition === 'P' && p.sportId === 1).map(async (p) => {
      try {
        const yr = new Date().getFullYear();
        const r = await fetch(`https://statsapi.mlb.com/api/v1/people/${p.id}/stats?stats=season&group=pitching&season=${yr}`);
        const d = await r.json();
        const sv = parseInt(d?.stats?.[0]?.splits?.[0]?.stat?.saves, 10) || 0;
        if (sv < 3) return [p.id, 0] as const; // not in the saves mix
        // Season fraction from opening day (~Mar 27) over a ~186-day season.
        const frac = Math.min(1, Math.max(0.15, (Date.now() - new Date(yr, 2, 27).getTime()) / (186 * 86_400_000)));
        return [p.id, Math.round(sv / frac)] as const;
      } catch { return [p.id, 0] as const; }
    })).then((pairs) => {
      if (!mountedRef.current) return;
      setSavesPace((prev) => { const m = { ...prev }; for (const [id, sv] of pairs) if (sv > 0) m[id] = sv; return m; });
      // A closer is in the trade — pull the league bullpen picture once, for the
      // better-setup-man job-risk dock.
      if (pairs.some(([, sv]) => sv > 0)) {
        setBullpen((cur) => {
          if (cur !== null) return cur;
          fetch('/api/regression?pool=all').then((r) => r.json()).then((d) => {
            if (mountedRef.current && Array.isArray(d?.rows)) setBullpen(d.rows);
          }).catch(() => {});
          return []; // sentinel: fetch in flight
        });
      }
    });
    fetch('/api/players/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: fresh.map((p) => ({ ...p, followedAt: '' })) }) })
      .then((r) => r.json())
      .then((d) => {
        if (!mountedRef.current || !Array.isArray(d)) return;
        setInjuries((prev) => { const m = { ...prev }; for (const p of d) m[p.id] = p.injury; return m; });
        setPtRisk((prev) => { const m = { ...prev }; for (const p of d) m[p.id] = p.playingTimeRisk; return m; });
        setBatSides((prev) => { const m = { ...prev }; for (const p of d) m[p.id] = p.batSide; return m; });
      })
      .catch(() => {});
  }, [sideA, sideB, faFills]);

  if (!isPremium) return <PremiumTeaser context="trade" />;

  const inTrade = (id: number) => sideA.some((p) => p.id === id) || sideB.some((p) => p.id === id) || faFills.some((p) => p.id === id);
  const clearSearch = () => { setQuery(''); setResults([]); setOpen(false); };
  const add = (r: SearchResult, side: Side) => {
    if (inTrade(r.id)) return;
    (side === 'A' ? setSideA : setSideB)((prev) => [...prev, r]);
    clearSearch();
  };
  const addFa = (r: SearchResult) => {
    if (inTrade(r.id)) return;
    setFaFills((prev) => [...prev, r]);
    clearSearch();
  };
  const remove = (id: number, side: Side) =>
    (side === 'A' ? setSideA : setSideB)((prev) => prev.filter((p) => p.id !== id));
  const removeFa = (id: number) => setFaFills((prev) => prev.filter((p) => p.id !== id));

  // Present value: injured players lose most of it, a returning teammate (PT
  // risk) docks it, and the home park nudges it (wRC+ is already park-adjusted,
  // so this is a light real-life-output touch).
  // Perpetual job-security discount: low-WAR bats are always a slump/call-up from
  // losing the job, even if full-time now. 1B/DH get slack — their WAR is
  // positionally deflated, so a good bat (high wRC+) secures the spot.
  const jobSecurity = (p: SearchResult) => {
    if (p.primaryPosition === 'P') return 1;
    if (p.sportId !== 1) return 1; // job security is an MLB concept — never dock prospects
    const war = metrics[p.id]?.war;
    if (war === undefined) return 1;
    let f = war >= 2.0 ? 1.0 : war >= 1.5 ? 0.93 : war >= 1.0 ? 0.85 : 0.7;
    // A 1B/DH's job IS his bat — a plus bat holds an everyday role even at modest
    // WAR (a 1.5-WAR, 107-wRC+ power 1B like Burger isn't a PT risk), so job
    // security keys on wRC+ for them, not the WAR tier.
    if (p.primaryPosition === '1B' || p.primaryPosition === 'DH') {
      const wrc = metrics[p.id]?.peakWrcPlus ?? 0;
      const batSecure = wrc >= 105 ? 1.0 : wrc >= 95 ? 0.95 : wrc >= 85 ? 0.85 : 0.75;
      f = Math.max(f, batSecure);
    }
    return f;
  };
  // Playing-time dock on PRESENT value: a returning/pushing teammate directly
  // imperils the current reps that win-now value is built on, so it bites harder
  // than a keeper-horizon logjam. Direct (same-position) IL return is the most
  // imminent; a minors pusher next; a positional logjam (adjacent) the lightest —
  // but an unproven, threatened everyday role (Heriberto) still gives real value back.
  const ptDock = (r?: { kind?: 'il' | 'depth' | 'crowd'; adjacent?: boolean }) =>
    !r ? 1 : r.kind === 'crowd' ? 0.85 : r.adjacent ? 0.88 : r.kind === 'depth' ? 0.82 : 0.75;
  // Base PV/FV recomputed live from raw inputs against the user's league
  // settings (keeper depth, format, positional slots), then PV gets the dynamic
  // discounts layered on top.
  const baseValue = (p: SearchResult) => {
    const m = metrics[p.id];
    if (!m) return { present: 0, future: 0 };
    return computeValue({
      isPitcher: p.primaryPosition === 'P', position: p.primaryPosition,
      war: m.war, peakWrcPlus: m.peakWrcPlus, era20: m.era20,
      hr: m.hr, sb: m.sb, curWrcPlus: m.curWrcPlus, curEra20: m.curEra20,
      age: m.age, level: m.level, marketBaseline: m.marketBaseline,
      defRuns: m.defRuns, ipg: m.ipg,
    }, settings);
  };
  // Actual playing-time rate (fraction of team games he's appeared in), from the
  // game log — the DYNAMIC signal. Majors only; pitchers carry a normal workload;
  // a hitter with no game-log read defaults to near-everyday.
  // A PROVEN full-time bat — his recent game-log DNPs are noise (DH rest days,
  // paternity/bereavement list, a rehab week), not a lost job. We don't rush to
  // degrade a long-track-record regular to part-time off a two-week sample. Older
  // vets qualify on a lower bar (the track record is longer); a young unproven
  // part-timer (Ruiz) is NOT exempt — his low rate is a real signal.
  const establishedRegular = (p: SearchResult) => {
    if (p.sportId !== 1 || p.primaryPosition === 'P') return false;
    const m = metrics[p.id];
    if (!m) return false;
    const age = m.age ?? 26, wrc = m.peakWrcPlus ?? 0, war = m.war ?? 0;
    return wrc >= 110 || war >= 2.5 || (age >= 30 && (wrc >= 100 || war >= 1.8));
  };
  const ptRateOf = (p: SearchResult) => {
    if (p.sportId !== 1) return 1;
    if (p.primaryPosition === 'P') return 1;
    // A player on the IL racks up game-log DNPs — but that's his injury, not a
    // bench role. An everyday regular returns to everyday reps, so we don't read
    // the IL-polluted log as part-time (J-Rod/Story/Semien were being cratered).
    if (injuries[p.id]) return 1;
    if (establishedRegular(p)) return 1; // rest/paternity noise ≠ part-time
    return roles[p.id]?.rate ?? 0.9;
  };
  // Dynamic present PRODUCTION: a park-neutral current-year rate projection scaled
  // by ACTUAL recent playing time. This is the non-WAR, usage-responsive layer —
  // it's what lets a DH/1B's live bat (or a slumping/benched guy's drop) move PV
  // even when WAR is stale or positionally distorted. Majors only.
  const dynProd = (p: SearchResult) => {
    if (p.sportId !== 1) return 0;
    const m = metrics[p.id];
    if (!m) return 0;
    // Pre-peak guys don't produce their peak rate yet (and a newly-promoted guy's
    // rate often falls back to the peak projection) — so age-discount here too.
    const mat = presentMaturity(m.age);
    if (p.primaryPosition === 'P') {
      const e = m.curEra20 ?? m.era20;
      return e === undefined ? 0 : Math.max(0, (4.6 - e) * 1.2) * mat;
    }
    const w = m.curWrcPlus ?? m.peakWrcPlus;
    if (w === undefined) return 0;
    return Math.max(0, (w - 90) / 12) * ptRateOf(p) * mat; // bat rate × actual playing time × maturity
  };
  const DYN_W = 0.6; // weight of the dynamic production layer
  // Platoon risk: a bat who's already NOT everyday is likely in a platoon and
  // sits against the tough-side arm — applies to lefties AND righties (Esteury
  // Ruiz is a RHB platoon guy). But you can MASH your way out (a big wRC+ plays
  // vs everyone) or GLOVE your way out (WAR/defense keeps you in the lineup vs
  // the same-hand pitcher). So the dock scales down as bat and WAR rise, and only
  // bites once the role has actually dipped. Lefties platooned a touch more often.
  const platoonDock = (p: SearchResult) => {
    if (p.sportId !== 1 || p.primaryPosition === 'P') return 1;
    if (injuries[p.id]) return 1; // IL DNPs aren't a platoon signal
    if (establishedRegular(p)) return 1; // a proven regular isn't platooning off a rest week
    const rate = roles[p.id]?.rate;
    if (rate === undefined || rate >= 0.85) return 1; // everyday (or unknown) — no platoon dock
    const wrc = metrics[p.id]?.peakWrcPlus ?? 100;
    const war = metrics[p.id]?.war ?? 0;
    const escape = Math.max(0, Math.min(1, (wrc - 95) / 40 + war / 5)); // mash or field your way out
    const base = batSides[p.id] === 'L' ? 0.83 : 0.87;
    return base + (1 - base) * escape;
  };
  // A returning/pushing teammate takes reps from the WEAKEST guy in the logjam,
  // not a star — so the PT-threat dock is neutralized by the followed player's own
  // WAR. Ceddanne Rafaela (3.6 WAR, elite glove) keeps his job when Roman Anthony
  // returns; a fringe outfielder is the one who loses time.
  const entrench = (p: SearchResult) => {
    const m = metrics[p.id];
    if (m?.war === undefined) return 0;
    // Base it on CURRENT ability (peak × maturity), not the peak ceiling — a
    // newly-promoted 21-yo with a 3.5 peak isn't a lineup lock yet (Lara), while
    // an established 25-yo star is (Rafaela).
    const cur = m.war * presentMaturity(m.age);
    return cur >= 3.3 ? 1 : cur >= 2.5 ? 0.7 : cur >= 2.0 ? 0.4 : cur >= 1.5 ? 0.2 : 0;
  };
  const ptDockEff = (p: SearchResult) => 1 - (1 - ptDock(ptRisk[p.id])) * (1 - entrench(p));
  // Injury dock scales with entrenchment: a fringe guy's IL stint threatens his job
  // (heavy dock), but an entrenched everyday star (J-Rod, big contract, played every
  // day pre-injury) returns to his role — his value is his healthy value minus only
  // a light "currently out" hedge, not a role loss. Shared by PV and the timeline
  // projection (which un-docks it for future healthy seasons).
  const injuryMultOf = (p: SearchResult) => (injuries[p.id] ? 0.6 + 0.35 * entrench(p) : 1);
  // Saves premium, risk-adjusted: the ninth-inning role carries value the
  // WAR/rate model can't see — but a closer with a POOR run-prevention
  // projection is a blown-save streak from losing the job (or getting traded
  // into a setup role), so the premium fades as the projected ERA/20 climbs.
  // Elite (≤3.4) keeps 100%; ~4.2 keeps ~80%; a 5.1-projection guy keeps ~57%.
  const savesPremium = (p: SearchResult) => {
    const pace = savesPace[p.id] ?? 0;
    if (pace <= 0) return 0;
    const m = metrics[p.id];
    const era = m?.curEra20 !== undefined && m?.era20 !== undefined
      ? 0.5 * m.era20 + 0.5 * m.curEra20 // current-year struggles raise the risk
      : m?.era20;
    const security = era === undefined ? 0.8 : Math.max(0.5, Math.min(1, 1 - Math.max(0, era - 3.4) * 0.25));
    // Bullpen competition (modest): a teammate reliever with a BETTER projection
    // is a threat to the role (×0.9); worse still if he's also outpitching him
    // this year on actual ERA (×0.8).
    let competition = 1;
    const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (bullpen && bullpen.length && m?.era20 !== undefined) {
      const myKey = norm(p.fullName);
      const rivals = bullpen.filter((r) => r.team === p.currentTeam.name && r.role === 'RP' && r.nameKey !== myKey && r.peakEra20 <= m.era20! - 0.3);
      if (rivals.length) {
        const alsoBetterNow = m.curEra20 !== undefined && rivals.some((r) => r.currentEra20 <= m.curEra20! - 0.3);
        competition = alsoBetterNow ? 0.8 : 0.9;
      }
    }
    return Math.min(5, pace / 8) * security * competition;
  };
  const pvOf = (p: SearchResult) => {
    // The WAR+market base assumes a full-time role, so it takes a mild continuous
    // playing-time haircut; the dynamic layer already bakes in actual usage.
    const ptHaircut = p.sportId === 1 && p.primaryPosition !== 'P' ? 0.75 + 0.25 * ptRateOf(p) : 1;
    return (baseValue(p).present * ptHaircut + DYN_W * dynProd(p) + savesPremium(p))
      * injuryMultOf(p)
      * ptDockEff(p)
      * jobSecurity(p)
      * platoonDock(p)
      * homeParkMultiplier(p.currentTeam.name, p.primaryPosition === 'P');
  };
  // Keeper value also takes a (softer) playing-time hit: a projection that
  // assumes a full-time role is worth less if that role is tenuous — a returning/
  // pushing teammate (Arias behind Ramírez) or a part-time role now. Softer than
  // the present-value dock since keeper horizons give the logjam time to resolve.
  const fvPtFactor = (p: SearchResult) => {
    // Same entrenchment logic as PV — a star's keeper value isn't threatened by a
    // returnee who'll bump a lesser teammate.
    const risk = ptRisk[p.id] ? 1 - 0.15 * (1 - entrench(p)) : 1;
    // Role-attainment: a part-timer's FV ceiling assumes an everyday role he
    // doesn't have. This only applies to guys still TRYING to establish one — the
    // young/prime window (≤29). An established vet's bench is temporary or plain
    // decline (already handled by keeperAgeFactor), NOT a failure to earn a job:
    // George Springer (36) is a sure-thing DH, not a part-time hopeful, so he's
    // exempt. Within the window the odds FADE with age (a 27-yo part-timer is
    // likelier "who he is" than a 22-yo) and poor defense, but a young / good-glove
    // / good-bat part-timer keeps most of the ceiling (the path is open). Esteury
    // Ruiz (27, part-time, −D) gets docked; a 23-yo +D part-timer like Sanoja barely
    // does. A strong bat (wRC+) buys reps regardless.
    let roleF = 1;
    const rate = roles[p.id]?.rate;
    const rAge = metrics[p.id]?.age ?? 26;
    if (rate !== undefined && rate < 0.8 && rAge <= 29 && !establishedRegular(p)) {
      const def = metrics[p.id]?.def;
      const wrc = metrics[p.id]?.peakWrcPlus ?? 100;
      let odds = 0.88 - Math.max(0, rAge - 24) * 0.03;
      if (def === 'minus' || def === 'double-minus') odds -= 0.08;
      if (def === 'plus' || def === 'double-plus') odds += 0.06;
      odds += Math.max(0, wrc - 105) * 0.008; // a real bat finds at-bats
      roleF = Math.max(0.6, Math.min(1, odds));
    }
    return risk * roleF;
  };
  const fvOf = (p: SearchResult) => {
    const ceiling = baseValue(p).future * fvPtFactor(p);
    // Sustained-production floor: an established player is stable — his future
    // years ≈ his present production, discounted by how many good years remain
    // (keeperAgeFactor). So a solid-but-not-star vet's keeper value shouldn't
    // collapse below his PV the way the ceiling-above-the-keeper-bar formula alone
    // does (Griffin Jax: FV 2.0 vs PV 2.7). Young/star guys are unaffected — their
    // ceiling already exceeds this. Park + current form flow in via PV, so a
    // pitcher's durable park edge counts here too. FV dips below PV only as age
    // fades the keeperAgeFactor below 1 (~30+), which is the clean FV<PV crossover.
    // GATED to genuine everyday talent (WAR ≥ 2.0): a low-WAR bat-only guy about to
    // expire (Burger, 1.5 WAR) doesn't get his production floored forward — his FV
    // is the age-faded ceiling, which lands below his PV, as it should.
    const war = metrics[p.id]?.war ?? 0;
    const sustained = war >= 2.0 ? pvOf(p) * keeperAgeFactor(metrics[p.id]?.age, p.primaryPosition === 'P') : 0;
    // Closer keeper credit: the saves role is year-to-year volatile, so FV only
    // banks ~45% of the (risk-adjusted) premium, faded by pitcher aging.
    const savesFv = savesPremium(p) * 0.45 * keeperAgeFactor(metrics[p.id]?.age, true);
    return Math.max(ceiling, sustained) + savesFv;
  };
  // CONSOLIDATION KEEP: an unbalanced (e.g. 2-for-1) trade opens roster spots. You
  // don't fill them off the barren wire — you get to KEEP a player already on your
  // roster, who in a deep league is well above replacement (good players never hit
  // FA). So the freed spot is valued at your best-available keep, not a wire scrub.
  // It scales with league DEPTH: shallow leagues let you keep a real contributor
  // (bigger premium); deep leagues, closer to the margin. Present value scales
  // linearly (repeatable); keeper value diminishes (each extra freed spot keeps a
  // worse guy). Name the actual guy with ＋FA to override the default.
  const depthFactor = Math.sqrt(560 / Math.max(1, settings.teams * settings.keepers)); // 1.0 at Tom's 560; >1 shallower
  // Bare-minimum replacement a rosterable spot is worth (per Tom, deep 20-team):
  // PV 0.7, FV 2.0 — a real kept player, not a wire scrub. Linear per freed spot
  // (each opened spot keeps another replacement-or-better guy); scales up in
  // shallower leagues where the marginal roster player is better.
  const PV_KEEP = 0.7 * depthFactor;
  const FV_KEEP = 2.0 * depthFactor;
  const fillCount = (side: Side) => Math.max(0, (side === 'A' ? sideB : sideA).length - (side === 'A' ? sideA : sideB).length);
  const pvFill = (n: number) => n * PV_KEEP;
  const fvFill = (n: number) => n * FV_KEEP;
  // The side that gives up more players opens that many roster spots. You can fill
  // them with the REAL free agents you'd actually add (their true PV/FV), and any
  // spots you don't name get the theoretical replacement level. Extra FAs beyond
  // the opened spots don't fit on your roster, so they're ignored.
  const openedSide: Side | null = sideA.length < sideB.length ? 'A' : sideB.length < sideA.length ? 'B' : null;
  const openedSpots = openedSide ? Math.abs(sideA.length - sideB.length) : 0;
  const usedFAs = faFills.slice(0, openedSpots);
  const theoreticalFill = Math.max(0, openedSpots - usedFAs.length);
  const sumPv = (s: SearchResult[], side: Side) => {
    let t = s.reduce((acc, p) => acc + pvOf(p), 0);
    if (side === openedSide) t += usedFAs.reduce((acc, p) => acc + pvOf(p), 0) + pvFill(theoreticalFill);
    return t;
  };
  const sumFv = (s: SearchResult[], side: Side) => {
    let t = s.reduce((acc, p) => acc + fvOf(p), 0);
    if (side === openedSide) t += usedFAs.reduce((acc, p) => acc + fvOf(p), 0) + fvFill(theoreticalFill);
    return t;
  };
  const pvDiff = sumPv(sideA, 'A') - sumPv(sideB, 'B');
  const fvDiff = sumFv(sideA, 'A') - sumFv(sideB, 'B');
  const edge = (d: number, unit: string) =>
    Math.abs(d) < 0.05 ? `${unit}: even` : `${unit}: ${d > 0 ? 'you get' : 'you give'} +${Math.abs(d).toFixed(1)}`;

  // ---- Multi-year value projection (feeds the build lenses) ----
  const HORIZON = 6; // seasons out to project (0 = this year … 6)
  const parkOf = (p: SearchResult) => homeParkMultiplier(p.currentTeam.name, p.primaryPosition === 'P');
  const arrivalYear = (lvl: string) => lvl.includes('AAA') ? 1 : lvl.includes('AA') ? 2 : 3;
  // A minor leaguer's per-season value once he arrives: his MLB-level peak (level
  // forced to majors so his current minors discount doesn't suppress his future),
  // scaled by the age curve.
  const peakAnnualMLB = (p: SearchResult) => {
    const m = metrics[p.id];
    if (!m) return 0;
    return computeValue({
      isPitcher: p.primaryPosition === 'P', position: p.primaryPosition,
      war: m.war, peakWrcPlus: m.peakWrcPlus, era20: m.era20, hr: m.hr, sb: m.sb,
      curWrcPlus: m.curWrcPlus, curEra20: m.curEra20, age: 27, level: 'MLB', marketBaseline: m.marketBaseline,
    }, settings).present * parkOf(p);
  };
  // Value a player is worth in season now+k. Year 0 = his real current PV (injury/
  // role baked in). Future years = his HEALTHY value shaped by the age curve — so
  // an injured star rebounds next year, a young guy ramps toward peak, an old guy
  // declines. Minor leaguers contribute nothing until their projected arrival.
  const seasonValue = (p: SearchResult, k: number) => {
    const m = metrics[p.id];
    if (!m) return 0;
    const isP = p.primaryPosition === 'P';
    const lvl = (m.level ?? '').toUpperCase();
    const inMajors = p.sportId === 1 || lvl.includes('MLB') || lvl.includes('MAJOR');
    if (!inMajors) {
      const arr = arrivalYear(lvl);
      return k < arr ? 0 : peakAnnualMLB(p) * abilityCurve((m.age ?? 27) + k, isP);
    }
    if (k === 0) return pvOf(p);
    const healthy = pvOf(p) / injuryMultOf(p);
    const cur = abilityCurve(m.age, isP) || 1;
    return healthy * (abilityCurve((m.age ?? 27) + k, isP) / cur);
  };
  // ---- Build-lens scoring: a player's lens value = weighted average of his
  // projected seasons over the active build's window (see BUILDS). Same per-season
  // scale as PV, so the chips read naturally next to it. The verdict compares the
  // two sides through the active lens; PV and FV stay in the analysis untouched. ----
  const build = BUILDS.find((b) => b.key === buildKey) ?? BUILDS[0];
  const wSum = build.weights.reduce((a, b) => a + b, 0);
  // Production over the build's window (per-season scale) + the market premium the
  // asset commands (fvShare of his keeper FV). The FV term is what makes a massive
  // ceiling gap (J-Rod FV 17.8 vs Trout 6.5) surface in the verdict — production
  // curves alone called Julio-for-Trout "fair," and nobody makes that trade.
  const windowAvg = (p: SearchResult) => build.weights.reduce((acc, w, k) => acc + w * seasonValue(p, k), 0) / wSum;
  const lensOf = (p: SearchResult) => (1 - build.fvShare) * windowAvg(p) + build.fvShare * fvOf(p);
  const lensTitle = `${build.label} value — projected production over the ${build.label.toLowerCase()} window plus the market premium his keeper ceiling commands`;
  // A theoretical consolidation keep gets the same blend: replacement production
  // (PV_KEEP, flat) + the lens's market share of a keeper-worthy FV_KEEP.
  const keepLens = (1 - build.fvShare) * PV_KEEP + build.fvShare * FV_KEEP;
  const sumLens = (s: SearchResult[], side: Side) => {
    let t = s.reduce((acc, p) => acc + lensOf(p), 0);
    if (side === openedSide) t += usedFAs.reduce((acc, p) => acc + lensOf(p), 0) + theoreticalFill * keepLens;
    return t;
  };
  const lensA = sumLens(sideA, 'A');
  const lensB = sumLens(sideB, 'B');
  const lensDiff = lensA - lensB;
  // THEIR perspective: score BOTH sides through their build. They receive what you
  // give (side B) and give up what you get (side A) — their gain is the mirror.
  const theirBuild = BUILDS.find((b) => b.key === theirKey) ?? BUILDS[0];
  const theirWSum = theirBuild.weights.reduce((a, b) => a + b, 0);
  const theirWindowAvg = (p: SearchResult) => theirBuild.weights.reduce((acc, w, k) => acc + w * seasonValue(p, k), 0) / theirWSum;
  const theirLensOf = (p: SearchResult) => (1 - theirBuild.fvShare) * theirWindowAvg(p) + theirBuild.fvShare * fvOf(p);
  const theirKeep = (1 - theirBuild.fvShare) * PV_KEEP + theirBuild.fvShare * FV_KEEP;
  const sumTheirLens = (ps: SearchResult[], side: Side) => {
    let t = ps.reduce((acc, p) => acc + theirLensOf(p), 0);
    if (side === openedSide) t += usedFAs.reduce((acc, p) => acc + theirLensOf(p), 0) + theoreticalFill * theirKeep;
    return t;
  };
  const theirDiff = sumTheirLens(sideB, 'B') - sumTheirLens(sideA, 'A'); // positive = good for THEM

  const renderColumn = (side: Side, players: SearchResult[]) => {
    const isOpened = side === openedSide;
    const showFa = isOpened && usedFAs.length > 0;
    const showTheoretical = isOpened && theoreticalFill > 0;
    return (
    <div className="flex-1 min-w-0 rounded-lg border border-zinc-800 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-300">You {side === 'A' ? 'get' : 'give'}</span>
        <span className="text-[11px] font-bold inline-flex gap-1">
          <Tooltip text="Total present (win-now) value on this side."><span className="text-blue-200">PV {sumPv(players, side).toFixed(1)}</span></Tooltip> ·
          <Tooltip text="Total future (keeper) value on this side."><span className="text-fuchsia-200">FV {sumFv(players, side).toFixed(1)}</span></Tooltip> ·
          <Tooltip text={lensTitle}><span className="text-orange-300">{build.short} {sumLens(players, side).toFixed(1)}</span></Tooltip>
        </span>
      </div>
      {players.length === 0 && !showFa && !showTheoretical ? (
        <p className="text-[11px] text-zinc-600 py-4 text-center">Search above, then tap <strong>+{side}</strong>.</p>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-zinc-100 truncate">{p.fullName} <span className="text-[11px] text-zinc-500">{p.primaryPosition}</span></div>
                <Chips m={metrics[p.id]} isPitcher={p.primaryPosition === 'P'} pv={pvOf(p)} fv={fvOf(p)} lens={{ label: build.short, value: lensOf(p), title: lensTitle }} pending={!loadedIds.has(p.id)} saves={savesPace[p.id]} injured={Boolean(injuries[p.id])} risk={entrench(p) >= 1 ? undefined : ptRisk[p.id]} role={establishedRegular(p) ? undefined : roles[p.id]} />
              </div>
              <button onClick={() => remove(p.id, side)} className="shrink-0 text-zinc-600 hover:text-red-400 cursor-pointer text-sm" title="Remove">✕</button>
            </div>
          ))}
          {/* Real free agents you'd add into the opened spots */}
          {showFa && usedFAs.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2 border-t border-dashed border-zinc-800 pt-2">
              <div className="min-w-0">
                <div className="text-sm text-emerald-200/90 truncate">＋ {p.fullName} <span className="text-[11px] text-zinc-500">{p.primaryPosition} · FA add</span></div>
                <Chips m={metrics[p.id]} isPitcher={p.primaryPosition === 'P'} pv={pvOf(p)} fv={fvOf(p)} lens={{ label: build.short, value: lensOf(p), title: lensTitle }} pending={!loadedIds.has(p.id)} saves={savesPace[p.id]} injured={Boolean(injuries[p.id])} risk={entrench(p) >= 1 ? undefined : ptRisk[p.id]} role={establishedRegular(p) ? undefined : roles[p.id]} />
              </div>
              <button onClick={() => removeFa(p.id)} className="shrink-0 text-zinc-600 hover:text-red-400 cursor-pointer text-sm" title="Remove FA add">✕</button>
            </div>
          ))}
          {/* Theoretical replacement for any opened spot you didn't name a FA for */}
          {showTheoretical && (
            <div className="flex items-start justify-between gap-2 border-t border-dashed border-zinc-800 pt-2" title="Giving up more players than you get back frees roster spots — each one lets you keep another player you'd otherwise have cut (or add a free agent). Valued at a rosterable replacement; tap ＋ name a free agent to use a real player instead.">
              <div className="min-w-0">
                <div className="text-sm text-zinc-400 italic truncate">+{theoreticalFill} roster spot{theoreticalFill === 1 ? '' : 's'} freed <span className="not-italic text-[11px] text-zinc-500">— keep {theoreticalFill === 1 ? 'a player' : 'players'} you&apos;d have cut</span></div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300/80">PV {pvFill(theoreticalFill).toFixed(1)}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-fuchsia-500/15 text-fuchsia-300/80">FV {fvFill(theoreticalFill).toFixed(1)}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-300/80" title={lensTitle}>{build.short} {(theoreticalFill * keepLens).toFixed(1)}</span>
                </div>
              </div>
            </div>
          )}
          {/* Name a real free agent for an opened spot, right from this side */}
          {isOpened && openedSpots > 0 && (
            <button onClick={() => { setAddingFa(true); searchRef.current?.focus(); }}
              className="w-full mt-1 text-[11px] text-emerald-300/80 hover:text-emerald-200 border border-dashed border-emerald-500/30 rounded py-1 cursor-pointer">
              ＋ name a free agent ({theoreticalFill} spot{theoreticalFill === 1 ? '' : 's'} open)
            </button>
          )}
        </div>
      )}
    </div>
    );
  };

  return (
    <div>
      {/* Prominent experimental notice — this tool's values are actively being calibrated. */}
      <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200 flex items-start gap-2">
        <span className="text-sm leading-none mt-0.5">🧪</span>
        <span><strong>Experimental</strong> — the value model is being actively calibrated and numbers can shift week to week. Treat verdicts as a second opinion, not gospel.</span>
      </div>
      <div className="flex justify-center mb-3">
        <div className="inline-flex rounded-md overflow-hidden border border-zinc-700">
          <button onClick={() => setTool('trade')} className={`px-3 py-1 text-xs font-medium cursor-pointer ${tool === 'trade' ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>🔀 Trade checker</button>
          <button onClick={() => setTool('board')} className={`px-3 py-1 text-xs font-medium cursor-pointer ${tool === 'board' ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>📋 Value board</button>
        </div>
      </div>

      {tool === 'board' ? (
        <>
          <div className="mb-3">
            <button onClick={() => setShowSettings((v) => !v)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer">
              ⚙ League settings — {settings.teams}-team · {settings.keepers} keepers · {settings.format.toUpperCase()} {showSettings ? '▲' : '▼'}
            </button>
          </div>
          {showSettings && <LeagueSettingsPanel settings={settings} onChange={updateSettings} />}
          <ValueBoard settings={settings} lenses={BUILDS} isFollowing={() => false} />
        </>
      ) : (
      <>
      <div className="relative max-w-xl mb-4">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); if (debounceRef.current) clearTimeout(debounceRef.current); debounceRef.current = setTimeout(() => search(e.target.value), 300); }}
          onFocus={() => query.length >= 2 && setOpen(true)}
          placeholder={addingFa ? 'Search the free agent you’d add…' : 'Search a player to add to the trade…'}
          className={`w-full px-4 py-2.5 bg-zinc-800/80 border rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none text-sm ${addingFa ? 'border-emerald-500 focus:border-emerald-400' : 'border-zinc-700 focus:border-blue-500'}`}
        />
        {addingFa && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <button onClick={() => setAddingFa(false)} className="text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer">adding FA · cancel</button>
          </div>
        )}
        {open && query.length >= 2 && results.length > 0 && (
          <div className="absolute z-40 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-72 overflow-y-auto">
            {results.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-100 truncate">{r.fullName}</div>
                  <div className="text-[11px] text-zinc-500">{r.primaryPosition} · {r.currentTeam.name}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {addingFa ? (
                    <button onClick={() => { addFa(r); setAddingFa(false); }} disabled={inTrade(r.id)}
                      className="px-2 py-1 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-default cursor-pointer">Add FA</button>
                  ) : (
                    <>
                      {(['A', 'B'] as const).map((s) => (
                        <button key={s} onClick={() => add(r, s)} disabled={inTrade(r.id)}
                          className="px-2 py-1 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-default cursor-pointer">+{s}</button>
                      ))}
                      <button onClick={() => addFa(r)} disabled={inTrade(r.id)} title="Add as a free agent you'd pick up to fill an opened roster spot"
                        className="px-2 py-1 rounded text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-default cursor-pointer">+FA</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3">
        {settingsCustomized ? (
          <button onClick={() => setShowSettings((v) => !v)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer">
            ⚙ League settings — {settings.teams}-team · {settings.keepers} keepers · {settings.format.toUpperCase()} {showSettings ? '▲' : '▼'}
          </button>
        ) : (
          <button onClick={() => setShowSettings(true)}
            className="w-full sm:w-auto rounded-lg border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-2 text-left cursor-pointer">
            <span className="text-sm font-semibold text-orange-300">⚙ Set up YOUR league first</span>
            <span className="block text-[11px] text-zinc-400 mt-0.5">Values below assume the default {settings.teams}-team · {settings.keepers}-keeper · {settings.format.toUpperCase()} league — set your real teams, keepers, format and roster slots so PV/FV fit <em>your</em> league. {showSettings ? '' : 'Tap to open ▾'}</span>
          </button>
        )}
      </div>
      {showSettings && <LeagueSettingsPanel settings={settings} onChange={updateSettings} />}

      {/* Build lens tabs — always visible, so you set your team's posture BEFORE
          building the trade (starts on Overall every visit). */}
      <div className="mb-4">
        <div className="flex justify-center mb-1">
          <div className="inline-flex rounded-md overflow-hidden border border-zinc-700" title="Score the trade through your team's build — each lens weighs the seasons it cares about (win-now = this season + next, contender = the next few, retooling = next year onward, rebuild = 2–3+ years out).">
            {BUILDS.map((b) => (
              <button key={b.key} onClick={() => updateBuild(b.key)}
                className={`px-2.5 py-1 text-[11px] cursor-pointer ${buildKey === b.key ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="text-center text-[11px] text-zinc-600 max-w-xl mx-auto">{build.blurb}</div>
        {(sideA.length > 0 || sideB.length > 0) && (() => {
          const bigger = Math.max(lensA, lensB, 0.1);
          const fair = Math.abs(lensDiff) < 0.08 * bigger || Math.abs(lensDiff) < 0.5;
          const verdictColor = fair ? 'text-zinc-200' : lensDiff > 0 ? 'text-emerald-300' : 'text-rose-300';
          const verdict = fair ? 'Fair trade' : lensDiff > 0 ? `Favors you +${lensDiff.toFixed(1)}` : `Favors them +${(-lensDiff).toFixed(1)}`;
          const tBig = Math.max(sumTheirLens(sideA, 'A'), sumTheirLens(sideB, 'B'), 0.1);
          const tFair = Math.abs(theirDiff) < 0.08 * tBig || Math.abs(theirDiff) < 0.5;
          const winWin = !fair && !tFair && lensDiff > 0 && theirDiff > 0;
          return (
          <div className="text-center mt-2">
            <div className={`text-2xl font-bold ${verdictColor}`}>{verdict}</div>
            {/* The lens totals ARE the fairness basis — most prominent line. */}
            <div className="text-base font-semibold text-zinc-300 mt-0.5">
              {build.label} <span className="text-orange-300">{lensA.toFixed(1)}</span> <span className="text-zinc-500">vs</span> <span className="text-orange-200/80">{lensB.toFixed(1)}</span>
            </div>
            <div className="text-[12px] mt-1 flex flex-wrap justify-center items-center gap-x-2">
              <span className="text-zinc-500">From their side, scored as</span>
              <select value={theirKey} onChange={(e) => setTheirKey(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-200 cursor-pointer">
                {BUILDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              <span className={tFair ? 'text-zinc-300' : theirDiff > 0 ? 'text-emerald-300' : 'text-rose-300'}>
                {tFair ? 'fair' : theirDiff > 0 ? `they gain +${theirDiff.toFixed(1)}` : `they lose ${theirDiff.toFixed(1)}`}
              </span>
              {winWin && <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-semibold" title="Each side comes out ahead through its own build — the trades that actually get accepted.">🤝 win-win by builds</span>}
            </div>
            <div className="text-[11px] mt-1.5 flex flex-wrap justify-center gap-x-4 text-zinc-500">
              <span className="text-blue-200/80">{edge(pvDiff, 'Now')}</span>
              <span className="text-fuchsia-200/80">{edge(fvDiff, 'Keeper')}</span>
            </div>
          </div>
          );
        })()}
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        {renderColumn('A', sideA)}
        {renderColumn('B', sideB)}
      </div>

      {/* FA adds that don't fit the opened spots yet — surfaced, not silently dropped. */}
      {faFills.length > usedFAs.length && (
        <div className="mt-3 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-300/90">
          {faFills.slice(usedFAs.length).map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 mr-3">
              {p.fullName}
              <button onClick={() => removeFa(p.id)} className="text-zinc-500 hover:text-red-400 cursor-pointer" title="Remove">✕</button>
            </span>
          ))}
          <span className="text-zinc-500">— not counted: {openedSpots ? `only ${openedSpots} spot${openedSpots === 1 ? '' : 's'} open` : 'no roster spots open'} on this trade{openedSpots ? ' (give up more players to fit more)' : ''}.</span>
        </div>
      )}

      {faFills.length > 0 && (
        <button onClick={() => setFaFills([])} className="text-[11px] text-zinc-600 hover:text-zinc-400 cursor-pointer mt-2">Clear FA adds</button>
      )}

      <p className="text-[11px] text-zinc-600 mt-3">
        <strong className="text-blue-300">PV</strong> (present) = a WAR + auction-market base plus a live production layer (your current-year rate × <em>actual</em> recent playing time × park), then discounted for injury, a returning/pushing teammate, and job security. Position-aware: 1B/DH lean on the bat, catcher WAR is discounted for defense, and playing-time effects are MLB-only (prospects aren&apos;t docked). <strong className="text-fuchsia-300">FV</strong> (future/keeper) = peak ceiling × age × distance to the majors. An unbalanced trade (e.g. 2-for-1) <strong>frees roster spots</strong> — each one lets you keep a player you&apos;d otherwise have cut, worth at least a rosterable replacement (PV {PV_KEEP.toFixed(1)} · FV {FV_KEEP.toFixed(1)} per spot here, scaling up in shallower leagues), and that backfill counts in every lens total. Name the actual <strong className="text-emerald-300">＋FA</strong> / keeper for a spot to use his real value instead. The <strong className="text-orange-300">build lenses</strong> score every player as an <em>asset</em>: his projected production over the window that build cares about, plus the market premium his keeper ceiling commands (a young star is worth more than his seasons — you can always flip him). <strong>Overall</strong> weighs the present most and decays outward; <strong>Win-now</strong> = this season + next, <strong>Contender</strong> = the next few, <strong>Retooling</strong> = next year onward (this season conceded), <strong>Rebuild</strong> = 2–3+ years out — the further out your window, the more the ceiling premium counts. The verdict compares both sides through your active lens. Premium — a work in progress.
      </p>
      </>
      )}
    </div>
  );
}
