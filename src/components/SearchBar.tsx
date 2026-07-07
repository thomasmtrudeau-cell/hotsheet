'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { SearchResult, LEVEL_LABELS, FollowedPlayer } from '@/lib/types';

interface SearchBarProps {
  onFollow: (player: FollowedPlayer) => void;
  isFollowing: (playerId: number) => boolean;
}

export default function SearchBar({ onFollow, isFollowing }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  const handleFollow = (result: SearchResult) => {
    onFollow({
      id: result.id,
      fullName: result.fullName,
      primaryPosition: result.primaryPosition,
      currentTeam: result.currentTeam,
      sportId: result.sportId,
      parentOrg: result.parentOrg,
      parentOrgAbbrev: result.parentOrgAbbrev,
      followedAt: new Date().toISOString(),
    });
  };

  return (
    <div ref={wrapperRef} className="relative w-full max-w-xl mx-auto">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => query.length >= 2 && setOpen(true)}
          placeholder="Search any player — partial names & typos OK"
          className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/80 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-zinc-600 border-t-blue-500 rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && (query.length >= 2) && (
        <div className="absolute z-50 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-80 overflow-y-auto">
          {results.length === 0 && !loading && (
            <div className="px-4 py-3 text-sm text-zinc-500">No players found</div>
          )}
          {results.map((r) => {
            const following = isFollowing(r.id);
            return (
              <div
                key={r.id}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-zinc-700/50 border-b border-zinc-700/50 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-100 truncate">{r.fullName}</div>
                  <div className="text-xs text-zinc-400">
                    {r.primaryPosition} &middot; {r.currentTeam.name}
                    {r.parentOrg && <span className="text-zinc-500"> ({r.parentOrg})</span>}
                    <span className={`ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      r.sportId === 1 ? 'bg-blue-500/20 text-blue-400'
                        : r.sportId === 100 ? 'bg-red-500/20 text-red-400'
                        : r.sportId === 101 ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {LEVEL_LABELS[r.sportId] || 'Unknown'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleFollow(r)}
                  disabled={following}
                  className={`ml-3 px-3 py-1 rounded text-xs font-medium transition-colors ${
                    following
                      ? 'bg-zinc-700 text-zinc-500 cursor-default'
                      : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                  }`}
                >
                  {following ? 'Following' : 'Follow'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
