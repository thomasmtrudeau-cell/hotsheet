'use client';

import { CallUp, FollowedPlayer } from '@/lib/types';
import Tooltip from './Tooltip';

interface MoversListProps {
  items: CallUp[];
  onFollow: (player: FollowedPlayer) => void;
  isFollowing: (playerId: number) => boolean;
  loading: boolean;
  caption: string;   // e.g. "MLB call-ups in the last 7 days · tap Follow to add"
  emptyText: string; // e.g. "No MLB call-ups in the last 7 days"
  verb: string;      // "called up" | "promoted"
  showWar?: boolean; // honor the premium metrics toggle (default true)
  isPremium?: boolean; // premium sees real numbers; everyone else a locked chip
  days?: number;              // active date window (1–14)
  onDays?: (d: number) => void;
  onOpenTrends?: (name: string) => void; // premium: click a name to chart him on Trends // change the window
}

function fmtDate(d: string): string {
  const [, m, day] = d.split('-');
  return m && day ? `${parseInt(m, 10)}/${parseInt(day, 10)}` : d;
}

// Fresh mover: called up / promoted today or yesterday (~last 48h).
function isFresh(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  const days = (Date.now() - d.getTime()) / 86_400_000;
  return days >= 0 && days <= 1.5;
}

function levelBadgeClass(sportId: number): string {
  if (sportId === 1) return 'bg-blue-500/20 text-blue-400';
  if ((sportId >= 11 && sportId <= 14) || sportId === 16) return 'bg-amber-500/20 text-amber-400';
  return 'bg-zinc-500/20 text-zinc-300';
}

export default function MoversList({ items, onFollow, isFollowing, loading, caption, emptyText, verb, showWar = true, isPremium = false, days, onDays, onOpenTrends }: MoversListProps) {
  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }
  // Group by mover date, newest date first. Premium sees WAR descending across
  // the whole day (call-ups and promotions interleaved); free users get
  // ALPHABETICAL — the ranking itself is part of the premium layer.
  const byDate = new Map<string, CallUp[]>();
  for (const c of items) {
    const k = c.calledUpDate || 'unknown';
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(c);
  }
  for (const arr of byDate.values()) {
    if (isPremium) arr.sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity));
    else arr.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  const dates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
      <p className="text-[11px] text-zinc-500">{caption}</p>
      {days !== undefined && onDays && (
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          Last <span className="font-mono font-bold text-zinc-200 w-7 text-center">{days}D</span>
          <input type="range" min={1} max={14} step={1} value={days} onChange={(e) => onDays(parseInt(e.target.value, 10))} className="accent-blue-500 w-28 cursor-pointer" />
        </label>
      )}
    </div>
  );

  if (items.length === 0) {
    return <div>{controls}<div className="text-center py-12 text-sm text-zinc-500">{emptyText}</div></div>;
  }

  return (
    <div className="space-y-1.5">
      {controls}
      {dates.map((d) => (
        <div key={d}>
          <div className="flex items-center gap-2 mt-3 mb-1.5 first:mt-0">
            <span className="text-[11px] font-semibold text-zinc-400">{fmtDate(d)}</span>
            <span className="text-[10px] text-zinc-600">{byDate.get(d)!.length} {verb}</span>
            <span className="flex-1 border-t border-zinc-800" />
          </div>
          <div className="space-y-1.5">
          {byDate.get(d)!.map((c) => {
        const following = isFollowing(c.id);
        return (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 px-3 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-lg"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {isFresh(c.calledUpDate) && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/25 text-red-300 animate-pulse">NEW</span>
                )}
                <button onClick={() => onOpenTrends?.(c.fullName)} disabled={!onOpenTrends} className="text-sm font-medium text-zinc-100 truncate text-left disabled:cursor-default cursor-pointer enabled:hover:underline decoration-zinc-500 underline-offset-2" title={onOpenTrends ? "Chart him on Trends" : undefined}>{c.fullName}</button>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${levelBadgeClass(c.sportId)}`}>{c.level}</span>
                {following && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300" title="Already in your list">★ In your list</span>
                )}
                {isPremium ? (
                  showWar && (
                    <>
                      {c.war !== undefined && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300" title="Peak WAR (ScoutTheStatline)">
                          {c.war.toFixed(1)} WAR
                        </span>
                      )}
                      {!c.isPitcher && c.peakWrcPlus !== undefined && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300" title="Peak wRC+ (ScoutTheStatline)">
                          {c.peakWrcPlus} wRC+
                        </span>
                      )}
                      {c.isPitcher && c.era20 !== undefined && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300" title="ERA per 20 TBF/game (ScoutTheStatline)">
                          {c.era20.toFixed(2)} ERA/20
                        </span>
                      )}
                      {!c.isPitcher && c.speed && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.speed === 'double-plus' ? 'bg-sky-500/30 text-sky-200' : 'bg-sky-500/20 text-sky-300'}`} title={`${c.speed === 'double-plus' ? 'Double-plus' : 'Plus'} projected speed`}>⚡ Speed{c.speed === 'double-plus' ? '++' : '+'}</span>
                      )}
                      {!c.isPitcher && c.power && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.power === 'double-plus' ? 'bg-rose-500/30 text-rose-200' : 'bg-rose-500/20 text-rose-300'}`} title={`${c.power === 'double-plus' ? 'Double-plus' : 'Plus'} projected power`}>💪 Power{c.power === 'double-plus' ? '++' : '+'}</span>
                      )}
                      {!c.isPitcher && c.dual && !(c.speed && c.power) && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.dual === 'double-plus' ? 'bg-amber-500/30 text-amber-100' : 'bg-amber-500/20 text-amber-200'}`} title="Combined power + speed (projected HR + SB)">⚡💪 {c.dual === 'double-plus' ? '40+' : '30+'}</span>
                      )}
                      {!c.isPitcher && c.def && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.def === 'double-plus' ? 'bg-green-500/30 text-green-200' : c.def === 'plus' ? 'bg-green-500/15 text-green-300' : c.def === 'double-minus' ? 'bg-red-500/30 text-red-200' : 'bg-red-500/15 text-red-300'}`} title="Projected defense">🧤 D{c.def === 'double-plus' ? '++' : c.def === 'plus' ? '+' : c.def === 'double-minus' ? '−−' : '−'}</span>
                      )}
                    </>
                  )
                ) : (
                  <Tooltip text={`Premium: WAR & ${c.primaryPosition === 'P' ? 'ERA/20 TBF' : 'peak wRC+'} from ScoutTheStatline. Tap ✨ Premium to learn more.`}>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-300/70 cursor-help">
                      🔒 WAR · {c.primaryPosition === 'P' ? 'ERA/20' : 'wRC+'}
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">
                {c.primaryPosition} · {c.currentTeam.name} · {c.sportId === 1 ? 'called up' : 'promoted'} {fmtDate(c.calledUpDate)}
              </div>
              {(c.priorLine || c.last30Line) && (
                <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                  {c.priorLine}
                  {c.priorLine && c.last30Line && <span className="text-zinc-600"> · </span>}
                  {c.last30Line && <span className="text-zinc-500">{c.last30Line}</span>}
                </div>
              )}
            </div>
            <button
              onClick={() =>
                onFollow({
                  id: c.id,
                  fullName: c.fullName,
                  primaryPosition: c.primaryPosition,
                  currentTeam: c.currentTeam,
                  sportId: c.sportId,
                  parentOrg: c.parentOrg,
                  parentOrgAbbrev: c.parentOrgAbbrev,
                  followedAt: new Date().toISOString(),
                })
              }
              disabled={following}
              className={`shrink-0 px-3 py-1 rounded text-xs font-medium transition-colors ${
                following ? 'bg-zinc-700 text-zinc-500 cursor-default' : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
              }`}
            >
              {following ? 'Following' : 'Follow'}
            </button>
          </div>
        );
      })}
          </div>
        </div>
      ))}
    </div>
  );
}
