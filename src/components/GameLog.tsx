'use client';

import { useEffect, useState } from 'react';
import { GameLogEntry } from '@/lib/types';

interface GameLogProps {
  playerId: number;
  sportId: number;
  isPitcher: boolean;
  teamId?: number; // when set, shows the team's last 15 games with DNP markers
}

function shortDate(iso: string): string {
  // "2026-06-09" -> "6/9"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

// Lazily fetches the recent game log when the card is expanded.
export default function GameLog({ playerId, sportId, isPitcher, teamId }: GameLogProps) {
  const [entries, setEntries] = useState<GameLogEntry[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mounts fresh each time the card is expanded, so initial loading=true
    // already covers the spinner (no synchronous setState needed here).
    let active = true;
    const teamParam = teamId ? `&teamId=${teamId}` : '';
    fetch(`/api/stats/gamelog?playerId=${playerId}&sportId=${sportId}&pitcher=${isPitcher ? 1 : 0}${teamParam}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setSupported(d.supported !== false);
        setEntries(d.entries ?? []);
      })
      .catch(() => active && setEntries([]))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [playerId, sportId, isPitcher, teamId]);

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

  const hasDnp = entries.some((e) => e.dnp);
  const played = entries.filter((e) => !e.dnp).length;
  const header = (hasDnp
    ? `Played ${played} of last ${entries.length} team games`
    : `Last ${entries.length} games`) + ' · current level';

  // Playing-time role from start rate (hitters only; needs the team-aware log).
  let role: { label: string; cls: string } | null = null;
  if (hasDnp && !isPitcher && entries.length >= 5) {
    const rate = played / entries.length;
    if (rate >= 0.8) role = { label: 'Everyday', cls: 'bg-green-500/20 text-green-400' };
    else if (rate >= 0.45) role = { label: 'Part-time', cls: 'bg-amber-500/20 text-amber-400' };
    else role = { label: 'Spot starter', cls: 'bg-zinc-600/40 text-zinc-300' };
  }

  return (
    <div className="mt-3 pt-3 border-t border-zinc-700/30">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">{header}</span>
        {role && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${role.cls}`} title="Start rate over the team's recent games">
            {role.label}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {entries.map((e, i) => (
          <div key={`${e.date}-${i}`} className={`flex items-baseline gap-2 text-xs ${e.dnp ? 'opacity-45' : ''}`}>
            <span className="text-zinc-500 font-mono w-9 shrink-0">{shortDate(e.date)}</span>
            <span className="text-zinc-400 w-20 shrink-0 truncate">{e.opponent}</span>
            <span className={`truncate ${e.dnp ? 'text-zinc-500 italic' : 'text-zinc-200 font-mono'}`}>{e.statLine}</span>
            {!e.dnp && e.level && e.level !== 'MLB' && (
              <span className="ml-auto text-[10px] text-amber-400/80 shrink-0">{e.level}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
