'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { TrendIndexRow, TrendSeries } from '@/lib/types';
import PremiumTeaser from './PremiumTeaser';

interface TrendsViewProps {
  isPremium: boolean;
  isFollowing: (name: string) => boolean;
}

const PICKS_KEY = 'hotsheet_trends_picks';
const COLORS = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#fb923c'];
const keyOf = (r: { nameKey: string; isPitcher: boolean }) => `${r.nameKey}|${r.isPitcher ? 'p' : 'h'}`;

// One point per (player, calendar day): the LAST capture of the day. Intraday
// captures exist for riser detection but only add noise to a trend line.
function dailyPoints(points: { at: string; war: number }[]): { day: string; war: number }[] {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.at.slice(0, 10), p.war);
  return Array.from(byDay, ([day, war]) => ({ day, war })).sort((a, b) => a.day.localeCompare(b.day));
}

function TrendChart({ series }: { series: TrendSeries[] }) {
  // Hovered day index — a crosshair tooltip snaps to the nearest day, so the
  // exact values are readable instantly (native <title> tooltips on the tiny
  // point circles had a ~1s browser delay and a near-impossible hit target).
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const daily = series.map((s) => dailyPoints(s.points));
  const days = Array.from(new Set(daily.flat().map((p) => p.day))).sort();
  if (days.length === 0) return null;
  const byDay = daily.map((pts) => new Map(pts.map((p) => [p.day, p.war])));
  const wars = daily.flat().map((p) => p.war);
  let lo = Math.min(...wars), hi = Math.max(...wars);
  if (hi - lo < 0.5) { const mid = (hi + lo) / 2; lo = mid - 0.25; hi = mid + 0.25; } // don't zoom into noise
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;

  const W = 720, H = 260, mL = 34, mR = 10, mT = 10, mB = 22;
  const x = (day: string) => {
    const i = days.indexOf(day);
    return mL + (days.length === 1 ? 0.5 : i / (days.length - 1)) * (W - mL - mR);
  };
  const y = (v: number) => mT + (1 - (v - lo) / (hi - lo)) * (H - mT - mB);
  const fmtDay = (d: string) => `${parseInt(d.slice(5, 7), 10)}/${parseInt(d.slice(8, 10), 10)}`;
  // ~6 x labels max
  const step = Math.max(1, Math.ceil(days.length / 6));
  const yTicks = 4;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < mL - 10 || px > W - mR + 10) { setHover(null); return; }
    const t = days.length === 1 ? 0 : (px - mL) / (W - mL - mR);
    setHover(Math.max(0, Math.min(days.length - 1, Math.round(t * (days.length - 1)))));
  };

  // Tooltip rows for the hovered day (series without a capture that day drop out).
  const hoverDay = hover !== null ? days[hover] : null;
  const rows = hoverDay
    ? series
        .map((s, si) => ({ player: s.player, color: COLORS[si % COLORS.length], war: byDay[si].get(hoverDay) }))
        .filter((r): r is { player: string; color: string; war: number } => r.war !== undefined)
        .sort((a, b) => b.war - a.war)
    : [];
  const tipW = Math.min(180, Math.max(96, 44 + Math.max(0, ...rows.map((r) => r.player.length)) * 4.4));
  const tipH = 14 + rows.length * 11;
  const tipX = hoverDay && x(hoverDay) + 10 + tipW > W - mR ? x(hoverDay) - 10 - tipW : hoverDay ? x(hoverDay) + 10 : 0;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ maxHeight: 300, touchAction: 'pan-y' }}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(null)}
    >
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = lo + ((hi - lo) * i) / yTicks;
        return (
          <g key={i}>
            <line x1={mL} y1={y(v)} x2={W - mR} y2={y(v)} stroke="#27272a" strokeWidth={0.75} />
            <text x={mL - 5} y={y(v) + 2.5} textAnchor="end" className="fill-zinc-600" style={{ fontSize: 8 }}>{v.toFixed(1)}</text>
          </g>
        );
      })}
      {days.map((d, i) => (i % step === 0 || i === days.length - 1) && (
        <text key={d} x={x(d)} y={H - 8} textAnchor="middle" className="fill-zinc-600" style={{ fontSize: 8 }}>{fmtDay(d)}</text>
      ))}
      {daily.map((pts, si) => {
        const color = COLORS[si % COLORS.length];
        const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.war).toFixed(1)}`).join(' ');
        return (
          <g key={si} pointerEvents="none">
            <path d={path} fill="none" stroke={color} strokeWidth={1.75} />
            {pts.map((p) => <circle key={p.day} cx={x(p.day)} cy={y(p.war)} r={p.day === hoverDay ? 3 : 1.8} fill={color} />)}
          </g>
        );
      })}
      {hoverDay && (
        <g pointerEvents="none">
          <line x1={x(hoverDay)} y1={mT} x2={x(hoverDay)} y2={H - mB} stroke="#52525b" strokeWidth={0.75} strokeDasharray="3 2" />
          <rect x={tipX} y={mT + 2} width={tipW} height={tipH} rx={4} fill="#18181b" stroke="#3f3f46" strokeWidth={0.75} opacity={0.96} />
          <text x={tipX + 7} y={mT + 12} className="fill-zinc-400" style={{ fontSize: 8, fontWeight: 600 }}>{fmtDay(hoverDay)}</text>
          {rows.map((r, i) => (
            <g key={r.player}>
              <circle cx={tipX + 10} cy={mT + 19.5 + i * 11} r={2.2} fill={r.color} />
              <text x={tipX + 16} y={mT + 22 + i * 11} className="fill-zinc-200" style={{ fontSize: 8 }}>{r.player}</text>
              <text x={tipX + tipW - 7} y={mT + 22 + i * 11} textAnchor="end" className="fill-zinc-100" style={{ fontSize: 8, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{r.war.toFixed(2)}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

export default function TrendsView({ isPremium, isFollowing }: TrendsViewProps) {
  const [index, setIndex] = useState<TrendIndexRow[]>([]);
  const [indexLoading, setIndexLoading] = useState(false);
  const [picks, setPicks] = useState<string[]>([]); // "<nameKey>|h/p"
  const [series, setSeries] = useState<TrendSeries[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPremium) return;
    setIndexLoading(true);
    fetch('/api/trends')
      .then((r) => r.json())
      .then((d) => setIndex(Array.isArray(d?.index) ? d.index : []))
      .catch(() => setIndex([]))
      .finally(() => setIndexLoading(false));
    try {
      const raw = localStorage.getItem(PICKS_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(arr) && arr.length) setPicks(arr.slice(0, 8));
    } catch { /* ignore */ }
  }, [isPremium]);

  useEffect(() => {
    if (!isPremium || picks.length === 0) { setSeries([]); return; }
    let active = true;
    fetch(`/api/trends?players=${encodeURIComponent(picks.join(','))}`)
      .then((r) => r.json())
      .then((d) => { if (active) setSeries(Array.isArray(d?.series) ? d.series : []); })
      .catch(() => active && setSeries([]));
    try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* ignore */ }
    return () => { active = false; };
  }, [picks, isPremium]);

  const matches = useMemo(() => {
    const f = q.trim().toLowerCase();
    if (f.length < 2) return [];
    return index.filter((r) => r.player.toLowerCase().includes(f)).slice(0, 12);
  }, [index, q]);

  if (!isPremium) return <PremiumTeaser context="trends" />;

  const add = (r: TrendIndexRow) => {
    const k = keyOf(r);
    setPicks((prev) => (prev.includes(k) || prev.length >= 8 ? prev : [...prev, k]));
    setQ(''); setOpen(false);
  };
  const remove = (k: string) => setPicks((prev) => prev.filter((p) => p !== k));

  return (
    <div>
      <p className="text-[11px] text-zinc-500 mb-3">
        Peak-WAR movement across projection updates — spot risers and faders early. Hitter history runs from the first capture (Jul 12); <span className="text-zinc-400">pitcher history starts Jul 13</span> (earlier pitcher captures used a superseded WAR column and were dropped).
      </p>

      {/* Picker */}
      <div ref={boxRef} className="relative max-w-md mb-3">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => q.length >= 2 && setOpen(true)}
          placeholder={indexLoading ? 'Loading players…' : 'Add a player to the chart…'}
          className="w-full px-3 py-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
        />
        {open && matches.length > 0 && (
          <div className="absolute z-40 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
            {matches.map((r) => (
              <button key={keyOf(r)} onClick={() => add(r)} disabled={picks.includes(keyOf(r))}
                className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-zinc-700 disabled:opacity-40 cursor-pointer">
                <span className="text-zinc-100 truncate">{r.player} <span className="text-zinc-500">{r.isPitcher ? 'P' : 'H'}{r.level ? ` · ${r.level}` : ''}</span>{isFollowing(r.player) && <span className="text-blue-300"> ★</span>}</span>
                <span className="font-mono text-amber-300 shrink-0">{r.war.toFixed(1)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legend / picks */}
      {picks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {picks.map((k, i) => {
            const s = series.find((x) => keyOf(x) === k);
            const label = s?.player ?? k.split('|')[0];
            return (
              <span key={k} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 border border-zinc-700 text-zinc-200">
                <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                {label}{s && <span className="text-zinc-500">{s.isPitcher ? 'P' : 'H'}</span>}
                {s && s.points.length > 1 && (() => {
                  const d = s.points[s.points.length - 1].war - s.points[0].war;
                  return <span className={`font-mono ${d > 0.05 ? 'text-emerald-300' : d < -0.05 ? 'text-red-300' : 'text-zinc-500'}`}>{d >= 0 ? '+' : ''}{d.toFixed(1)}</span>;
                })()}
                <button onClick={() => remove(k)} className="text-zinc-500 hover:text-red-400 cursor-pointer">✕</button>
              </span>
            );
          })}
        </div>
      )}

      {picks.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-10 text-center text-sm text-zinc-500">
          Search a player above to chart his projection over time — compare up to 8.
        </div>
      ) : series.length === 0 ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-zinc-700 border-t-amber-500 rounded-full animate-spin" /></div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <TrendChart series={picks.map((k) => series.find((s) => keyOf(s) === k)).filter(Boolean) as TrendSeries[]} />
          <p className="text-[10px] text-zinc-600 mt-1">One point per day (latest capture). Peak-WAR projection from ScoutTheStatline — movement means the projection itself changed.</p>
        </div>
      )}
    </div>
  );
}
