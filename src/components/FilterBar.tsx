'use client';

import { LevelFilter } from '@/lib/types';

interface FilterBarProps {
  levelFilter: LevelFilter;
  onLevelChange: (level: LevelFilter) => void;
  positionFilter: 'all' | 'hitter' | 'pitcher';
  onPositionChange: (pos: 'all' | 'hitter' | 'pitcher') => void;
  nameFilter: string;
  onNameChange: (name: string) => void;
}

const levelOptions: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All Levels' },
  { value: 'MLB', label: 'MLB' },
  { value: 'MiLB', label: 'MiLB' },
];

const positionOptions: { value: 'all' | 'hitter' | 'pitcher'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hitter', label: 'Hitters' },
  { value: 'pitcher', label: 'Pitchers' },
];

export default function FilterBar({
  levelFilter,
  onLevelChange,
  positionFilter,
  onPositionChange,
  nameFilter,
  onNameChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Level filter */}
      <div className="flex rounded-lg overflow-hidden border border-zinc-700">
        {levelOptions.map((opt) => (
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
