'use client';

import { useState } from 'react';
import { Group, ALL_PLAYERS_GROUP, CALLUPS_VIEW, PROMOTIONS_VIEW, RISERS_VIEW, PROJECTIONS_VIEW } from '@/lib/types';

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

// One editable row in the Manage-lists panel: rename inline (Enter / blur saves)
// and delete, for every list at once — no need to select each first.
function ManageRow({ group, count, onRename, onDelete }: {
  group: Group; count: number; onRename: (id: string, name: string) => void; onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const save = () => {
    const n = name.trim();
    if (n && n !== group.name) onRename(group.id, n);
    else if (!n) setName(group.name); // never allow a blank name
  };
  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="flex-1 min-w-0 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
        aria-label={`Rename ${group.name}`}
      />
      <span className="text-[11px] text-zinc-500 w-8 text-right shrink-0">{count}</span>
      <button
        onClick={() => { if (window.confirm(`Delete "${group.name}"? The players stay in All Players.`)) onDelete(group.id); }}
        className="shrink-0 px-2 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer transition-colors"
        title="Delete this list"
      >
        🗑
      </button>
    </div>
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
  onImport?: () => void;
}

export default function GroupBar({
  groups, activeGroup, counts, onSelect, onCreate, onRename, onDelete, onImport,
}: GroupBarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [managing, setManaging] = useState(false);

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (name) onCreate(name);
    setNewName('');
    setCreating(false);
  };

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
      {/* Visible to everyone; non-premium users see the premium preview inside. */}
      <button
        onClick={() => onSelect(RISERS_VIEW)}
        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
          activeGroup === RISERS_VIEW ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
        }`}
        title="Prospect risers — biggest peak-WAR gains (premium)"
      >
        🚀 Risers
      </button>
      <button
        onClick={() => onSelect(PROJECTIONS_VIEW)}
        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
          activeGroup === PROJECTIONS_VIEW ? 'bg-indigo-600 text-white' : 'bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
        }`}
        title="OOPSY weekly projections (premium)"
      >
        📈 Projections
      </button>

      {creating ? (
        <form onSubmit={submitNew} className="shrink-0">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => { if (!newName.trim()) setCreating(false); }}
            placeholder="Name your list…"
            className="px-3 py-1.5 w-28 bg-zinc-800 border border-zinc-700 rounded-full text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-blue-300 bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 transition-colors cursor-pointer"
          title="Create a new named list"
        >
          + New list
        </button>
      )}

      {onImport && (
        <button
          onClick={onImport}
          className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-400 bg-zinc-800/60 border border-zinc-700 hover:text-zinc-100 hover:bg-zinc-700 transition-colors cursor-pointer"
          title="Import a fantasy roster (CBS, Fantrax, ESPN, Yahoo)"
        >
          ⬇ Import roster
        </button>
      )}
      {groups.length > 0 && (
        <button
          onClick={() => setManaging(true)}
          className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-400 bg-zinc-800/60 border border-zinc-700 hover:text-zinc-100 hover:bg-zinc-700 transition-colors cursor-pointer"
          title="Rename or delete your lists"
        >
          ⚙ Manage lists
        </button>
      )}

      {managing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setManaging(false)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl p-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-zinc-100">Manage lists</h3>
              <button
                onClick={() => setManaging(false)}
                className="text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer text-sm px-1"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mb-3">Edit a name inline (Enter to save) or delete. Deleting keeps the players in All&nbsp;Players.</p>

            {groups.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">No lists yet — create one below.</p>
            ) : (
              <div className="space-y-2 mb-3">
                {groups.map((g) => (
                  <ManageRow key={g.id} group={g} count={counts.get(g.id) ?? 0} onRename={onRename} onDelete={onDelete} />
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => { e.preventDefault(); const n = newName.trim(); if (n) { onCreate(n); setNewName(''); } }}
              className="flex gap-2 pt-3 border-t border-zinc-800"
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New list name…"
                className="flex-1 min-w-0 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
              >
                Add list
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
