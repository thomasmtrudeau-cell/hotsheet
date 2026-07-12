'use client';

import { useState } from 'react';
import { SearchResult, FollowedPlayer, Group, LEVEL_LABELS } from '@/lib/types';

// Turn pasted roster text into candidate player names. Works with one-per-line
// exports from CBS / Fantrax / ESPN / Yahoo, tolerating trailing position/team
// codes and comma/tab-delimited columns. Fuzzy search resolves the rest.
function parseNames(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.split(/[\t,;|]/)[0].trim();         // first column if delimited
    line = line.replace(/\s*\([^)]*\)/g, '').trim();       // drop "(LAA)" etc.
    line = line.replace(/\s+(?:[A-Z0-9]{1,3})(?:\s+[A-Z0-9]{1,3})*$/, '').trim(); // trailing POS/TEAM
    if (line.length < 2 || !/[a-z]/i.test(line)) continue; // needs a letter
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.slice(0, 80);
}

function levelClass(sportId: number): string {
  if (sportId === 1) return 'bg-blue-500/20 text-blue-400';
  if (sportId >= 11 && sportId <= 14) return 'bg-amber-500/20 text-amber-400';
  if (sportId === 100) return 'bg-red-500/20 text-red-400';
  if (sportId === 101) return 'bg-purple-500/20 text-purple-400';
  return 'bg-zinc-500/20 text-zinc-300';
}

interface Matched { raw: string; player: SearchResult }

export default function RosterImport({ open, onClose, groups, onFollow, onCreateList }: {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  onFollow: (p: FollowedPlayer, groupIds?: string[]) => Promise<void> | void;
  onCreateList: (name: string) => Promise<Group | null>;
}) {
  const [text, setText] = useState('');
  const [matching, setMatching] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [matched, setMatched] = useState<Matched[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<string>('new');
  const [newName, setNewName] = useState('My Roster');
  const [importing, setImporting] = useState(false);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  if (!open) return null;

  const reset = () => {
    setText(''); setReviewed(false); setMatched([]); setUnmatched([]);
    setChecked(new Set()); setDoneCount(null); setImporting(false);
  };
  const close = () => { reset(); onClose(); };

  const runMatch = async () => {
    const names = parseNames(text);
    if (names.length === 0) return;
    setMatching(true);
    const results = await Promise.all(names.map(async (nm) => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(nm)}`);
        const data = await res.json();
        const top = Array.isArray(data) && data.length > 0 ? (data[0] as SearchResult) : null;
        return { raw: nm, player: top };
      } catch {
        return { raw: nm, player: null };
      }
    }));
    const byId = new Map<number, Matched>();
    for (const r of results) if (r.player && !byId.has(r.player.id)) byId.set(r.player.id, r as Matched);
    const mm = [...byId.values()];
    setMatched(mm);
    setUnmatched(results.filter((r) => !r.player).map((r) => r.raw));
    setChecked(new Set(mm.map((r) => r.player.id)));
    setReviewed(true);
    setMatching(false);
  };

  const toggle = (id: number) => setChecked((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const doImport = async () => {
    const picks = matched.filter((r) => checked.has(r.player.id));
    if (picks.length === 0) return;
    setImporting(true);
    let groupId: string | null = null;
    if (target === 'new') {
      const g = newName.trim() ? await onCreateList(newName.trim()) : null;
      groupId = g?.id ?? null;
    } else {
      groupId = target;
    }
    for (const r of picks) {
      const p = r.player;
      await onFollow({
        id: p.id, fullName: p.fullName, primaryPosition: p.primaryPosition,
        currentTeam: p.currentTeam, sportId: p.sportId, parentOrg: p.parentOrg,
        parentOrgAbbrev: p.parentOrgAbbrev, followedAt: new Date().toISOString(),
      }, groupId ? [groupId] : []);
    }
    setImporting(false);
    setDoneCount(picks.length);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl p-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-zinc-100">Import a roster</h3>
          <button onClick={close} className="text-zinc-500 hover:text-zinc-200 text-sm px-1 cursor-pointer" aria-label="Close">✕</button>
        </div>

        {doneCount !== null ? (
          <div className="py-6 text-center space-y-3">
            <div className="text-3xl">✅</div>
            <p className="text-sm text-zinc-200">Added {doneCount} player{doneCount === 1 ? '' : 's'} to your list.</p>
            <button onClick={close} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white cursor-pointer">Done</button>
          </div>
        ) : !reviewed ? (
          <>
            <p className="text-[11px] text-zinc-500 mb-2">
              Paste your roster — one player per line, from CBS, Fantrax, ESPN, Yahoo, anywhere. Extra columns (position, team) are fine.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={'Mike Trout\nBobby Witt Jr.\nPaul Skenes\n…'}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
            />
            <button
              onClick={runMatch}
              disabled={matching || parseNames(text).length === 0}
              className="mt-2 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
            >
              {matching ? 'Matching…' : `Match ${parseNames(text).length || ''} players`}
            </button>
          </>
        ) : (
          <>
            {matched.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Found ({checked.size}/{matched.length})</div>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {matched.map((r) => (
                    <button
                      key={r.player.id}
                      onClick={() => toggle(r.player.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded hover:bg-zinc-800 cursor-pointer"
                    >
                      <span className={`w-3.5 h-3.5 shrink-0 flex items-center justify-center rounded border ${checked.has(r.player.id) ? 'bg-blue-600 border-blue-600' : 'border-zinc-600'}`}>
                        {checked.has(r.player.id) && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        )}
                      </span>
                      <span className="text-xs text-zinc-100 truncate flex-1">{r.player.fullName}</span>
                      <span className="text-[10px] text-zinc-500">{r.player.primaryPosition}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${levelClass(r.player.sportId)}`}>{LEVEL_LABELS[r.player.sportId] || '?'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {unmatched.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Couldn&apos;t find ({unmatched.length})</div>
                <div className="text-[11px] text-zinc-500 leading-snug">{unmatched.join(' · ')}</div>
              </div>
            )}

            {matched.length > 0 && (
              <div className="border-t border-zinc-800 pt-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Add to</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="new">New list…</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  {target === 'new' && (
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="List name"
                      className="flex-1 min-w-0 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                    />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => setReviewed(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer">← Back</button>
                  <button
                    onClick={doImport}
                    disabled={importing || checked.size === 0 || (target === 'new' && !newName.trim())}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
                  >
                    {importing ? 'Adding…' : `Follow ${checked.size} player${checked.size === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            )}
            {matched.length === 0 && (
              <button onClick={() => setReviewed(false)} className="mt-2 w-full px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer">
                No matches — try again
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
