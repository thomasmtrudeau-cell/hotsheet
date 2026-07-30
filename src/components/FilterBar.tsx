'use client';

import { useState, useEffect } from 'react';
import { LevelFilter } from '@/lib/types';

interface FilterBarProps {
  levelFilter: LevelFilter;
  onLevelChange: (level: LevelFilter) => void;
  positionFilter: 'all' | 'hitter' | 'pitcher';
  onPositionChange: (pos: 'all' | 'hitter' | 'pitcher') => void;
  nameFilter: string;
  onNameChange: (name: string) => void;
  // Daily-view ordering. Omitted on tabs where it doesn't apply (season/range)
  // and for accounts with no WAR data to sort by.
  sortMode?: 'time' | 'war';
  onSortChange?: (mode: 'time' | 'war') => void;
}

// NPB/KBO are hidden by default — most users only care about MLB/MiLB, and the
// extra chips waste space. A 🌏 toggle reveals them (preference persists).
const coreOptions: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'MLB', label: 'MLB' },
  { value: 'MiLB', label: 'MiLB' },
];
const intlOptions: { value: LevelFilter; label: string }[] = [
  { value: 'NPB', label: 'NPB' },
  { value: 'KBO', label: 'KBO' },
];
const INTL_KEY = 'hotsheet_show_intl';

const positionOptions: { value: 'all' | 'hitter' | 'pitcher'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hitter', label: 'Hitters' },
  { value: 'pitcher', label: 'Pitchers' },
];

const sortOptions: { value: 'time' | 'war'; label: string; title: string }[] = [
  { value: 'time', label: 'Time', title: 'Order by game start time' },
  { value: 'war', label: 'WAR', title: 'Top projected WAR first' },
];

export default function FilterBar({
  levelFilter,
  onLevelChange,
  positionFilter,
  onPositionChange,
  nameFilter,
  onNameChange,
  sortMode,
  onSortChange,
}: FilterBarProps) {
  const [showIntl, setShowIntl] = useState(false);

  useEffect(() => {
    try {
      // Reveal automatically if a saved preference OR the active filter is intl.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(INTL_KEY) === '1' || levelFilter === 'NPB' || levelFilter === 'KBO') setShowIntl(true);
    } catch { /* ignore */ }
  }, [levelFilter]);

  const toggleIntl = () => {
    const next = !showIntl;
    setShowIntl(next);
    try { localStorage.setItem(INTL_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    // Don't leave the view stuck on a now-hidden league.
    if (!next && (levelFilter === 'NPB' || levelFilter === 'KBO')) onLevelChange('all');
  };

  const shown = showIntl ? [...coreOptions, ...intlOptions] : coreOptions;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Level filter */}
      <div className="flex rounded-lg overflow-hidden border border-zinc-700">
        {shown.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onLevelChange(opt.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              levelFilter === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={toggleIntl}
          title={showIntl ? 'Hide NPB & KBO' : 'Show NPB & KBO'}
          className={`px-2.5 py-1.5 text-xs transition-colors cursor-pointer border-l border-zinc-700 ${
            showIntl ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          🌏
        </button>
      </div>

      {/* Position filter */}
      <div className="flex rounded-lg overflow-hidden border border-zinc-700">
        {positionOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onPositionChange(opt.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              positionFilter === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Sort — game start time vs top projected WAR */}
      {sortMode && onSortChange && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-500">Sort</span>
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onSortChange(opt.value)}
                title={opt.title}
                className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  sortMode === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Name filter */}
      <input
        type="text"
        value={nameFilter}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Filter by name..."
        className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 w-40"
      />
    </div>
  );
}
