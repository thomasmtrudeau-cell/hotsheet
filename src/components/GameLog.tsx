'use client';

import { useEffect, useState } from 'react';
import { GameLogEntry } from '@/lib/types';

interface GameLogProps {
  playerId: number;
  sportId: number;
  isPitcher: boolean;
}

function shortDate(iso: string): string {
  // "2026-06-09" -> "6/9"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

// Lazily fetches the last ~10 games for a player when the card is expanded.
export default function GameLog({ playerId, sportId, isPitcher }: GameLogProps) {
  const [entries, setEntries] = useState<GameLogEntry[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/stats/gamelog?playerId=${playerId}&sportId=${sportId}&pitcher=${isPitcher ? 1 : 0}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setSupported(d.supported !== false);
        setEntries(d.entries ?? []);
      })
      .catch(() => active && setEntries([]))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [playerId, sportId, isPitcher]);

  if (loading) {
    return (
      <div className="mt-3 pt-3 border-t border-zinc-700/30 flex justify-center py-2">
        <div className="w-4 h-4 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="mt-3 pt-3 border-t border-zinc-700/30 text-[11px] text-zinc-500">
        Game logs aren&apos;t available for this league.
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="mt-3 pt-3 border-t border-zinc-700/30 text-[11px] text-zinc-500">
        No recent games this season.
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-zinc-700/30">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Last {entries.length} games</div>
      <div className="space-y-1">
        {entries.map((e, i) => (
          <div key={`${e.date}-${i}`} className="flex items-baseline gap-2 text-xs">
            <span className="text-zinc-500 font-mono w-9 shrink-0">{shortDate(e.date)}</span>
            <span className="text-zinc-400 w-20 shrink-0 truncate">{e.opponent}</span>
            <span className="text-zinc-200 font-mono truncate">{e.statLine}</span>
            {e.level && e.level !== 'MLB' && (
              <span className="ml-auto text-[10px] text-amber-400/80 shrink-0">{e.level}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
