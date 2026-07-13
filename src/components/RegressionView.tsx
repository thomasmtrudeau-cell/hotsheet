'use client';

import { RegressionRow } from '@/lib/types';
import PremiumTeaser from './PremiumTeaser';

interface RegressionViewProps {
  sellHighs: RegressionRow[];
  buyLows: RegressionRow[];
  loading: boolean;
  isPremium: boolean;
  isFollowing: (name: string) => boolean;
}

function List({ title, subtitle, rows, tone, isFollowing }: {
  title: string; subtitle: string; rows: RegressionRow[]; tone: 'sell' | 'buy'; isFollowing: (name: string) => boolean;
}) {
  const accent = tone === 'sell' ? 'text-red-300' : 'text-emerald-300';
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-zinc-800 p-3">
      <div className={`text-sm font-semibold ${accent}`}>{title}</div>
      <div className="text-[11px] text-zinc-500 mb-2">{subtitle}</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-zinc-600 py-4 text-center">Nothing notable right now.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.nameKey} className="flex items-center justify-between gap-2 text-xs px-1 py-1">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-zinc-100 truncate">{r.player}</span>
                {r.level && r.level.toUpperCase() !== 'MLB' && <span className="text-[10px] text-amber-400/80">{r.level}</span>}
                {isFollowing(r.player) && <span className="text-[10px] text-blue-300" title="In your list">★</span>}
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap font-mono">
                <span className={accent}>{r.delta > 0 ? '+' : ''}{r.delta.toFixed(2)}</span>
                <span className="text-zinc-500">{r.currentEra20.toFixed(2)} now · {r.peakEra20.toFixed(2)} peak</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RegressionView({ sellHighs, buyLows, loading, isPremium, isFollowing }: RegressionViewProps) {
  if (!isPremium) return <PremiumTeaser />;
  if (loading && sellHighs.length === 0 && buyLows.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] text-zinc-500 mb-3">Starters whose current-year ERA/20 has drifted from their peak (true-talent) projection — the gap is the regression signal.</p>
      <div className="flex flex-col md:flex-row gap-3">
        <List title="⬆️ Sell high" subtitle="Pitching under their projection — regression up looms" rows={sellHighs} tone="sell" isFollowing={isFollowing} />
        <List title="⬇️ Buy low" subtitle="Pitching over their projection — bounce-back candidates" rows={buyLows} tone="buy" isFollowing={isFollowing} />
      </div>
    </div>
  );
}
