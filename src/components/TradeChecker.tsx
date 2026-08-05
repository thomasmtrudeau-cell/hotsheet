'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { SearchResult, PremiumMetrics, InjuryStatus, isMLBSystem } from '@/lib/types';
import { homeParkMultiplier } from '@/lib/parks';
import { AUCTION_VALUES, AUCTION_AS_OF } from '@/lib/auction-values';
import { liveValue, ValueLayers, presentMaturity, overallValue, ptFragility, earningPtBump, LeagueSettings, DEFAULT_SETTINGS } from '@/lib/value-model';
import LeagueSettingsPanel from './LeagueSettingsPanel';
import PremiumTeaser from './PremiumTeaser';
import RanksToggle from './RanksToggle';
import Tooltip from './Tooltip';
import ValueBoard from './ValueBoard';

const SETTINGS_KEY = 'hotsheet_league_settings';

interface TradeCheckerProps {
  isPremium: boolean;
  isOwner?: boolean; // owner-only: gates the Value Board tab until it's trustworthy
}

type Side = 'A' | 'B';

function Chips({ m, isPitcher, pv, fv, outlook, pending, saves, pt, ip, ptBlended, injured, armRisk, longTermIL, belowRepl, elig, repsAtRisk, riskText, role, cShare }: { m?: PremiumMetrics; isPitcher: boolean; pv: number; fv: number; outlook?: { next3: number; peakSeason: number }; pending?: boolean; saves?: number; pt?: number; ip?: number; ptBlended?: boolean; injured?: boolean; armRisk?: boolean; longTermIL?: boolean; belowRepl?: boolean; elig?: string; repsAtRisk?: boolean; riskText?: string; role?: { label: string; factor: number }; cShare?: number }) {
  const chip = 'px-1.5 py-0.5 rounded text-[10px] font-bold';
  const lbl = 'text-[9px] uppercase tracking-wide text-zinc-600 w-12 shrink-0';
  if (pending) {
    return <div className="mt-1 text-[10px] text-zinc-500 animate-pulse">◍ pricing…</div>;
  }
  const multiElig = Boolean(elig && elig.includes('/'));
  const partTimeC = cShare !== undefined && cShare < 0.8; // catcher haircut eased/removed by his real position mix
  const repsRow = pt !== undefined || ip !== undefined || (role && role.factor < 1 && !injured) || injured || repsAtRisk || belowRepl || multiElig || partTimeC;
  return (
    <div className="mt-1 space-y-1">
      {/* value */}
      <div className="flex flex-wrap items-center gap-1">
        <span className={lbl}>value</span>
        <Tooltip text="What he's worth to your lineup THIS season."><span className={`${chip} bg-blue-500/25 text-blue-200`}>Now {pv.toFixed(1)}</span></Tooltip>
        <Tooltip text="What he's worth held as a keeper across future seasons."><span className={`${chip} bg-fuchsia-500/25 text-fuchsia-200`}>Keep {fv.toFixed(1)}</span></Tooltip>
        {outlook && <Tooltip text="Average per-season value over the NEXT 3 seasons (this one excluded), on the Now scale — current form walked along the aging curve × career-survival odds, or for pre-peak players the peak estimate bent by the maturation ramp and arrival risk. An injury this season doesn't drag it down (that's priced in Now, not here)."><span className={`${chip} bg-violet-500/25 text-violet-200`}>3yr {outlook.next3.toFixed(1)}</span></Tooltip>}
        {outlook && <Tooltip text="What his Now value projects to be at PEAK age (wRC+/HR/SB/WAR priced at an everyday MLB role) — or, if he's already at/past peak, his best single season after this one. The ceiling if he develops as projected; bust risk lives in Keep, not here."><span className={`${chip} bg-rose-500/25 text-rose-200`}>Best yr {outlook.peakSeason.toFixed(1)}</span></Tooltip>}
      </div>
      {/* ability */}
      <div className="flex flex-wrap items-center gap-1">
        <span className={lbl}>ability</span>
        {m?.war !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.war.toFixed(1)} WAR</span>}
        {m && !isPitcher && m.peakWrcPlus !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.peakWrcPlus} wRC+</span>}
        {m && isPitcher && m.era20 !== undefined && <span className={`${chip} bg-amber-500/20 text-amber-300`}>{m.era20.toFixed(2)} ERA/20</span>}
        {m && !isPitcher && m.dual && <span className={`${chip} bg-amber-500/20 text-amber-200`} title="Projected 30+ (or 40+) combined HR + SB">⚡💪{m.dual === 'double-plus' ? '40+' : '30+'}</span>}
        {m && !isPitcher && !m.dual && m.power && <span className={`${chip} bg-amber-500/20 text-amber-200`} title="Power">💪{m.power === 'double-plus' ? '++' : '+'}</span>}
        {m && !isPitcher && !m.dual && m.speed && <span className={`${chip} bg-amber-500/20 text-amber-200`} title="Speed">⚡{m.speed === 'double-plus' ? '++' : '+'}</span>}
        {m && !isPitcher && m.def && <span className={`${chip} ${m.def.includes('plus') ? 'bg-green-500/20 text-green-300' : 'bg-red-500/15 text-red-300'}`} title="Defense — mostly playing-time insurance in fantasy">🧤{m.def === 'double-plus' ? '++' : m.def === 'plus' ? '+' : m.def === 'double-minus' ? '−−' : '−'}</span>}
        {isPitcher && saves !== undefined && saves >= 10 && <span className={`${chip} bg-teal-500/20 text-teal-300`} title="Projected saves at his current pace, risk-adjusted for a shaky closer">🧯 ~{saves} SV</span>}
        <RanksToggle ranks={m?.ranks} isPitcher={isPitcher} compact />
      </div>
      {/* reps / status */}
      {repsRow && (
        <div className="flex flex-wrap items-center gap-1">
          <span className={lbl}>reps</span>
          {pt !== undefined && <Tooltip text={`Projected rest-of-season plate appearances${ptBlended ? ' (Depth-Chart projection blended with recent usage)' : ''} — playing time is an estimate.`}><span className={`${chip} bg-sky-500/20 text-sky-300`}>~{pt} PA</span></Tooltip>}
          {ip !== undefined && <Tooltip text="Projected rest-of-season innings (Depth-Chart blended with role) — an estimate."><span className={`${chip} bg-sky-500/20 text-sky-300`}>~{ip} IP</span></Tooltip>}
          {role && role.factor < 1 && !injured && <span className={`${chip} bg-zinc-600/40 text-zinc-300`} title="Recent usage looks part-time">{role.label.toLowerCase()}</span>}
          {injured && <span className={`${chip} bg-red-500/20 text-red-400`} title={longTermIL ? 'Long-term IL (60-day / full-season / post-surgery) — no value the rest of this season; keeper value faded for the injury' : armRisk ? 'On the injured list — arm injury (shoulder/elbow); keeper value faded too' : 'On the injured list'}>{longTermIL ? (armRisk ? 'out · arm (long-term)' : 'out — long-term IL') : armRisk ? 'on IL · arm' : 'on IL'}</span>}
          {repsAtRisk && <Tooltip text={riskText || 'His reps could be squeezed.'}><span className={`${chip} bg-amber-500/20 text-amber-300`}>reps at risk</span></Tooltip>}
          {multiElig && <Tooltip text="Multi-position eligibility (from the projection's position list — a rough guide, may differ from your league's exact games-played rules)"><span className={`${chip} bg-indigo-500/20 text-indigo-300`}>🔀 {elig}</span></Tooltip>}
          {partTimeC && <Tooltip text={`Catches in only ${Math.round(cShare! * 100)}% of his games (rest at LF/DH/1B etc.), so the catcher WAR/volume haircut is ${cShare! <= 0.4 ? 'removed' : 'reduced'} — his bat isn't squat-suppressed like a full-time catcher's, and he keeps C-eligibility scarcity.`}><span className={`${chip} bg-teal-500/20 text-teal-300`}>🧢 C {Math.round(cShare! * 100)}%</span></Tooltip>}
          {belowRepl && <Tooltip text="Below replacement — you can generally find a comparable or better player in free agency or on the back end of most rosters, so he adds little value in a trade."><span className={`${chip} bg-zinc-600/40 text-zinc-400`}>▼ below replacement</span></Tooltip>}
        </div>
      )}
    </div>
  );
}

export default function TradeChecker({ isPremium, isOwner = false }: TradeCheckerProps) {
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
  const [catcherShares, setCatcherShares] = useState<Record<number, number>>({}); // catchers: fraction of played games actually BEHIND THE PLATE (scales the C haircuts)
  const [batSides, setBatSides] = useState<Record<number, string | undefined>>({}); // L/R/S — for lefty platoon risk
  const [loadedIds, setLoadedIds] = useState<Set<number>>(new Set()); // ids whose sheet metrics have arrived (loading-skeleton gate)
  const [ros, setRos] = useState<{ asOf: string | null; hitters: Record<string, { wrc?: number; sv?: number }>; pitchers: Record<string, { era?: number; sv?: number }> }>({ asOf: null, hitters: {}, pitchers: {} });
  const [savesPace, setSavesPace] = useState<Record<number, number>>({}); // MLB pitchers: projected full-season saves
  const [bullpen, setBullpen] = useState<Array<{ nameKey: string; team?: string; role?: string; peakEra20: number; currentEra20: number }> | null>(null); // all RPs w/ projected+actual ERA (lazy)
  const [settings, setSettings] = useState<LeagueSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsCustomized, setSettingsCustomized] = useState(true); // assume yes until load says otherwise (no flash)
  const [tool, setTool] = useState<'trade' | 'board'>('trade'); // trade checker vs bulk value board
  const [addingFa, setAddingFa] = useState(false); // FA-add mode (triggered from a column)
  const [showHow, setShowHow] = useState(false); // "How scoring works" explainer — collapsed by default (less wall-of-text)
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
  // Rest-of-season projections (uploaded daily from the Mac pipeline) — the
  // forward-looking rate PV prefers over current-year actuals.
  useEffect(() => {
    fetch('/api/ros').then((r) => r.json())
      .then((d) => setRos({ asOf: d?.asOf ?? null, hitters: d?.hitters ?? {}, pitchers: d?.pitchers ?? {} }))
      .catch(() => {});
  }, []);
  const rosKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`.]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
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
      setMetrics({}); setInjuries({}); setPtRisk({}); setRoles({}); setCatcherShares({}); setBatSides({}); setLoadedIds(new Set()); setSavesPace({});
      fetchedRef.current = new Set();
      return;
    }
    const fresh = all.filter((p) => !fetchedRef.current.has(p.id));
    if (fresh.length === 0) return;
    for (const p of fresh) fetchedRef.current.add(p.id);
    // IL-aware playing-time role per hitter (few players in a trade, so per-player
    // team-game-log fetches are fine). The role dock is majors-only — never dock
    // prospects — but catchers at ANY level also get their position mix read here
    // (share of played games actually behind the plate scales the C haircuts, so
    // a C/LF/DH prospect isn't taxed like a full-time squatter).
    Promise.all(fresh.filter((p) => p.primaryPosition !== 'P' && (p.sportId === 1 || p.primaryPosition === 'C')).map(async (p) => {
      try {
        const r = await fetch(`/api/stats/gamelog?playerId=${p.id}&sportId=${p.sportId}&pitcher=0&teamId=${p.currentTeam.id}`);
        const d = await r.json();
        const entries: Array<{ dnp?: boolean; position?: string }> = d.entries ?? [];
        // Catcher position mix: how often he ACTUALLY catches (a "C/LF" game counts —
        // he squatted that day). Needs a real sample to override the roster label.
        let cShare: number | undefined;
        if (p.primaryPosition === 'C') {
          const played = entries.filter((e) => !e.dnp && e.position);
          if (played.length >= 8) cShare = played.filter((e) => e.position!.split('/').includes('C')).length / played.length;
        }
        const hasDnp = entries.some((e) => e.dnp);
        if (p.sportId !== 1 || !hasDnp || entries.length < 10) return [p.id, null, cShare] as const;
        const rate = entries.filter((e) => !e.dnp).length / entries.length;
        const role = { rate, label: rate >= 0.8 ? 'Everyday' : rate >= 0.5 ? 'Part-time' : 'Bench', factor: rate >= 0.8 ? 1 : rate >= 0.5 ? 0.85 : 0.7 };
        return [p.id, role, cShare] as const;
      } catch { return [p.id, null, undefined] as const; }
    })).then((triples) => {
      if (!mountedRef.current) return;
      setRoles((prev) => {
        const m = { ...prev };
        for (const [id, role] of triples) if (role) m[id] = role;
        return m;
      });
      setCatcherShares((prev) => {
        const m = { ...prev };
        for (const [id, , cShare] of triples) if (cShare !== undefined) m[id] = cShare;
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
  // Perpetual job-security discount = WAR as PRESENT playing-time confidence: a
  // low-WAR regular is always a slump/call-up from losing the job, even if
  // full-time now. Position-aware (ptFragility): gentler up-the-middle where the
  // glove holds the job, steeper at corners. 1B/DH get the extra bat override —
  // their WAR is positionally deflated, so a good bat (high wRC+) secures the spot
  // regardless (for them, wRC+ rules).
  const jobSecurity = (p: SearchResult) => {
    if (p.primaryPosition === 'P') return 1;
    if (p.sportId !== 1) return 1; // job security is an MLB concept — never dock prospects
    const war = metrics[p.id]?.war;
    if (war === undefined) return 1;
    let f = ptFragility(war, p.primaryPosition);
    // A 1B/DH's job IS his bat — a plus bat holds an everyday role even at modest
    // WAR (a 1.5-WAR, 107-wRC+ power 1B like Burger isn't a PT risk), so job
    // security keys on wRC+ for them, not the WAR tier.
    if (p.primaryPosition === '1B' || p.primaryPosition === 'DH') {
      const wrc = metrics[p.id]?.peakWrcPlus ?? 0;
      const batSecure = wrc >= 105 ? 1.0 : wrc >= 95 ? 0.95 : wrc >= 85 ? 0.85 : 0.75;
      f = Math.max(f, batSecure);
    }
    // Same "production rules" logic for anyone with a real counting profile: scarce
    // combined HR+SB are why he's in the lineup, so they secure the job somewhat even
    // at a low WAR. NOTE: `dual` = 30+ (plus) / 40+ (double-plus) COMBINED HR+SB — not
    // 30/30. Trevor Story is ~17 HR + ~20 SB (a ~30-combined 'plus'), so he gets a
    // modest floor, not a lock.
    const m = metrics[p.id];
    const hrsb = (m?.hr ?? 0) + (m?.sb ?? 0);
    const countSecure = m?.dual === 'double-plus' ? 1.0 : m?.dual === 'plus' || hrsb >= 45 ? 0.97 : hrsb >= 35 ? 0.93 : 0;
    return Math.max(f, countSecure);
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
  // Raw sheet inputs for the shared value pipeline. Live signals (injury, park,
  // saves, observed role, platoon, PT threats) ride in separately via layersOf.
  const inputsOf = (p: SearchResult) => {
    const m = metrics[p.id] ?? {};
    return {
      isPitcher: p.primaryPosition === 'P', position: p.primaryPosition,
      war: m.war, peakWrcPlus: m.peakWrcPlus, era20: m.era20,
      hr: m.hr, sb: m.sb, curWrcPlus: m.curWrcPlus, curEra20: m.curEra20,
      age: m.age, level: m.level, marketBaseline: m.marketBaseline,
      defRuns: m.defRuns, ipg: m.ipg,
      catcherShare: catcherShares[p.id],
    };
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
    const def = m.def;
    // "Established" = a PROVEN everyday role whose game-log DNPs are noise (rest,
    // paternity, a rehab week) — NOT a projection of talent. Deliberately does NOT
    // key on projected WAR: a high peak WAR does not mean a guy is actually playing
    // (Gabriel Arias 2.6 / Anthony Volpe 3.0 can be part-time or benched), and
    // letting WAR manufacture everyday status was erasing real playing-time risk.
    // A genuinely elite bat (wRC+) is in the lineup; a 30+ vet has the track record.
    return wrc >= 118 || (age >= 30 && (wrc >= 100 || war >= 1.8))
      || (age >= 30 && (def === 'plus' || def === 'double-plus')); // glove-first everyday vet
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
  // ---- Rest-of-season playing-time estimate (hitters). PT is a probability
  // guess, so this is explicitly an estimate. Base = recent games-played rate;
  // nudged by current-year form (a hot bat earns manager slack, a cold one loses
  // reps); the crowd/IL threats already dock the rate upstream. Blended with the
  // FanGraphs Depth-Chart PA from a fresh auction export — equal weight when
  // fresh, decaying to all-algorithm over ~4 weeks, and the stale snapshot is
  // rescaled to today's remaining games (it projected from more games left). ----
  const seasonFrac = (iso?: string) => {
    const start = Date.parse('2026-03-26');
    const now = iso ? Date.parse(iso) : Date.now();
    return Math.min(1, Math.max(0, (now - start) / (183 * 86_400_000)));
  };
  const remainingGames = Math.round(162 * (1 - seasonFrac()));
  const PA_PER_GAME = 4.15;
  // Projected ROS role fraction straight from the projection export (PA rescaled
  // to today's remaining games), 0–1.1. This is the GROUND-TRUTH playing-time
  // signal — a near-zero value means the projections don't think he's in an MLB
  // lineup (optioned, quad-A, buried), whatever his rate stats or WAR say. Undefined
  // when we can't know (no export entry, pitcher, minors, or injured — the IL
  // depresses PA for a reason handled elsewhere), so callers leave value untouched.
  const projRole = (p: SearchResult): number | undefined => {
    if (p.sportId !== 1 || p.primaryPosition === 'P' || injuries[p.id]) return undefined;
    const aPa = AUCTION_VALUES[String(p.id)]?.pa;
    if (aPa === undefined || !AUCTION_AS_OF) return undefined;
    const exportRemain = Math.round(162 * (1 - seasonFrac(AUCTION_AS_OF))) || 1;
    const scaled = aPa * (remainingGames / exportRemain);
    return Math.max(0, Math.min(1.1, scaled / (remainingGames * PA_PER_GAME)));
  };
  const estRosPA = (p: SearchResult): { pa: number; blended: boolean } | undefined => {
    if (p.sportId !== 1 || p.primaryPosition === 'P') return undefined;
    if (seasonEnding(p)) return { pa: 0, blended: false }; // 60-day/full-season IL or post-surgery — done for the year
    let prob = ptRateOf(p); // 1 for established/injured (handled in ptRateOf), else recent rate
    const wrc = metrics[p.id]?.curWrcPlus ?? metrics[p.id]?.peakWrcPlus;
    if (wrc !== undefined) prob = Math.max(0.3, Math.min(1, prob + (wrc - 100) / 300)); // form slack
    const algoPA = remainingGames * prob * PA_PER_GAME;
    const aPa = AUCTION_VALUES[String(p.id)]?.pa;
    // An injured player's auction PA is depressed by missed time, not a part-time
    // role — blending it would misprice him as a platoon guy. Value his everyday
    // role (algo, full reps); the "currently out" hit is applied separately by
    // injuryMultOf. As he nears return the projection recovers on its own.
    if (aPa === undefined || !AUCTION_AS_OF || injuries[p.id]) return { pa: Math.round(algoPA), blended: false };
    const exportRemain = Math.round(162 * (1 - seasonFrac(AUCTION_AS_OF))) || 1;
    const scaledAuction = aPa * (remainingGames / exportRemain);       // rescale stale magnitude
    // A near-zero ROS PA projection is a definitive "not in an MLB lineup" signal
    // (optioned, quad-A, buried) — NOT a stale full-season number to rescale. Trust
    // it directly; otherwise the everyday algo (which assumes a full role for any
    // 40-man player via establishedRegular) inflates a 3-PA guy back up to ~90
    // (Patrick Wisdom: 34, stuck in AAA, projected 3 PA yet read ~92).
    if (scaledAuction < 0.15 * remainingGames * PA_PER_GAME) return { pa: Math.round(scaledAuction), blended: false };
    const ageDays = (Date.now() - Date.parse(AUCTION_AS_OF)) / 86_400_000;
    const wA = 0.66 * Math.max(0, 1 - ageDays / 28);                   // 66% DC when fresh -> 0 by ~4wk (they know Story/Semien play every day)
    return { pa: Math.round(wA * scaledAuction + (1 - wA) * algoPA), blended: wA > 0 };
  };
  const estRosIP = (p: SearchResult): number | undefined => {
    if (p.sportId !== 1 || p.primaryPosition !== 'P') return undefined;
    if (seasonEnding(p)) return 0; // on the 60-day/full-season IL or post-surgery — not pitching again this season
    const ipg = metrics[p.id]?.ipg;
    const isRp = ipg !== undefined && ipg < 2.01;
    const algoIP = isRp ? remainingGames * 0.33 : (remainingGames / 5) * (ipg ?? 5.4); // RP ~1/3 IP per team game; SP ~1 turn/5
    const aIp = AUCTION_VALUES[String(p.id)]?.ip;
    // Unlike a position player's PA, missed starts don't come back (you can't make
    // up a rotation turn), so a short-term injured pitcher's auction IP — which
    // already reflects the missed time — is the better estimate than a full workload.
    if (aIp === undefined || !AUCTION_AS_OF) return Math.round(algoIP);
    const exportRemain = Math.round(162 * (1 - seasonFrac(AUCTION_AS_OF))) || 1;
    const scaled = aIp * (remainingGames / exportRemain);
    const ageDays = (Date.now() - Date.parse(AUCTION_AS_OF)) / 86_400_000;
    const wA = 0.66 * Math.max(0, 1 - ageDays / 28);
    return Math.round(wA * scaled + (1 - wA) * algoIP);
  };
  const ptCredit = (p: SearchResult) => {
    const est = estRosPA(p);
    if (!est) return ptRateOf(p); // pitchers / minors — keep live-usage rate
    const frac = est.pa / (remainingGames * PA_PER_GAME);
    // Normally floor at 0.3 — a rostered player gets SOME reps, and we don't zero a
    // deep part-timer. But a genuine near-zero projection (optioned/buried) is
    // allowed to fall through: he's not an MLB contributor this season, so his
    // present value should reflect that rather than being propped up at 30%.
    const floor = frac < 0.15 ? 0.03 : 0.3;
    return Math.max(floor, Math.min(1.05, frac));
  };
  // (The fantasy-production layer — current-form rate + scarce HR/SB counting ×
  // playing time — now lives in value-model's shared liveValue, fed the live
  // ROS rates + ptCredit below. This keeps the board and the trade calc in sync.)
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
  const ptDockEff = (p: SearchResult) => (injuries[p.id] ? 1 : 1 - (1 - ptDock(ptRisk[p.id])) * (1 - entrench(p)));
  // "Reps at risk" is a BLANKET flag on the player's own marginality — a low
  // WAR/wRC+ profile is a slump/platoon/call-up from losing reps regardless of any
  // named threat (jobSecurity already encodes this, position-aware, with the bat/
  // counting escapes). A specific same-spot teammate threat (roster crowd, AAA
  // pusher, IL returnee) layers ON TOP as extra detail. Entrenched stars are exempt.
  const repsRiskOf = (p: SearchResult): { atRisk: boolean; text: string } => {
    if (p.sportId !== 1 || p.primaryPosition === 'P' || injuries[p.id]) return { atRisk: false, text: '' };
    const marginal = jobSecurity(p) < 0.9;
    const named = entrench(p) < 1 ? ptRisk[p.id] : undefined;
    if (!marginal && !named) return { atRisk: false, text: '' };
    const parts: string[] = [];
    if (marginal) parts.push('Modest WAR/wRC+ for the spot — a slump, platoon, or call-up away from losing reps.');
    // A named threat now means a genuine SEAT SQUEEZE (more quality bats than
    // lineup spots in his position group), not just one teammate existing.
    if (named) parts.push(`More quality bats than spots in his position group — ${named.name} (${named.position}) ${named.kind === 'crowd' ? 'shares the lineup seats' : named.kind === 'depth' ? 'is pushing up from the minors' : 'is returning from the IL'}.`);
    return { atRisk: true, text: parts.join(' ') };
  };
  // Season-ending / long-term injury. MLB roster NOTES are often empty for
  // prospects, so the reliable signal is the IL CODE: D60 (60-day) or ILF
  // (full-season). A surgery note (Tommy John / UCL / labrum) counts too. These
  // wipe out THIS season — no present value, no projected reps (a TJ pitcher isn't
  // throwing 62 IP the rest of the year).
  const SURGERY_RX = /tommy john|\bucl\b|internal brace|ligament|labrum|rotator|flexor tendon|elbow surgery|season[- ]ending|out for the (season|year)/i;
  const seasonEnding = (p: SearchResult) => {
    const inj = injuries[p.id];
    if (!inj) return false;
    // Full-season IL or a confirmed season-ending surgery = done for the year.
    if (inj.code === 'ILF' || SURGERY_RX.test(inj.note ?? '')) return true;
    // The 60-day IL is NOT automatically season-ending — plenty return from it with
    // the season still going (Trevor Story: sports hernia, already in full baseball
    // activities, projected 167 PA). Trust the projection: if OOPSY still gives him
    // meaningful ROS reps he's coming back; if it's written him off (absent from the
    // export, or ~0 projected reps) he's effectively done (Snelling: TJ, empty note
    // but no projection at all).
    if (inj.code === 'D60') {
      const a = AUCTION_VALUES[String(p.id)];
      if (!a) return true;
      const proj = p.primaryPosition === 'P' ? a.ip : a.pa;
      return proj === undefined || proj <= 20;
    }
    return false;
  };
  // Injury dock scales with entrenchment: a fringe guy's IL stint threatens his job
  // (heavy dock), an entrenched everyday star (J-Rod) returns to his role (light
  // hedge). A SEASON-ENDING injury tanks present value to ~zero — he contributes
  // nothing the rest of this season. The FV floor divides this back out (pvOf /
  // injuryMultOf) to recover his healthy keeper value, which armRiskOf then dings.
  const injuryMultOf = (p: SearchResult) => (
    !injuries[p.id] ? 1
    : seasonEnding(p) ? 0.02
    : establishedRegular(p) ? 0.9
    : 0.6 + 0.35 * entrench(p)
  );
  // Pitcher ARM injuries fade KEEPER value, not just current availability, because
  // the WAR projection is BLIND to the surgery (a fresh Tommy John is still a 3+ WAR
  // arm on paper). A confirmed surgery hits hardest; a 60-day/full-season pitcher IL
  // is a major injury even when the note is sparse (most are arm), so it dings too;
  // a shorter-term arm note is lighter.
  const ARM_RX = /elbow|ucl|tommy john|shoulder|rotator|labrum|\blat\b|forearm|flexor|biceps|triceps/i;
  const armRiskOf = (p: SearchResult) => {
    const inj = injuries[p.id];
    if (!inj || p.primaryPosition !== 'P') return 1;
    const note = inj.note ?? '';
    if (SURGERY_RX.test(note)) return 0.5;                    // confirmed surgery (TJ/UCL/labrum)
    if (inj.code === 'D60' || inj.code === 'ILF') return 0.65; // major long-term pitcher IL (likely arm)
    if (ARM_RX.test(note)) return 0.85;                      // shorter-term arm note
    return 1;
  };
  // Saves premium — a FALLBACK only. The auction market already prices saves into
  // a closer's dollar value (his Dollars, hence marketBaseline, includes the SV
  // category), and present value is market-led — so for anyone IN the export the
  // market carries saves and an explicit premium would DOUBLE-COUNT them (it was
  // inflating closer PV and, via the sustained-keeper floor, their FV: Devin
  // Williams read Now 3.9 / Keep 5.2 vs a market-honest ~1.4 / ~1.5). We keep the
  // premium ONLY for a closer ABSENT from the export, where the market has no
  // saves signal to price (the original "Jansen read PV 0.0" case). Risk-adjusted:
  // a poor run-prevention projection is a blown-save streak from losing the job,
  // so it fades as ERA/20 climbs (elite ≤3.4 keeps 100%; ~4.2 ~80%; 5.1 ~57%).
  const savesPremium = (p: SearchResult) => {
    if (metrics[p.id]?.marketBaseline !== undefined) return 0; // market already prices saves
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
  // Earning-reps nudge: a prime-age, high-peak-WAR bat who's currently part-time
  // is talent waiting to play — give a little of the reps dock back (he tends to
  // force his way in). Narrow by design; most high-WAR guys are already treated as
  // everyday by establishedRegular, so this bites the in-between case (a young stud
  // in a timeshare not yet clearing the established bar). Off for injured/pitchers.
  const earnBump = (p: SearchResult) => {
    if (p.sportId !== 1 || p.primaryPosition === 'P' || injuries[p.id]) return 1;
    return earningPtBump(metrics[p.id]?.war ?? 0, metrics[p.id]?.age, roles[p.id]?.rate);
  };
  // Assemble the LIVE layers for a player — every game-log / injury / park / saves
  // signal, each collapsing to neutral (1, or 0 for saves) when it doesn't apply.
  // The shared liveValue in value-model takes these on top of the neutral base;
  // the Value Board passes only the bulk-available ones (isMLB + ROS rates), so a
  // player with no live adjustments reads identically in both places.
  const layersOf = (p: SearchResult): ValueLayers => {
    const k = rosKey(p.fullName);
    const arm = armRiskOf(p);
    return {
      isMLB: p.sportId === 1,
      ptCredit: ptCredit(p),
      rosWrc: p.primaryPosition !== 'P' ? ros.hitters[k]?.wrc : undefined,
      rosEra: p.primaryPosition === 'P' ? ros.pitchers[k]?.era : undefined,
      savesPremium: savesPremium(p),
      fvPtFactor: fvPtFactor(p),
      injuryMult: injuryMultOf(p),
      armPvMult: arm === 1 ? 1 : 0.93,
      armFvMult: arm,
      ptDockEff: ptDockEff(p),
      jobSecurity: jobSecurity(p),
      earnBump: earnBump(p),
      platoonDock: platoonDock(p),
      homePark: homeParkMultiplier(p.currentTeam.name, p.primaryPosition === 'P'),
    };
  };
  const valueOf = (p: SearchResult) => liveValue(inputsOf(p), settings, layersOf(p));
  const pvOf = (p: SearchResult) => valueOf(p).present;
  // Keeper value also takes a (softer) playing-time hit: a projection that
  // assumes a full-time role is worth less if that role is tenuous — a returning/
  // pushing teammate (Arias behind Ramírez) or a part-time role now. Softer than
  // the present-value dock since keeper horizons give the logjam time to resolve.
  // Keeper role reality: keeper value assumes future EVERYDAY reps. A player the
  // projections give ~no ROS role isn't holding an MLB job, so his keeper "ceiling"
  // is partly illusory — and the OLDER he is, the less likely he ever gets that role
  // (a 34-yo quad-A masher is who he is; a 22-yo blocked prospect still has time).
  // Docks the ceiling by how far below a real role he's projected, scaled by age.
  // Complements roleF below, which needs an MLB game-log rate the minors lack and
  // only covers ≤29. Injured / pitchers / absent-from-export → projRole undefined → 1,
  // so everyday regulars and legit keepers are untouched (Patrick Wisdom: 34,
  // projected 3 PA → ~0.2, obliterating his keeper ceiling).
  const keeperRoleReality = (p: SearchResult) => {
    const pr = projRole(p);
    if (pr === undefined || pr >= 0.6) return 1;                       // has a real (or unknown) role
    const age = metrics[p.id]?.age ?? 26;
    const shortfall = Math.max(0, Math.min(1, (0.6 - pr) / 0.6));      // 0 at a 0.6 role → 1 at zero role
    const ageSeverity = Math.max(0, Math.min(1, (age - 24) / 10));     // 24- → 0 … 34+ → 1
    const maxDock = 0.15 + 0.65 * ageSeverity;                         // young: ≤15% off; old: up to 80% off
    return 1 - maxDock * shortfall;
  };
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
    return risk * roleF * keeperRoleReality(p);
  };
  // Keeper value: the durability-tilted ceiling floored by sustained production —
  // now computed inside the shared liveValue (fed the fvPtFactor / saves / arm-risk
  // layers above), so the board and trade calc grade Keep identically.
  const fvOf = (p: SearchResult) => valueOf(p).future;
  // Per-season future outlook (computed inside liveValue): avg of the next 3
  // seasons + best single future season. Hidden when age is unknown.
  const outlookOf = (p: SearchResult) => valueOf(p).outlook;
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
  // PV 0.7, FV 1.7 — a freely-available player, not a star. Overall replacement
  // derives to ¼·0.7 + ¾·1.7 = 1.45. All scale UP in shallower leagues (bigger
  // depthFactor) where more talent sits on the wire / available to backfill.
  const PV_KEEP = 0.7 * depthFactor;
  const FV_KEEP = 1.7 * depthFactor;
  const fillCount = (side: Side) => Math.max(0, (side === 'A' ? sideB : sideA).length - (side === 'A' ? sideA : sideB).length);
  // Every freed spot backfills at the SAME replacement level (per Tom: 2nd/3rd/4th
  // backfill guys are readily available on the wire / roster back end, so no
  // diminishing). Linear in the number of spots freed.
  const pvFill = (n: number) => n * PV_KEEP;
  const fvFill = (n: number) => n * FV_KEEP;
  // Overall (dynasty asset) value + the replacement floor. A player whose OVERALL
  // worth is below a freely-available keeper is a "you'd cut him for a free agent"
  // guy — so in a trade he's worth exactly a roster spot, no more, no less. Floor
  // his contribution at replacement. This stops a sub-replacement throw-in from
  // padding a side or out-ranking a real player (Peters −$2.4 out-valuing Dubón),
  // and makes "receive a scrub" identical to "free a spot". Applies to prospects
  // too: a real prospect's big keeper ceiling (FV) keeps his overall above the line,
  // but a low-FV/useless prospect (overall ≈ ¾ of his FV) falls below it and floors,
  // so you can't hack a trade by tossing in throwaway prospects.
  const ovOf = (p: SearchResult) => valueOf(p).overall;
  const ovKeep = overallValue(PV_KEEP, FV_KEEP);
  const belowRepl = (p: SearchResult) => metrics[p.id] !== undefined && ovOf(p) < ovKeep;
  // A player contributes his REAL value to a trade, floored at 0. We floor at 0
  // (not at replacement) for two reasons: (1) it keeps the totals reconciling with
  // the per-player grades you see on the cards — flooring a below-replacement guy
  // UP to replacement made "You give" not add up (Sanoja showed Overall 1.1 but
  // counted as 1.45); (2) flooring a GIVEN-AWAY player up to a roster spot
  // double-counts the "+1 roster spot freed" line, which already prices the roster
  // asymmetry. The 0 floor still blocks the original hack — a negative-value
  // throw-in can't pad a side down. Below-replacement stays a UI badge (info only).
  const pvContrib = (p: SearchResult) => Math.max(0, pvOf(p));
  const fvContrib = (p: SearchResult) => Math.max(0, fvOf(p));
  const ovContrib = (p: SearchResult) => Math.max(0, ovOf(p));
  // The side that gives up more players opens that many roster spots. You can fill
  // them with the REAL free agents you'd actually add (their true PV/FV), and any
  // spots you don't name get the theoretical replacement level. Extra FAs beyond
  // the opened spots don't fit on your roster, so they're ignored.
  const openedSide: Side | null = sideA.length < sideB.length ? 'A' : sideB.length < sideA.length ? 'B' : null;
  const openedSpots = openedSide ? Math.abs(sideA.length - sideB.length) : 0;
  const usedFAs = faFills.slice(0, openedSpots);
  const theoreticalFill = Math.max(0, openedSpots - usedFAs.length);
  const sumPv = (s: SearchResult[], side: Side) => {
    let t = s.reduce((acc, p) => acc + pvContrib(p), 0);
    if (side === openedSide) t += usedFAs.reduce((acc, p) => acc + pvContrib(p), 0) + pvFill(theoreticalFill);
    return t;
  };
  const sumFv = (s: SearchResult[], side: Side) => {
    let t = s.reduce((acc, p) => acc + fvContrib(p), 0);
    if (side === openedSide) t += usedFAs.reduce((acc, p) => acc + fvContrib(p), 0) + fvFill(theoreticalFill);
    return t;
  };
  const pvDiff = sumPv(sideA, 'A') - sumPv(sideB, 'B');
  const fvDiff = sumFv(sideA, 'A') - sumFv(sideB, 'B');
  const edge = (d: number, unit: string) =>
    Math.abs(d) < 0.05 ? `${unit}: even` : `${unit}: ${d > 0 ? 'you get' : 'you give'} +${Math.abs(d).toFixed(1)}`;

  // ---- Overall: the single, build-agnostic dynasty asset value = ¼ Now + ¾ Keep.
  // No build lenses — Now (this season) and Keep (future seasons) ARE the win-now
  // and rebuild views, so a contender reads Now, a rebuilder reads Keep, and Overall
  // is the neutral total for everyone else. Different time windows, so blending them
  // is honest, not double-counting. ----
  const ovTitle = 'Overall — the dynasty asset value: ¼ this-season value + ¾ keeper value';
  const sumOv = (s: SearchResult[], side: Side) => {
    let t = s.reduce((acc, p) => acc + ovContrib(p), 0);
    if (side === openedSide) t += usedFAs.reduce((acc, p) => acc + ovContrib(p), 0) + (theoreticalFill * ovKeep);
    return t;
  };
  const ovA = sumOv(sideA, 'A');
  const ovB = sumOv(sideB, 'B');
  const ovDiff = ovA - ovB;

  const renderColumn = (side: Side, players: SearchResult[]) => {
    const isOpened = side === openedSide;
    const showFa = isOpened && usedFAs.length > 0;
    const showTheoretical = isOpened && theoreticalFill > 0;
    return (
    <div className="flex-1 min-w-0 rounded-lg border border-zinc-800 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-300">You {side === 'A' ? 'get' : 'give'}</span>
        <span className="text-[11px] font-bold inline-flex gap-1">
          <Tooltip text="Total this-season value on this side."><span className="text-blue-200">Now {sumPv(players, side).toFixed(1)}</span></Tooltip> ·
          <Tooltip text="Total keeper value on this side."><span className="text-fuchsia-200">Keep {sumFv(players, side).toFixed(1)}</span></Tooltip> ·
          <Tooltip text={ovTitle}><span className="text-orange-300">Overall {sumOv(players, side).toFixed(1)}</span></Tooltip>
        </span>
      </div>
      {players.length === 0 && !showFa && !showTheoretical ? (
        <p className="text-[11px] text-zinc-600 py-4 text-center">Search above, then tap <strong>+{side}</strong>.</p>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-zinc-100 truncate">{p.fullName} <span className="text-[11px] text-zinc-500">{p.primaryPosition}{metrics[p.id]?.age !== undefined ? ` · ${Math.round(metrics[p.id]!.age!)}` : ''}{p.parentOrgAbbrev ? ` · ${p.parentOrgAbbrev}` : p.sportId === 1 ? ' · MLB' : ''}</span> <span className="text-[13px] font-bold text-orange-300">Overall {ovOf(p).toFixed(1)}</span></div>
                <Chips m={metrics[p.id]} isPitcher={p.primaryPosition === 'P'} pv={pvOf(p)} fv={fvOf(p)} outlook={outlookOf(p)} pending={!loadedIds.has(p.id)} saves={savesPace[p.id]} pt={estRosPA(p)?.pa} ip={estRosIP(p)} ptBlended={estRosPA(p)?.blended} injured={Boolean(injuries[p.id])} longTermIL={seasonEnding(p)} armRisk={armRiskOf(p) !== 1} belowRepl={belowRepl(p)} elig={metrics[p.id]?.pos} repsAtRisk={repsRiskOf(p).atRisk} riskText={repsRiskOf(p).text} role={establishedRegular(p) ? undefined : roles[p.id]} cShare={catcherShares[p.id]} />
              </div>
              <button onClick={() => remove(p.id, side)} className="shrink-0 text-zinc-600 hover:text-red-400 cursor-pointer text-sm" title="Remove">✕</button>
            </div>
          ))}
          {/* Real free agents you'd add into the opened spots */}
          {showFa && usedFAs.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2 border-t border-dashed border-zinc-800 pt-2">
              <div className="min-w-0">
                <div className="text-sm text-emerald-200/90 truncate">＋ {p.fullName} <span className="text-[11px] text-zinc-500">{p.primaryPosition}{metrics[p.id]?.age !== undefined ? ` · ${Math.round(metrics[p.id]!.age!)}` : ''}{p.parentOrgAbbrev ? ` · ${p.parentOrgAbbrev}` : p.sportId === 1 ? ' · MLB' : ''} · FA add</span> <span className="text-[13px] font-bold text-orange-300">Overall {ovOf(p).toFixed(1)}</span></div>
                <Chips m={metrics[p.id]} isPitcher={p.primaryPosition === 'P'} pv={pvOf(p)} fv={fvOf(p)} outlook={outlookOf(p)} pending={!loadedIds.has(p.id)} saves={savesPace[p.id]} pt={estRosPA(p)?.pa} ip={estRosIP(p)} ptBlended={estRosPA(p)?.blended} injured={Boolean(injuries[p.id])} longTermIL={seasonEnding(p)} armRisk={armRiskOf(p) !== 1} belowRepl={belowRepl(p)} elig={metrics[p.id]?.pos} repsAtRisk={repsRiskOf(p).atRisk} riskText={repsRiskOf(p).text} role={establishedRegular(p) ? undefined : roles[p.id]} cShare={catcherShares[p.id]} />
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
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300/80">Now {pvFill(theoreticalFill).toFixed(1)}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-fuchsia-500/15 text-fuchsia-300/80">Keep {fvFill(theoreticalFill).toFixed(1)}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-300/80" title={ovTitle}>Overall {(theoreticalFill * ovKeep).toFixed(1)}</span>
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
      {ros.asOf && (
        <div className="text-center mb-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-2.5 py-0.5" title="Present value's production layer is running on rest-of-season OOPSY projections, refreshed by the daily pipeline run.">
            ● &ldquo;Now&rdquo; values use rest-of-season projections · as of {new Date(ros.asOf + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        </div>
      )}
      {/* Value Board is owner-only for now — hidden until its grades reliably
          match the Trade Checker. Non-owners only ever see the trade view. */}
      {isOwner && (
        <div className="flex justify-center mb-3">
          <div className="inline-flex rounded-md overflow-hidden border border-zinc-700">
            <button onClick={() => setTool('trade')} className={`px-3 py-1 text-xs font-medium cursor-pointer ${tool === 'trade' ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>🔀 Trade checker</button>
            <button onClick={() => setTool('board')} className={`px-3 py-1 text-xs font-medium cursor-pointer ${tool === 'board' ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>📋 Value board <span className="opacity-70">· owner</span></button>
          </div>
        </div>
      )}

      {isOwner && tool === 'board' ? (
        <>
          <div className="mb-3">
            <button onClick={() => setShowSettings((v) => !v)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer">
              ⚙ League settings — {settings.teams}-team · {settings.keepers} keepers · {settings.format.toUpperCase()} {showSettings ? '▲' : '▼'}
            </button>
          </div>
          {showSettings && <LeagueSettingsPanel settings={settings} onChange={updateSettings} />}
          <ValueBoard settings={settings} isFollowing={() => false} />
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
                  <div className="text-[11px] text-zinc-500">{r.primaryPosition} · {r.currentTeam.name}{r.parentOrgAbbrev ? <span className="text-zinc-400"> · {r.parentOrgAbbrev}</span> : ''}</div>
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
            <span className="block text-[11px] text-zinc-400 mt-0.5">Values below assume the default {settings.teams}-team · {settings.keepers}-keeper · {settings.format.toUpperCase()} league — set your real teams, keepers, format and roster slots so the values fit <em>your</em> league. {showSettings ? '' : 'Tap to open ▾'}</span>
          </button>
        )}
      </div>
      {showSettings && <LeagueSettingsPanel settings={settings} onChange={updateSettings} />}

      {/* One build-agnostic verdict. Overall (¼ Now + ¾ Keep) is the headline;
          the Now and Keeper lines let a contender or rebuilder read their own slice. */}
      {(sideA.length > 0 || sideB.length > 0) && (() => {
        const bigger = Math.max(ovA, ovB, 0.1);
        const fair = Math.abs(ovDiff) < 0.08 * bigger || Math.abs(ovDiff) < 0.5;
        const verdictColor = fair ? 'text-zinc-200' : ovDiff > 0 ? 'text-emerald-300' : 'text-rose-300';
        const verdict = fair ? 'Fair trade' : ovDiff > 0 ? `Favors you +${ovDiff.toFixed(1)}` : `Favors them +${(-ovDiff).toFixed(1)}`;
        return (
          <div className="text-center mb-4">
            <div className={`text-2xl font-bold ${verdictColor}`}>{verdict}</div>
            <div className="text-base font-semibold text-zinc-300 mt-0.5">
              <Tooltip text={ovTitle}><span>Overall <span className="text-orange-300">{ovA.toFixed(1)}</span> <span className="text-zinc-500">vs</span> <span className="text-orange-200/80">{ovB.toFixed(1)}</span></span></Tooltip>
            </div>
            {/* Read the line that fits your team: contending → Now, rebuilding → Keeper. */}
            <div className="text-[12px] mt-1.5 flex flex-wrap justify-center gap-x-4">
              <Tooltip text="Win-now value — read this if you're contending."><span className="text-blue-200/80">{edge(pvDiff, 'Now')}</span></Tooltip>
              <Tooltip text="Keeper value — read this if you're rebuilding."><span className="text-fuchsia-200/80">{edge(fvDiff, 'Keeper')}</span></Tooltip>
            </div>
          </div>
        );
      })()}

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

      <div className="mt-4">
        <button onClick={() => setShowHow((v) => !v)}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer">
          How scoring works {showHow ? '▲' : '▾'}
        </button>
        {showHow && (
          <p className="text-[11px] text-zinc-600 mt-2 leading-relaxed">
            <strong className="text-blue-300">Now</strong> is what he&apos;s worth to your lineup this season — mostly his projected production and playing time, nudged by park, injuries, and how secure his job is. <strong className="text-fuchsia-300">Keep</strong> is what he&apos;s worth held as a keeper across future seasons — so young risers sit above their Now value and aging vets below. <strong className="text-orange-300">Overall</strong> is the dynasty asset value: a blend of the two, ¼ Now + ¾ Keep. Read <strong className="text-blue-300">Now</strong> if you&apos;re contending, <strong className="text-fuchsia-300">Keep</strong> if you&apos;re rebuilding, <strong className="text-orange-300">Overall</strong> for the neutral total. A lopsided trade (say 2-for-1) frees a roster spot worth a keepable replacement (less for each extra spot — you back-fill with worse players); tap <strong className="text-emerald-300">＋FA</strong> to name the real player you&apos;d add. Still being calibrated.
          </p>
        )}
      </div>
      </>
      )}
    </div>
  );
}
