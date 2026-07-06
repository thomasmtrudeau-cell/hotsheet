'use client';

import { SeasonLevelLine } from '@/lib/types';

// Per-level season breakdown for players who appeared at multiple levels.
// Rate stats are shown per level — never blended.
export default function LevelBreakdown({ lines }: { lines: SeasonLevelLine[] }) {
  const isPitcher = lines[0]?.isPitcher;

  return (
    <div className="mt-3 pt-3 border-t border-zinc-700/30">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">By level</div>
      <div className="space-y-1">
        {lines.map((l) => (
          <div key={l.sportId} className="flex items-center gap-3 text-xs">
            <span className="w-12 shrink-0 font-semibold text-zinc-300">{l.level}</span>
            {isPitcher ? (
              <>
                <span className="text-zinc-500 w-14 shrink-0">{l.inningsPitched} IP</span>
                <span className="text-zinc-200 font-mono">{l.era} ERA</span>
                <span className="text-zinc-500 font-mono">{l.whip} WHIP</span>
              </>
            ) : (
              <>
                <span className="text-zinc-500 w-12 shrink-0">{l.plateAppearances} PA</span>
                <span className="text-zinc-200 font-mono">{l.avg}/{l.obp}/{l.slg}</span>
                <span className="ml-auto font-mono text-zinc-300">
                  {l.wrcPlus ?? l.wrcPlusEst ?? '—'}
                  <span className="text-[9px] text-zinc-500 ml-0.5">{l.wrcPlus !== undefined ? 'wRC+' : 'wRC+*'}</span>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
