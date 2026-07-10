'use client';

import { useEffect, useRef, useState } from 'react';
import { Group } from '@/lib/types';

interface GroupTagProps {
  playerId: number;
  groups: Group[];
  memberOf: string[];
  onChange: (playerId: number, groupIds: string[]) => void;
}

// Small per-player control to tag a player into one or more custom groups.
export default function GroupTag({ playerId, groups, memberOf, onChange }: GroupTagProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (groups.length === 0) return null; // no custom groups → nothing to assign

  const toggle = (groupId: string) => {
    const next = memberOf.includes(groupId)
      ? memberOf.filter((id) => id !== groupId)
      : [...memberOf, groupId];
    onChange(playerId, next);
  };

  const count = memberOf.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`transition-colors p-1 cursor-pointer ${count > 0 ? 'text-blue-400 hover:text-blue-300' : 'text-amber-400/80 hover:text-amber-300'}`}
        title="Add to lists"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.41.59l7 7a2 2 0 010 2.82l-5 5a2 2 0 01-2.82 0l-7-7A2 2 0 014 7V4a1 1 0 011-1z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">Lists</div>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => toggle(g.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-700/50 cursor-pointer"
            >
              <span className={`w-3.5 h-3.5 flex items-center justify-center rounded border ${memberOf.includes(g.id) ? 'bg-blue-600 border-blue-600' : 'border-zinc-600'}`}>
                {memberOf.includes(g.id) && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <span className="truncate">{g.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
