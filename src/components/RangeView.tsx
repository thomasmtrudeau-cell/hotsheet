'use client';

import { RangePlayerStats, RangeSortKey } from '@/lib/types';

interface RangeViewProps {
  stats: RangePlayerStats[]; // already filtered by group/level/position/name
  window: number;            // days, set by the active tab (15 or 30)
  sortKey: RangeSortKey;
  onSort: (k: RangeSortKey) => void;
  loading: boolean;
}

const SORT_OPTIONS: { key: RangeSortKey; label: string; group: 'hit' | 'pit' }[] = [
  { key: 'wrcPlus', label: 'wRC+', group: 'hit' },
  { key: 'ops', label: 'OPS', group: 'hit' },
  { key: 'homeRuns', label: 'HR', group: 'hit' },
  { key: 'stolenBases', label: 'SB', group: 'hit' },
  { key: 'plateAppearances', label: 'PA', group: 'hit' },
  { key: 'era', label: 'ERA', group: 'pit' },
  { key: 'strikeOuts', label: 'K', group: 'pit' },
  { key: 'inningsPitched', label: 'IP', group: 'pit' },
  { key: 'saves', label: 'SV', group: 'pit' },
];

const ASC_KEYS: RangeSortKey[] = ['era']; // lower is better
const HIT_KEYS = SORT_OPTIONS.filter((o) => o.group === 'hit').map((o) => o.key);

function ipToNum(ip?: string): number {
  if (!ip) return 0;
  const [w, f] = ip.split('.');
  return (parseInt(w, 10) || 0) + (parseInt(f, 10) || 0) / 3;
}

function sortVal(s: RangePlayerStats, key: RangeSortKey): number {
  switch (key) {
    case 'wrcPlus': return s.wrcPlus ?? -Infinity;
    case 'ops': return s.ops ? parseFloat(s.ops) : -Infinity;
    case 'homeRuns': return s.homeRuns ?? -Infinity;
    case 'stolenBases': return s.stolenBases ?? -Infinity;
    case 'plateAppearances': return s.plateAppearances ?? -Infinity;
    case 'era': return s.era ? parseFloat(s.era) : Infinity;
    case 'strikeOuts': return s.strikeOuts ?? -Infinity;
    case 'inningsPitched': return ipToNum(s.inningsPitched);
    case 'saves': return s.saves ?? -Infinity;
    default: return 0;
  }
}

function sortBy(list: RangePlayerStats[], key: RangeSortKey): RangePlayerStats[] {
  const asc = ASC_KEYS.includes(key);
  return [...list].sort((a, b) => (asc ? sortVal(a, key) - sortVal(b, key) : sortVal(b, key) - sortVal(a, key)));
}

function levelClass(sportId: number): string {
  return sportId === 1 ? 'bg-blue-500/20 text-blue-400'
    : sportId === 100 ? 'bg-red-500/20 text-red-400'
    : sportId === 101 ? 'bg-purple-500/20 text-purple-400'
    : 'bg-amber-500/20 text-amber-400';
}

// One stat cell; highlighted when it's the active sort column.
function Cell({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <span className={active ? 'text-zinc-100 font-semibold' : 'text-zinc-400'}>
      <span className="font-mono">{value}</span> <span className="text-zinc-600 text-[10px]">{label}</span>
    </span>
  );
}

function RangeRow({ s, sortKey }: { s: RangePlayerStats; sortKey: RangeSortKey }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-lg">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-zinc-100 truncate">{s.playerName}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${levelClass(s.sportId)}`}>{s.level}</span>
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          {s.position} · {s.team} · {s.gamesPlayed} G
        </div>
      </div>
      <div className="flex items-center gap-2.5 text-[11px] whitespace-nowrap flex-wrap justify-end">
        {s.isPitcher ? (
          <>
            <Cell label="IP" value={s.inningsPitched ?? '0.0'} active={sortKey === 'inningsPitched'} />
            <Cell label="ERA" value={s.era ?? '—'} active={sortKey === 'era'} />
            <Cell label="WHIP" value={s.whip ?? '—'} />
            <Cell label="K" value={`${s.strikeOuts ?? 0}`} active={sortKey === 'strikeOuts'} />
            <Cell label="SV" value={`${s.saves ?? 0}`} active={sortKey === 'saves'} />
          </>
        ) : (
          <>
            <Cell label="PA" value={`${s.plateAppearances ?? 0}`} active={sortKey === 'plateAppearances'} />
            <Cell label="wRC+" value={s.wrcPlus !== undefined ? `${s.wrcPlus}` : '—'} active={sortKey === 'wrcPlus'} />
            <Cell label="HR" value={`${s.homeRuns ?? 0}`} active={sortKey === 'homeRuns'} />
            <Cell label="SB" value={`${s.stolenBases ?? 0}`} active={sortKey === 'stolenBases'} />
            <Cell label="OPS" value={s.ops ?? '—'} active={sortKey === 'ops'} />
          </>
        )}
      </div>
    </div>
  );
}

export default function RangeView({ stats, window, sortKey, onSort, loading }: RangeViewProps) {
  const hitters = sortBy(stats.filter((s) => !s.isPitcher), HIT_KEYS.includes(sortKey) ? sortKey : 'wrcPlus');
  const pitchers = sortBy(stats.filter((s) => s.isPitcher), HIT_KEYS.includes(sortKey) ? 'era' : sortKey);

  return (
    <div>
      {/* Sort control (window is set by the active tab) */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Last {window} days · Sort</span>
          <select
            value={sortKey}
            onChange={(e) => onSort(e.target.value as RangeSortKey)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 px-2 py-1.5 cursor-pointer focus:outline-none focus:border-blue-500"
          >
            <optgroup label="Hitters">
              {SORT_OPTIONS.filter((o) => o.group === 'hit').map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Pitchers">
              {SORT_OPTIONS.filter((o) => o.group === 'pit').map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {loading && stats.length === 0 ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : stats.length === 0 ? (
        <div className="text-center py-12 text-sm text-zinc-500">
          No players with games in the last {window} days
        </div>
      ) : (
        <div className="space-y-6">
          {hitters.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Hitters <span className="ml-1 text-zinc-600 font-normal">{hitters.length}</span>
              </h2>
              <div className="space-y-1.5">
                {hitters.map((s) => <RangeRow key={s.playerId} s={s} sortKey={sortKey} />)}
              </div>
            </section>
          )}
          {pitchers.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Pitchers <span className="ml-1 text-zinc-600 font-normal">{pitchers.length}</span>
              </h2>
              <div className="space-y-1.5">
                {pitchers.map((s) => <RangeRow key={s.playerId} s={s} sortKey={sortKey} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
