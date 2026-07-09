'use client';

import { CallUp, FollowedPlayer } from '@/lib/types';

interface CallUpsListProps {
  callups: CallUp[];
  onFollow: (player: FollowedPlayer) => void;
  isFollowing: (playerId: number) => boolean;
  loading: boolean;
}

function fmtDate(d: string): string {
  const [, m, day] = d.split('-');
  return m && day ? `${parseInt(m, 10)}/${parseInt(day, 10)}` : d;
}

export default function CallUpsList({ callups, onFollow, isFollowing, loading }: CallUpsListProps) {
  if (loading && callups.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }
  if (callups.length === 0) {
    return <div className="text-center py-12 text-sm text-zinc-500">No MLB call-ups in the last 7 days</div>;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-zinc-500 mb-2">MLB call-ups in the last 7 days · tap Follow to add</p>
      {callups.map((c) => {
        const following = isFollowing(c.id);
        return (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 px-3 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-lg"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-zinc-100 truncate">{c.fullName}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-400">MLB</span>
              </div>
              <div className="text-[11px] text-zinc-500 truncate">
                {c.primaryPosition} · {c.currentTeam.name} · called up {fmtDate(c.calledUpDate)}
              </div>
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
