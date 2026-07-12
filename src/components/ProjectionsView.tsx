'use client';

import { useState, useMemo } from 'react';
import { OopsyPitcher, OopsyHitter } from '@/lib/types';
import PremiumTeaser from './PremiumTeaser';

interface ProjectionsViewProps {
  pitchers: OopsyPitcher[];
  hitters: OopsyHitter[];
  loading: boolean;
  isPremium: boolean;
  isFollowing: (name: string) => boolean; // "in your list" name match
}

type PitchKey = 'rank' | 'era';
type HitKey = 'rank' | 'wrcPlus' | 'fantasyZ' | 'projPA';

function Th({ label, active, onClick, className = '' }: { label: string; active?: boolean; onClick?: () => void; className?: string }) {
  return (
    <th
      onClick={onClick}
      className={`px-2 py-1.5 text-left text-[10px] uppercase tracking-wider ${onClick ? 'cursor-pointer hover:text-zinc-200' : ''} ${active ? 'text-blue-300' : 'text-zinc-500'} ${className}`}
    >
      {label}{active ? ' ↓' : ''}
    </th>
  );
}

export default function ProjectionsView({ pitchers, hitters, loading, isPremium, isFollowing }: ProjectionsViewProps) {
  const [side, setSide] = useState<'hitting' | 'pitching'>('hitting');
  const [q, setQ] = useState('');
  const [hitSort, setHitSort] = useState<HitKey>('rank');
  const [pitchSort, setPitchSort] = useState<PitchKey>('rank');

  const filteredHitters = useMemo(() => {
    const f = q.trim().toLowerCase();
    const arr = f ? hitters.filter((h) => h.player.toLowerCase().includes(f)) : hitters;
    const dir = hitSort === 'rank' ? 1 : -1; // rank asc, metrics desc
    return [...arr].sort((a, b) => {
      const av = (a[hitSort] ?? (hitSort === 'rank' ? 9999 : -9999)) as number;
      const bv = (b[hitSort] ?? (hitSort === 'rank' ? 9999 : -9999)) as number;
      return (av - bv) * dir;
    });
  }, [hitters, q, hitSort]);

  const filteredPitchers = useMemo(() => {
    const f = q.trim().toLowerCase();
    const arr = f ? pitchers.filter((p) => p.player.toLowerCase().includes(f)) : pitchers;
    return [...arr].sort((a, b) => (pitchSort === 'era' ? a.era - b.era : a.rank - b.rank));
  }, [pitchers, q, pitchSort]);

  if (!isPremium) return <PremiumTeaser />;

  if (loading && pitchers.length === 0 && hitters.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex rounded-lg overflow-hidden border border-zinc-700">
          {(['hitting', 'pitching'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors cursor-pointer ${side === s ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name…"
          className="flex-1 min-w-[140px] max-w-xs px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
        />
        <span className="text-[11px] text-zinc-600">OOPSY weekly projections · premium</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        {side === 'hitting' ? (
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60">
              <tr>
                <Th label="Rank" active={hitSort === 'rank'} onClick={() => setHitSort('rank')} />
                <Th label="Player" />
                <Th label="Fantasy" active={hitSort === 'fantasyZ'} onClick={() => setHitSort('fantasyZ')} />
                <Th label="wRC+" active={hitSort === 'wrcPlus'} onClick={() => setHitSort('wrcPlus')} />
                <Th label="PA" active={hitSort === 'projPA'} onClick={() => setHitSort('projPA')} />
                <Th label="G" />
              </tr>
            </thead>
            <tbody>
              {filteredHitters.map((h) => (
                <tr key={h.nameKey} className="border-t border-zinc-800/60 hover:bg-zinc-800/30">
                  <td className="px-2 py-1.5 text-zinc-500 tabular-nums">{h.rank}</td>
                  <td className="px-2 py-1.5 text-zinc-100">
                    {h.player}
                    {isFollowing(h.player) && <span className="ml-1.5 text-[10px] text-blue-300" title="In your list">★</span>}
                  </td>
                  <td className="px-2 py-1.5 text-emerald-300 tabular-nums">{h.fantasyZ?.toFixed(2) ?? '—'}</td>
                  <td className="px-2 py-1.5 text-zinc-300 tabular-nums">{h.wrcPlus?.toFixed(2) ?? '—'}</td>
                  <td className="px-2 py-1.5 text-zinc-400 tabular-nums">{h.projPA?.toFixed(1) ?? '—'}</td>
                  <td className="px-2 py-1.5 text-zinc-500 tabular-nums">{h.projGames ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60">
              <tr>
                <Th label="Rank" active={pitchSort === 'rank'} onClick={() => setPitchSort('rank')} />
                <Th label="Pitcher" />
                <Th label="ERA" active={pitchSort === 'era'} onClick={() => setPitchSort('era')} />
                <Th label="Day" />
                <Th label="Opp" />
                <Th label="Park" />
              </tr>
            </thead>
            <tbody>
              {filteredPitchers.map((p) => (
                <tr key={p.nameKey} className="border-t border-zinc-800/60 hover:bg-zinc-800/30">
                  <td className="px-2 py-1.5 text-zinc-500 tabular-nums">{p.rank}</td>
                  <td className="px-2 py-1.5 text-zinc-100">
                    {p.player}
                    {isFollowing(p.player) && <span className="ml-1.5 text-[10px] text-blue-300" title="In your list">★</span>}
                  </td>
                  <td className="px-2 py-1.5 text-emerald-300 tabular-nums">{p.era.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-zinc-400">{p.day}</td>
                  <td className="px-2 py-1.5 text-zinc-300">{p.opponent}</td>
                  <td className="px-2 py-1.5 text-zinc-500">{p.park}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
