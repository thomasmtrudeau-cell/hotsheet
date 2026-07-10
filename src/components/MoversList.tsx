'use client';

import { CallUp, FollowedPlayer } from '@/lib/types';

interface MoversListProps {
  items: CallUp[];
  onFollow: (player: FollowedPlayer) => void;
  isFollowing: (playerId: number) => boolean;
  loading: boolean;
  caption: string;   // e.g. "MLB call-ups in the last 7 days · tap Follow to add"
  emptyText: string; // e.g. "No MLB call-ups in the last 7 days"
  verb: string;      // "called up" | "promoted"
  showWar?: boolean; // honor the premium WAR toggle (default true)
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
  if (sportId >= 11 && sportId <= 14) return 'bg-amber-500/20 text-amber-400';
  return 'bg-zinc-500/20 text-zinc-300';
}

export default function MoversList({ items, onFollow, isFollowing, loading, caption, emptyText, verb, showWar = true }: MoversListProps) {
  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }
  if (items.length === 0) {
    return <div className="text-center py-12 text-sm text-zinc-500">{emptyText}</div>;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-zinc-500 mb-2">{caption}</p>
      {items.map((c) => {
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
                <span className="text-sm font-medium text-zinc-100 truncate">{c.fullName}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${levelBadgeClass(c.sportId)}`}>{c.level}</span>
                {following && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300" title="Already in your list">★ In your list</span>
                )}
                {showWar && c.war !== undefined && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300" title="Peak WAR">
                    {c.war.toFixed(1)} WAR
                  </span>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">
                {c.primaryPosition} · {c.currentTeam.name} · {verb} {fmtDate(c.calledUpDate)}
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
  );
}
