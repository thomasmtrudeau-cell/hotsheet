'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { ViewTab, LevelFilter, DailyPlayerStats, SeasonPlayerStats, LeagueAverages } from '@/lib/types';
import { useFollowedPlayers } from '@/hooks/useFollowedPlayers';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { getUsername, setUsername, clearUsername } from '@/lib/storage';
import SearchBar from '@/components/SearchBar';
import TabNav from '@/components/TabNav';
import FilterBar from '@/components/FilterBar';
import PlayerCard from '@/components/PlayerCard';
import EmptyState from '@/components/EmptyState';
import LoginScreen from '@/components/LoginScreen';

function getDateString(offset: number = 0): string {
  const d = new Date();
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() + offset);
  // Format from local components — NOT toISOString() which converts to UTC
  const year = et.getFullYear();
  const month = String(et.getMonth() + 1).padStart(2, '0');
  const day = String(et.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const { players, loaded, follow, unfollow, reload } = useFollowedPlayers();
  const [username, setUsernameState] = useState<string | null>(null);
  const [userChecked, setUserChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>('today');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [positionFilter, setPositionFilter] = useState<'all' | 'hitter' | 'pitcher'>('all');
  const [nameFilter, setNameFilter] = useState('');

  const [dailyStats, setDailyStats] = useState<DailyPlayerStats[]>([]);
  const [yesterdayStats, setYesterdayStats] = useState<DailyPlayerStats[]>([]);
  const [seasonStats, setSeasonStats] = useState<SeasonPlayerStats[]>([]);
  const [leagueAvgs, setLeagueAvgs] = useState<Map<number, LeagueAverages>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadedTabs = useRef<Set<string>>(new Set());
  const playersRef = useRef(players);
  playersRef.current = players;

  // Check if user is logged in
  useEffect(() => {
    const stored = getUsername();
    setUsernameState(stored);
    setUserChecked(true);
  }, []);

  const handleLogin = useCallback((name: string) => {
    setUsername(name);
    setUsernameState(name);
    reload();
  }, [reload]);

  const handleLogout = useCallback(() => {
    clearUsername();
    setUsernameState(null);
  }, []);

  // Fetch league averages once
  useEffect(() => {
    fetch('/api/league-averages')
      .then(res => res.json())
      .then((data: LeagueAverages[]) => {
        if (Array.isArray(data)) {
          const map = new Map<number, LeagueAverages>();
          for (const avg of data) map.set(avg.sportId, avg);
          setLeagueAvgs(map);
        }
      })
      .catch(() => {});
  }, []);

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
    if (levelFilter === 'MiLB' && !(s.sportId >= 11 && s.sportId <= 14)) return false;
    if (levelFilter === 'NPB' && s.sportId !== 100) return false;
    if (levelFilter === 'KBO' && s.sportId !== 101) return false;
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
      // Push DNP pitchers to the bottom (non-starting SP, pitchers who never entered)
      const aDnpPitcher = ad.position === 'P' && ad.statLine === 'DNP';
      const bDnpPitcher = bd.position === 'P' && bd.statLine === 'DNP';
      if (aDnpPitcher !== bDnpPitcher) return aDnpPitcher ? 1 : -1;
      // Sort by status tier (Live first), then by game start time, then grade
      const statusDiff = statusTier(ad.gameStatus) - statusTier(bd.gameStatus);
      if (statusDiff !== 0) return statusDiff;
      const aTime = ad.gameStartTime ?? Infinity;
      const bTime = bd.gameStartTime ?? Infinity;
      if (aTime !== bTime) return aTime - bTime;
      return GRADE_ORDER.indexOf(ad.performanceGrade) - GRADE_ORDER.indexOf(bd.performanceGrade);
    }
    const aS = a as SeasonPlayerStats;
    const bS = b as SeasonPlayerStats;
    if (!aS.isPitcher && !bS.isPitcher) {
      const aPlus = aS.wrcPlus ?? aS.opsPlus ?? 0;
      const bPlus = bS.wrcPlus ?? bS.opsPlus ?? 0;
      return bPlus - aPlus;
    }
    if (aS.isPitcher && bS.isPitcher) return parseFloat(aS.era || '99') - parseFloat(bS.era || '99');
    return aS.isPitcher ? 1 : -1;
  });

  if (!userChecked) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!username) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 mb-1">Hot Sheet</h1>
          <p className="text-sm text-zinc-500">Track live MLB, MiLB, NPB & KBO player stats</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{username}</span>
          <button
            onClick={handleLogout}
            className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
          >
            Log out
          </button>
        </div>
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
              leagueAvg={leagueAvgs.get(stat.sportId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
