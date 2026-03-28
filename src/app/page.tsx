'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { ViewTab, LevelFilter, DailyPlayerStats, SeasonPlayerStats } from '@/lib/types';
import { useFollowedPlayers } from '@/hooks/useFollowedPlayers';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import SearchBar from '@/components/SearchBar';
import TabNav from '@/components/TabNav';
import FilterBar from '@/components/FilterBar';
import PlayerCard from '@/components/PlayerCard';
import EmptyState from '@/components/EmptyState';

function getDateString(offset: number = 0): string {
  const d = new Date();
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() + offset);
  return et.toISOString().split('T')[0];
}

type SortableStat = DailyPlayerStats | SeasonPlayerStats;

function statusTier(status: string): number {
  switch (status) {
    case 'Live': return 0;
    case 'Final': return 1;
    case 'Scheduled': return 2;
    case 'Postponed': return 3;
    case 'No Game': return 4;
    default: return 5;
  }
}

const GRADE_ORDER = ['milestone', 'standout', 'good', 'routine', 'off_day', 'scheduled', 'no_game'];

export default function Home() {
  const { players, loaded, follow, unfollow } = useFollowedPlayers();
  const [activeTab, setActiveTab] = useState<ViewTab>('today');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [positionFilter, setPositionFilter] = useState<'all' | 'hitter' | 'pitcher'>('all');
  const [nameFilter, setNameFilter] = useState('');

  const [dailyStats, setDailyStats] = useState<DailyPlayerStats[]>([]);
  const [yesterdayStats, setYesterdayStats] = useState<DailyPlayerStats[]>([]);
  const [seasonStats, setSeasonStats] = useState<SeasonPlayerStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadedTabs = useRef<Set<string>>(new Set());
  const playersRef = useRef(players);
  playersRef.current = players;

  const fetchDailyStats = useCallback(async (date: string, setter: (stats: DailyPlayerStats[]) => void) => {
    if (playersRef.current.length === 0) { setter([]); return; }
    try {
      const res = await fetch('/api/stats/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: playersRef.current, date }),
      });
      const data = await res.json();
      if (Array.isArray(data)) setter(data);
    } catch (e) {
      console.error('Failed to fetch daily stats:', e);
    }
  }, []);

  const fetchSeasonStats = useCallback(async () => {
    if (playersRef.current.length === 0) { setSeasonStats([]); return; }
    try {
      const res = await fetch('/api/stats/season', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: playersRef.current }),
      });
      const data = await res.json();
      if (Array.isArray(data)) setSeasonStats(data);
    } catch (e) {
      console.error('Failed to fetch season stats:', e);
    }
  }, []);

  const fetchActiveTab = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'today') {
        await fetchDailyStats(getDateString(0), setDailyStats);
      } else if (activeTab === 'yesterday') {
        await fetchDailyStats(getDateString(-1), setYesterdayStats);
      } else {
        await fetchSeasonStats();
      }
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, [activeTab, fetchDailyStats, fetchSeasonStats]);

  // Fetch when players change
  useEffect(() => {
    if (!loaded || players.length === 0) return;
    loadedTabs.current.clear();
    fetchActiveTab();
    loadedTabs.current.add(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, players]);

  // Fetch when tab changes
  useEffect(() => {
    if (!loaded || players.length === 0) return;
    if (!loadedTabs.current.has(activeTab)) {
      fetchActiveTab();
      loadedTabs.current.add(activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Auto-refresh every 5 minutes
  useAutoRefresh(fetchActiveTab, 5 * 60 * 1000, loaded && players.length > 0);

  const currentStats: SortableStat[] =
    activeTab === 'today' ? dailyStats :
    activeTab === 'yesterday' ? yesterdayStats :
    seasonStats;

  // Apply filters
  const filteredStats = currentStats.filter((s) => {
    if (levelFilter === 'MLB' && s.sportId !== 1) return false;
    if (levelFilter === 'MiLB' && s.sportId === 1) return false;
    if (positionFilter === 'pitcher' && s.position !== 'P') return false;
    if (positionFilter === 'hitter' && s.position === 'P') return false;
    if (nameFilter && !s.playerName.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    return true;
  });

  // Sort
  const sortedStats = [...filteredStats].sort((a, b) => {
    if (activeTab !== 'season') {
      const ad = a as DailyPlayerStats;
      const bd = b as DailyPlayerStats;
      const statusDiff = statusTier(ad.gameStatus) - statusTier(bd.gameStatus);
      if (statusDiff !== 0) return statusDiff;
      return GRADE_ORDER.indexOf(ad.performanceGrade) - GRADE_ORDER.indexOf(bd.performanceGrade);
    }
    const aS = a as SeasonPlayerStats;
    const bS = b as SeasonPlayerStats;
    if (!aS.isPitcher && !bS.isPitcher) return (bS.wrcPlus || 0) - (aS.wrcPlus || 0);
    if (aS.isPitcher && bS.isPitcher) return parseFloat(aS.era || '99') - parseFloat(bS.era || '99');
    return aS.isPitcher ? 1 : -1;
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100 mb-1">Hot Sheet</h1>
        <p className="text-sm text-zinc-500">Track live MLB & MiLB player stats</p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <SearchBar onFollow={follow} isFollowing={(id) => players.some(p => p.id === id)} />
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <TabNav activeTab={activeTab} onChange={setActiveTab} />
        <FilterBar
          levelFilter={levelFilter}
          onLevelChange={setLevelFilter}
          positionFilter={positionFilter}
          onPositionChange={setPositionFilter}
          nameFilter={nameFilter}
          onNameChange={setNameFilter}
        />
      </div>

      {/* Refresh indicator */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-zinc-600">
          {sortedStats.length} player{sortedStats.length !== 1 ? 's' : ''}
          {filteredStats.length !== currentStats.length && ` (${currentStats.length} total)`}
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <div className="w-3 h-3 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
          )}
          {lastRefresh && (
            <span className="text-[11px] text-zinc-600">
              Updated {lastRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={fetchActiveTab}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {!loaded ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : players.length === 0 ? (
        <EmptyState />
      ) : sortedStats.length === 0 && !loading ? (
        <div className="text-center py-12 text-sm text-zinc-500">
          No players match your filters
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sortedStats.map((stat) => (
            <PlayerCard
              key={stat.playerId}
              type={activeTab === 'season' ? 'season' : 'daily'}
              stats={stat as DailyPlayerStats & SeasonPlayerStats}
              onUnfollow={unfollow}
            />
          ))}
        </div>
      )}
    </div>
  );
}
