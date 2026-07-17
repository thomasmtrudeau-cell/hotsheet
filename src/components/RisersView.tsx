'use client';

import { useState } from 'react';
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
const WAR_FLOORS = [
  { label: 'All', val: 0 },
  { label: '1+ WAR', val: 1 },
  { label: '2+ WAR', val: 2 },
];

export default function RisersView({ risers, window, onWindow, loading, isPremium, isFollowing }: RisersViewProps) {
  // Default to 2+ WAR — climbers below that are rarely worth acting on.
  const [minWar, setMinWar] = useState(2);
  // Regular users get the premium preview, not the (empty) board.
  if (!isPremium) return <PremiumTeaser context="risers" />;

  // `risers` now carries movers in BOTH directions (delta sign). Split them.
  const up = risers.filter((r) => r.delta > 0 && r.war >= minWar);
  const down = risers.filter((r) => r.delta < 0 && r.war >= minWar).sort((a, b) => a.delta - b.delta);
  const hasAny = up.length > 0 || down.length > 0;

  const renderRow = (r: Riser, i: number, faller: boolean) => (
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
        <span className={faller ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold'}>{faller ? '▼' : '▲'} {Math.abs(r.delta).toFixed(1)}</span>
        <span className="text-zinc-400">{r.war.toFixed(1)} WAR</span>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-xs text-zinc-500">WAR movers over the last</span>
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
        <div className="flex rounded-lg overflow-hidden border border-zinc-700">
          {WAR_FLOORS.map((f) => (
            <button
              key={f.val}
              onClick={() => setMinWar(f.val)}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                minWar === f.val ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && risers.length === 0 ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : !hasAny ? (
        <div className="text-center py-12 text-sm text-zinc-500">
          {risers.length === 0 ? 'No movers yet for this window.' : `No movers at ${minWar}+ WAR — lower the filter to see more.`}
          {risers.length === 0 && (
            <div className="text-[11px] text-zinc-600 mt-1">
              Movers build from WAR snapshots taken a few times a day — this fills in once there are two captures with a change between them.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {up.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-emerald-400/90 mb-1">▲ Risers — biggest peak-WAR gains over the last {window} days{minWar > 0 ? `, ${minWar}+ WAR` : ''}</p>
              {up.map((r, i) => renderRow(r, i, false))}
            </div>
          )}
          {down.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-red-400/90 mb-1">▼ Fallers — biggest peak-WAR drops over the last {window} days{minWar > 0 ? `, ${minWar}+ WAR` : ''}</p>
              {down.map((r, i) => renderRow(r, i, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
