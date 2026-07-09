'use client';

import { useState } from 'react';
import { Group, ALL_PLAYERS_GROUP, CALLUPS_VIEW, PROMOTIONS_VIEW } from '@/lib/types';

function Pill({ id, label, active, count, onSelect }: {
  id: string; label: string; active: boolean; count: number; onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
        active ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
      }`}
    >
      {label}
      <span className={`ml-1.5 ${active ? 'text-blue-200' : 'text-zinc-600'}`}>{count}</span>
    </button>
  );
}

interface GroupBarProps {
  groups: Group[];
  activeGroup: string;
  counts: Map<string, number>;
  onSelect: (groupId: string) => void;
  onCreate: (name: string) => void;
  onRename: (groupId: string, name: string) => void;
  onDelete: (groupId: string) => void;
}

export default function GroupBar({
  groups, activeGroup, counts, onSelect, onCreate, onRename, onDelete,
}: GroupBarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (name) onCreate(name);
    setNewName('');
    setCreating(false);
  };

  const activeCustom = groups.find((g) => g.id === activeGroup);

  return (
    <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
      <Pill id={ALL_PLAYERS_GROUP} label="All Players" active={activeGroup === ALL_PLAYERS_GROUP} count={counts.get(ALL_PLAYERS_GROUP) ?? 0} onSelect={onSelect} />
      {groups.map((g) => (
        <Pill key={g.id} id={g.id} label={g.name} active={activeGroup === g.id} count={counts.get(g.id) ?? 0} onSelect={onSelect} />
      ))}

      {/* Pre-built discovery list — recent MLB call-ups (not a group). */}
      <button
        onClick={() => onSelect(CALLUPS_VIEW)}
        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
          activeGroup === CALLUPS_VIEW ? 'bg-sky-600 text-white' : 'bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
        }`}
        title="MLB players called up in the last 7 days"
      >
        🆕 Call-Ups
      </button>
      <button
        onClick={() => onSelect(PROMOTIONS_VIEW)}
        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
          activeGroup === PROMOTIONS_VIEW ? 'bg-amber-600 text-white' : 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
        }`}
        title="MiLB players promoted a level in the last 7 days"
      >
        ⬆️ Promoted
      </button>

      {creating ? (
        <form onSubmit={submitNew} className="shrink-0">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => { if (!newName.trim()) setCreating(false); }}
            placeholder="Group name"
            className="px-3 py-1.5 w-28 bg-zinc-800 border border-zinc-700 rounded-full text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-700 hover:border-zinc-600 transition-colors cursor-pointer"
        >
          + New group
        </button>
      )}

      {activeCustom && (
        <div className="shrink-0 flex items-center gap-2 ml-1">
          <button
            onClick={() => {
              const name = window.prompt('Rename group', activeCustom.name);
              if (name && name.trim()) onRename(activeCustom.id, name.trim());
            }}
            className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
          >
            Rename
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete the "${activeCustom.name}" group? Players stay in All Players.`)) {
                onDelete(activeCustom.id);
              }
            }}
            className="text-[11px] text-zinc-600 hover:text-red-400 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
