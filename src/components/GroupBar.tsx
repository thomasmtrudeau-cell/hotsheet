'use client';

import { useState } from 'react';
import { Group, ALL_PLAYERS_GROUP } from '@/lib/types';

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

  const Pill = ({ id, label }: { id: string; label: string }) => {
    const active = activeGroup === id;
    const count = counts.get(id) ?? 0;
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
  };

  const activeCustom = groups.find((g) => g.id === activeGroup);

  return (
    <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
      <Pill id={ALL_PLAYERS_GROUP} label="All Players" />
      {groups.map((g) => (
        <Pill key={g.id} id={g.id} label={g.name} />
      ))}

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
