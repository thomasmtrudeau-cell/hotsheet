'use client';

import { useState } from 'react';
import { ProspectRanks, MetricRank } from '@/lib/types';

// "More info" prospect ranks: a small collapsed chip that expands to where the
// player sits in the ScoutTheStatline projection universe, per headline metric
// (hitters: peak WAR / wRC+ / combined HR+SB among all projected hitters;
// pitchers: peak WAR / ERA-20 among all projected pitchers). Premium-only by
// construction — ranks only exist on premium payloads, and this renders
// nothing without them. Used on player cards, Trade Checker chips, and
// Scouting rows; the expanded line is `basis-full`, so inside any flex-wrap
// row it drops onto its own line instead of stretching the chip row.
export default function RanksToggle({ ranks, isPitcher, compact = false }: { ranks?: ProspectRanks; isPitcher: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!ranks) return null;
  const entries: Array<[string, MetricRank | undefined]> = isPitcher
    ? [['WAR', ranks.war], ['ERA/20', ranks.era]]
    : [['WAR', ranks.war], ['wRC+', ranks.wrc], ['HR+SB', ranks.hrSb]];
  if (!entries.some(([, r]) => r)) return null;
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
          open ? 'bg-amber-500/15 text-amber-200' : 'bg-zinc-700/50 text-zinc-400 hover:text-zinc-200'
        }`}
        title={`Rank in the ScoutTheStatline projection universe, among all projected ${isPitcher ? 'pitchers (ERA/20: 1 = lowest)' : 'hitters'}`}
      >
        #{open ? '▴' : '▾'}
      </button>
      {open && (
        <span className={`basis-full flex flex-wrap items-center gap-x-3 gap-y-0.5 ${compact ? 'text-[10px]' : 'text-[11px]'} mt-0.5`}>
          {entries.map(([label, r]) => r && (
            <span key={label} className="whitespace-nowrap">
              <span className="text-zinc-500">{label}</span>{' '}
              <span className="font-mono font-semibold text-amber-200">#{r.r.toLocaleString()}</span>
              <span className="text-zinc-600">/{r.of.toLocaleString()}</span>
            </span>
          ))}
          <span className="text-zinc-600">StS {isPitcher ? 'pitchers' : 'hitters'}</span>
        </span>
      )}
    </>
  );
}
