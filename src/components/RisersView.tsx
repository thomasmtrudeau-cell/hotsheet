'use client';

import { Riser } from '@/lib/types';
import PremiumTeaser from './PremiumTeaser';

interface RisersViewProps {
  risers: Riser[];
  window: number;
  onWindow: (w: number) => void;
  loading: boolean;
  isPremium: boolean;                         // non-premium sees the teaser instead
  isFollowing: (name: string) => boolean;     // "in your list" indicator (name match)
}

const WINDOWS = [7, 14, 30];

export default function RisersView({ risers, window, onWindow, loading, isPremium, isFollowing }: RisersViewProps) {
  // Regular users get the premium preview, not the (empty) board.
  if (!isPremium) return <PremiumTeaser />;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-xs text-zinc-500">WAR risers over the last</span>
        <div className="flex rounded-lg overflow-hidden border border-zinc-700">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => onWindow(w)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                window === w ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
        <span className="text-[11px] text-zinc-600">biggest peak-WAR gains</span>
      </div>

      {loading && risers.length === 0 ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : risers.length === 0 ? (
        <div className="text-center py-12 text-sm text-zinc-500">
          No risers yet for this window.
          <div className="text-[11px] text-zinc-600 mt-1">
            This list builds from daily WAR snapshots — the {window}-day view needs ~{window} days of history to populate.
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[11px] text-zinc-500 mb-2">Top prospect risers — biggest peak-WAR gains over the last {window} days.</p>
          {risers.map((r, i) => (
            <div
              key={`${r.name_key}-${r.is_pitcher}`}
              className="flex items-center justify-between gap-3 px-3 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-zinc-600 text-xs w-5 shrink-0 text-right">{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-zinc-100 truncate">{r.display_name}</span>
                    {r.level && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400">{r.level}</span>}
                    <span className="text-[10px] text-zinc-500">{r.is_pitcher ? 'P' : 'H'}</span>
                    {isFollowing(r.display_name) && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300" title="Already in your list">★ In your list</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                <span className="text-emerald-400 font-semibold">▲ {r.delta.toFixed(1)}</span>
                <span className="text-zinc-400">{r.war.toFixed(1)} WAR</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
