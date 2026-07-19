'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ViewTab, LevelFilter, DailyPlayerStats, SeasonPlayerStats, LeagueAverages, ALL_PLAYERS_GROUP, CALLUPS_VIEW, PROMOTIONS_VIEW, RISERS_VIEW, PROJECTIONS_VIEW, TRADE_VIEW, REGRESSION_VIEW, SCOUTING_VIEW, TRENDS_VIEW, RangePlayerStats, RangeSortKey, CallUp, Riser, PremiumMetrics, OopsyPitcher, OopsyHitter, RegressionRow, HitterRegressionRow, ScoutingRow, isMiLB } from '@/lib/types';
import { rehabNotifications, lineupNotifications, closerNotifications, twoStartNotifications } from '@/lib/notifications';
import { useFollowedPlayers } from '@/hooks/useFollowedPlayers';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { createClient } from '@/lib/supabase/client';
import SearchBar from '@/components/SearchBar';
import LoginScreen from '@/components/LoginScreen';
import TabNav from '@/components/TabNav';
import FilterBar from '@/components/FilterBar';
import PlayerCard from '@/components/PlayerCard';
import EmptyState from '@/components/EmptyState';
import GroupBar from '@/components/GroupBar';
import NotificationBell from '@/components/NotificationBell';
import PushToggle from '@/components/PushToggle';
import RangeView from '@/components/RangeView';
import MoversList from '@/components/MoversList';
import RisersView from '@/components/RisersView';
import PremiumTeaser from '@/components/PremiumTeaser';
import RosterImport from '@/components/RosterImport';
import ProjectionsView from '@/components/ProjectionsView';
import TradeChecker from '@/components/TradeChecker';
import RegressionView from '@/components/RegressionView';
import ScoutingView from '@/components/ScoutingView';
import TrendsView from '@/components/TrendsView';
import { TipRotator } from '@/components/Tip';

// Rotating first-run tips — one shows at a time, cycling per visit.
const TIPS: { id: string; node: React.ReactNode }[] = [
  { id: 'tip-feedback', node: <>Got an idea or found a bug? Tap <strong>💬 Feedback</strong> up top — we read everything and ship fast.</> },
  { id: 'tip-tag', node: <>Tap the <strong>🏷 tag</strong> on any card to move a player between your lists.</> },
  { id: 'tip-lineups', node: <>When MLB posts lineups, cards show <strong>STARTING</strong> (with batting order) or <strong>NOT STARTING</strong> — so you know who&apos;s actually in before first pitch.</> },
  { id: 'tip-follow', node: <>Search any player and hit <strong>Follow</strong> — use the <strong>▾</strong> to drop them straight into a list.</> },
  { id: 'tip-matchup', node: <>Tap a <strong>matchup</strong> chip (Plus / Tough) for the pitcher-quality + platoon + park breakdown.</> },
  { id: 'tip-games', node: <>Open <strong>Games ▾</strong> for a player&apos;s last 15 — and whether he&apos;s an <strong>Everyday</strong>, <strong>Platoon</strong>, or <strong>Spot</strong> starter.</> },
  { id: 'tip-movers', node: <><strong>Call-Ups</strong> &amp; <strong>Promoted</strong> show who just moved up in the last 7 days, sorted by upside.</> },
  { id: 'tip-bell', node: <>The <strong>🔔 bell</strong> flags your players&apos; call-ups, promotions, IL moves and lineup changes.</> },
  { id: 'tip-lists', node: <>Make custom lists with <strong>+ New list</strong>; rename or delete them under <strong>⚙ Manage lists</strong>.</> },
  // (NPB/KBO tip removed from the rotation — international leagues are an opt-in
  // power feature behind the 🌏 toggle, so we don't surface them to everyone. The
  // inline "season stats only" banner still explains it once a user opts in.)
];

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

// --- "Playing Today" instant-paint cache (stale-while-revalidate) ---
// The daily-stats fetch fans out to many MLB API calls, so it's the slowest part
// of a home-page load. We cache the last payload per date in localStorage and
// paint it INSTANTLY on the next visit while the fresh copy loads in the
// background, so the page feels immediate instead of blank-until-the-fan-out.
const DAILY_CACHE_PREFIX = 'hotsheet_daily_';
function readDailyCache(date: string): DailyPlayerStats[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DAILY_CACHE_PREFIX + date);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as DailyPlayerStats[]) : null;
  } catch { return null; }
}
function writeDailyCache(date: string, data: DailyPlayerStats[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DAILY_CACHE_PREFIX + date, JSON.stringify(data));
    // Keep only today's + yesterday's payloads so the cache can't grow unbounded.
    const keep = new Set([DAILY_CACHE_PREFIX + getDateString(0), DAILY_CACHE_PREFIX + getDateString(-1)]);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DAILY_CACHE_PREFIX) && !keep.has(k)) localStorage.removeItem(k);
    }
  } catch { /* quota / unavailable — cache is best-effort */ }
}

type SortableStat = DailyPlayerStats | SeasonPlayerStats;

// Lightweight name key for matching sheet/discovery names to followed players
// (mirrors war.ts normalizeName; kept local so the client bundle stays lean).
function normalizeCardName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

// For upcoming (Scheduled) games: rank the best spots to the top — strong/plus
// matchups and today's starting pitchers first, tough matchups last.
const MATCHUP_RANK: Record<string, number> = { strong: 0, plus: 1, neutral: 3, tough: 4 };
function scheduledRank(s: DailyPlayerStats): number {
  if (s.matchup?.ratingTier) return MATCHUP_RANK[s.matchup.ratingTier] ?? 3;
  if (s.lineupStatus === 'probable_pitcher') return 2; // a pitcher starting today
  return 3;
}

export default function Home() {
  const {
    user, players, groups, memberships, notifications, loaded,
    follow, unfollow, addGroup, editGroup, removeGroup, assignGroups, bulkAddToGroup,
    ingestNotifications, markNotificationsRead, clearAllNotifications,
  } = useFollowedPlayers();
  const authError = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('auth_error');
  const [activeTab, setActiveTab] = useState<ViewTab>('today');
  const [activeGroup, setActiveGroup] = useState<string>(ALL_PLAYERS_GROUP);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [positionFilter, setPositionFilter] = useState<'all' | 'hitter' | 'pitcher'>('all');
  const [nameFilter, setNameFilter] = useState('');
  // Bulk-select mode for tagging many players into a group at once.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [dailyStats, setDailyStats] = useState<DailyPlayerStats[]>([]);
  const [yesterdayStats, setYesterdayStats] = useState<DailyPlayerStats[]>([]);
  const [seasonStats, setSeasonStats] = useState<SeasonPlayerStats[]>([]);
  const [rangeData, setRangeData] = useState<Record<number, RangePlayerStats[]>>({});
  const [rangeSort, setRangeSort] = useState<RangeSortKey>('wrcPlus');
  const [premiumMap, setPremiumMap] = useState<Record<number, PremiumMetrics>>({}); // WAR + peak wRC+ / ERA-20TBF, premium only
  const [tier, setTier] = useState<string | null>(null); // 'premium' | 'free' | null = still loading
  const [showPremium, setShowPremium] = useState(true); // premium toggle (for clean screenshots)
  const [showPremiumInfo, setShowPremiumInfo] = useState(false); // teaser modal for non-premium users
  const [showImport, setShowImport] = useState(false); // roster import modal
  const [showFeedback, setShowFeedback] = useState(false); // feedback popover (no mail-app launch)
  const [callups, setCallups] = useState<CallUp[]>([]);
  const [callupsLoading, setCallupsLoading] = useState(false);
  const [promotions, setPromotions] = useState<CallUp[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(false);
  const [moversDays, setMoversDays] = useState(7); // Call-Ups/Promoted window (1–14 days)
  const [risers, setRisers] = useState<Riser[]>([]);
  const [risersWindow, setRisersWindow] = useState(7);
  const [risersLoading, setRisersLoading] = useState(false);
  const [oopsy, setOopsy] = useState<{ pitchers: OopsyPitcher[]; hitters: OopsyHitter[]; week?: string }>({ pitchers: [], hitters: [] });
  const [oopsyLoading, setOopsyLoading] = useState(false);
  const [regression, setRegression] = useState<RegressionRow[]>([]);
  const [regressionHitters, setRegressionHitters] = useState<HitterRegressionRow[]>([]);
  const [regressionLoading, setRegressionLoading] = useState(false);
  const [scouting, setScouting] = useState<ScoutingRow[]>([]);
  const [scoutingLoading, setScoutingLoading] = useState(false);
  const [leagueAvgs, setLeagueAvgs] = useState<Map<number, LeagueAverages>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadedTabs = useRef<Set<string>>(new Set());
  const playersRef = useRef(players);
  playersRef.current = players;

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setActiveGroup(ALL_PLAYERS_GROUP);
  }, []);

  // If the active group was deleted, fall back to All Players.
  useEffect(() => {
    const special = activeGroup === ALL_PLAYERS_GROUP || activeGroup === CALLUPS_VIEW || activeGroup === PROMOTIONS_VIEW || activeGroup === RISERS_VIEW || activeGroup === PROJECTIONS_VIEW || activeGroup === TRADE_VIEW || activeGroup === REGRESSION_VIEW || activeGroup === SCOUTING_VIEW || activeGroup === TRENDS_VIEW;
    if (!special && !groups.some((g) => g.id === activeGroup)) {
      setActiveGroup(ALL_PLAYERS_GROUP);
    }
  }, [groups, activeGroup]);

  // Fetch the pre-built discovery lists when their view is opened.
  useEffect(() => {
    if (activeGroup === CALLUPS_VIEW || activeGroup === PROMOTIONS_VIEW) {
      // One consolidated movers feed: MLB call-ups + MiLB level jumps.
      setCallupsLoading(true);
      Promise.all([
        fetch(`/api/callups?date=${getDateString(0)}&days=${moversDays}`).then((r) => r.json()).catch(() => []),
        fetch(`/api/promotions?date=${getDateString(0)}&days=${moversDays}`).then((r) => r.json()).catch(() => []),
      ])
        .then(([cu, pr]) => {
          setCallups(Array.isArray(cu) ? cu : []);
          setPromotions(Array.isArray(pr) ? pr : []);
        })
        .finally(() => setCallupsLoading(false));
    } else if (activeGroup === RISERS_VIEW) {
      setRisersLoading(true);
      fetch(`/api/risers?window=${risersWindow}`)
        .then((r) => r.json())
        .then((d) => setRisers(Array.isArray(d) ? d : []))
        .catch(() => setRisers([]))
        .finally(() => setRisersLoading(false));
    } else if (activeGroup === REGRESSION_VIEW) {
      setRegressionLoading(true);
      fetch('/api/regression')
        .then((r) => r.json())
        .then((d) => { setRegression(Array.isArray(d?.rows) ? d.rows : []); setRegressionHitters(Array.isArray(d?.hitters) ? d.hitters : []); })
        .catch(() => { setRegression([]); setRegressionHitters([]); })
        .finally(() => setRegressionLoading(false));
    } else if (activeGroup === SCOUTING_VIEW) {
      setScoutingLoading(true);
      fetch('/api/scouting')
        .then((r) => r.json())
        .then((d) => setScouting(Array.isArray(d?.rows) ? d.rows : []))
        .catch(() => setScouting([]))
        .finally(() => setScoutingLoading(false));
    }
  }, [activeGroup, risersWindow, moversDays]);

  // Player count per group, for the GroupBar pills.
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    m.set(ALL_PLAYERS_GROUP, players.length);
    for (const g of groups) m.set(g.id, 0);
    memberships.forEach((ids) => {
      for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    });
    return m;
  }, [players.length, groups, memberships]);

  const inActiveGroup = useCallback(
    (playerId: number) =>
      activeGroup === ALL_PLAYERS_GROUP || (memberships.get(playerId) ?? []).includes(activeGroup),
    [activeGroup, memberships]
  );

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

  const fetchDailyStats = useCallback(async (
    date: string,
    setter: (stats: DailyPlayerStats[]) => void,
    isToday = false,
  ) => {
    if (playersRef.current.length === 0) { setter([]); return; }
    // Stale-while-revalidate: paint the last cached payload for this date INSTANTLY
    // (filtered to players still followed), then refresh in the background below.
    const cached = readDailyCache(date);
    if (cached && cached.length) {
      const liveIds = new Set(playersRef.current.map((p) => p.id));
      const painted = cached.filter((s) => liveIds.has(s.playerId));
      if (painted.length) setter(painted);
    }
    try {
      const res = await fetch('/api/stats/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: playersRef.current, date }),
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setter(data);
        writeDailyCache(date, data);
        // Opportunity signals derived from today's lineup/boxscore. Only fire on the
        // FRESH response, never the cached paint above (would replay stale alerts).
        if (isToday) {
          ingestNotifications(rehabNotifications(data, date));
          ingestNotifications(lineupNotifications(data, date));
          ingestNotifications(closerNotifications(data, date));
          ingestNotifications(twoStartNotifications(data, date));
        }
      }
    } catch (e) {
      console.error('Failed to fetch daily stats:', e);
    }
  }, [ingestNotifications]);

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

  const fetchRangeStats = useCallback(async (windowDays: number) => {
    if (playersRef.current.length === 0) { setRangeData((prev) => ({ ...prev, [windowDays]: [] })); return; }
    try {
      const res = await fetch('/api/stats/range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: playersRef.current, window: windowDays, endDate: getDateString(0) }),
      });
      const data = await res.json();
      if (Array.isArray(data)) setRangeData((prev) => ({ ...prev, [windowDays]: data }));
    } catch (e) {
      console.error('Failed to fetch range stats:', e);
    }
  }, []);

  const fetchActiveTab = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'today') {
        await fetchDailyStats(getDateString(0), setDailyStats, true);
      } else if (activeTab === 'yesterday') {
        await fetchDailyStats(getDateString(-1), setYesterdayStats);
      } else if (activeTab === 'last15') {
        await fetchRangeStats(15);
      } else if (activeTab === 'last30') {
        await fetchRangeStats(30);
      } else {
        await fetchSeasonStats();
      }
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, [activeTab, fetchDailyStats, fetchSeasonStats, fetchRangeStats]);

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

  // Premium metrics (premium only): peak WAR + peak wRC+ / ERA-20TBF. Server
  // returns {} for non-premium / unconfigured, so non-premium users see none.
  useEffect(() => {
    if (!loaded || players.length === 0) { setPremiumMap({}); return; }
    fetch('/api/war', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players }),
    })
      .then((r) => r.json())
      .then((d) => setPremiumMap(d && typeof d === 'object' ? d : {}))
      .catch(() => setPremiumMap({}));
  }, [loaded, players]);

  // Referral capture: a friend's share link (?ref=HS-XXXX) sticks until checkout.
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref) localStorage.setItem('hotsheet_ref', ref.toUpperCase());
    } catch { /* ignore */ }
  }, []);

  const openBilling = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const d = await res.json();
      if (res.ok && d?.url) { window.location.href = d.url; return; }
      alert(res.status === 400 ? 'No subscription on this account (comped premium has nothing to manage).' : 'Billing portal unavailable — subscriptions may not be live yet.');
    } catch { alert('Billing portal unavailable.'); }
  }, []);
  const referFriend = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/referral');
      const d = await res.json();
      if (res.ok && d?.code) {
        const link = `${window.location.origin}/?ref=${d.code}`;
        await navigator.clipboard.writeText(link);
        alert(`Your referral link is copied!\n${link}\n\nFriends get 20% off their first payment — you get $5 off your next bill for each one who subscribes.`);
        return;
      }
      alert(res.status === 503 ? 'Referral codes open up when subscriptions go live.' : 'Could not create a referral code.');
    } catch { alert('Could not create a referral code.'); }
  }, []);

  // Who am I (tier) — so premium tabs can show a SPINNER while premium data
  // loads instead of flashing the upsell teaser at paying users.
  useEffect(() => {
    if (!loaded) return;
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => setTier(typeof d?.tier === 'string' ? d.tier : 'free'))
      .catch(() => setTier('free'));
  }, [loaded]);

  // OOPSY weekly projections loaded once for the whole app (premium), so cards
  // can show a per-player snapshot — not just the Projections tab.
  useEffect(() => {
    if (!loaded) return;
    setOopsyLoading(true);
    fetch('/api/oopsy')
      .then((r) => r.json())
      .then((d) => setOopsy({ pitchers: Array.isArray(d?.pitchers) ? d.pitchers : [], hitters: Array.isArray(d?.hitters) ? d.hitters : [], week: typeof d?.week === 'string' ? d.week : undefined }))
      .catch(() => setOopsy({ pitchers: [], hitters: [] }))
      .finally(() => setOopsyLoading(false));
  }, [loaded]);

  // OOPSY lookup by normalized name, for card snapshots.
  const oopsyByName = useMemo(() => {
    const m = new Map<string, { hitter?: OopsyHitter; pitcher?: OopsyPitcher }>();
    for (const h of oopsy.hitters) m.set(h.nameKey, { ...(m.get(h.nameKey) ?? {}), hitter: h });
    for (const p of oopsy.pitchers) m.set(p.nameKey, { ...(m.get(p.nameKey) ?? {}), pitcher: p });
    return m;
  }, [oopsy]);

  const isRange = activeTab === 'last15' || activeTab === 'last30';
  const rangeWindow = activeTab === 'last30' ? 30 : 15;
  const isCallups = activeGroup === CALLUPS_VIEW;
  const isPromotions = activeGroup === PROMOTIONS_VIEW;
  const isRisers = activeGroup === RISERS_VIEW;
  const isProjections = activeGroup === PROJECTIONS_VIEW;
  const isTrade = activeGroup === TRADE_VIEW;
  const isRegression = activeGroup === REGRESSION_VIEW;
  const isScouting = activeGroup === SCOUTING_VIEW;
  const isTrends = activeGroup === TRENDS_VIEW;
  const isDiscovery = isCallups || isPromotions || isRisers || isProjections || isTrade || isRegression || isScouting || isTrends;
  // Premium metrics only come back populated for premium accounts, so a
  // non-empty map = premium.
  const isPremium = tier === 'premium' || Object.keys(premiumMap).length > 0;
  // Owner-only gate. The Value Board is hidden from everyone but Tom until its
  // grades reliably match the Trade Checker (they diverge for now — different
  // live-layer coverage). Also enforced server-side in /api/values.
  const isOwner = (user?.email ?? '').toLowerCase() === 'thomasmtrudeau@gmail.com';
  // Tier unknown and no premium data yet — don't show the teaser to someone who
  // may well be premium; the discovery views render a spinner instead.
  const premiumPending = tier === null && Object.keys(premiumMap).length === 0;

  // Name-based "already in your list" check for discovery lists that carry no
  // player id (risers come from the WAR sheet by name only).
  const followedNameSet = useMemo(
    () => new Set(players.map((p) => normalizeCardName(p.fullName))),
    [players]
  );
  const isFollowingName = useCallback(
    (name: string) => followedNameSet.has(normalizeCardName(name)),
    [followedNameSet]
  );

  const currentStats: SortableStat[] =
    activeTab === 'today' ? dailyStats :
    activeTab === 'yesterday' ? yesterdayStats :
    activeTab === 'season' ? seasonStats :
    [];

  // Apply filters
  const filteredStats = currentStats.filter((s) => {
    if (!inActiveGroup(s.playerId)) return false;
    if (levelFilter === 'MLB' && s.sportId !== 1) return false;
    if (levelFilter === 'MiLB' && !isMiLB(s.sportId)) return false;
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
      // Status tier first (Live → Final → Scheduled). Within a status, surface
      // VALUE, not just the game clock:
      const statusDiff = statusTier(ad.gameStatus) - statusTier(bd.gameStatus);
      if (statusDiff !== 0) return statusDiff;
      if (ad.gameStatus === 'Scheduled') {
        // Upcoming: chronological by game start time (reads like a schedule);
        // matchup/starter rank only breaks ties among same-time games.
        const timeDiff = (ad.gameStartTime ?? Infinity) - (bd.gameStartTime ?? Infinity);
        if (timeDiff !== 0) return timeDiff;
        const rankDiff = scheduledRank(ad) - scheduledRank(bd);
        if (rankDiff !== 0) return rankDiff;
      } else {
        // Live/Final: best performance first (the whole point of a hot sheet).
        const gradeDiff = GRADE_ORDER.indexOf(ad.performanceGrade) - GRADE_ORDER.indexOf(bd.performanceGrade);
        if (gradeDiff !== 0) return gradeDiff;
      }
      return (ad.gameStartTime ?? Infinity) - (bd.gameStartTime ?? Infinity);
    }
    const aS = a as SeasonPlayerStats;
    const bS = b as SeasonPlayerStats;
    if (!aS.isPitcher && !bS.isPitcher) {
      const aPlus = aS.wrcPlus ?? aS.wrcPlusEst ?? aS.opsPlus ?? 0;
      const bPlus = bS.wrcPlus ?? bS.wrcPlusEst ?? bS.opsPlus ?? 0;
      return bPlus - aPlus;
    }
    if (aS.isPitcher && bS.isPitcher) return parseFloat(aS.era || '99') - parseFloat(bS.era || '99');
    return aS.isPitcher ? 1 : -1;
  });

  // Split into sections: Hitters → Pitchers → Injured (IL goes to the bottom)
  const sections: Array<{ key: string; label: string; stats: SortableStat[] }> = (() => {
    // A player on the IL is not in the lineup even when their team has a game;
    // rehab assignments (onRehab) are actually playing, so they stay in-flow.
    const isIL = (s: SortableStat) => Boolean(s.injury) && !(s as DailyPlayerStats).onRehab;

    // Season view has no "playing today" concept — keep hitters/pitchers/IL.
    if (activeTab === 'season') {
      const hitters: SortableStat[] = [];
      const pitchers: SortableStat[] = [];
      const injured: SortableStat[] = [];
      for (const s of sortedStats) {
        if (isIL(s)) injured.push(s);
        else if (s.position === 'P') pitchers.push(s);
        else hitters.push(s);
      }
      return [
        { key: 'hitters', label: 'Hitters', stats: hitters },
        { key: 'pitchers', label: 'Pitchers', stats: pitchers },
        { key: 'injured', label: 'IL', stats: injured },
      ].filter((sec) => sec.stats.length > 0);
    }

    // Daily views: Playing (MLB) → Playing (MiLB) → Not playing → IL.
    const playingMLB: SortableStat[] = [];
    const playingMiLB: SortableStat[] = [];
    const notPlaying: SortableStat[] = [];
    const injured: SortableStat[] = [];
    for (const s of sortedStats) {
      if (isIL(s)) { injured.push(s); continue; }
      const g = (s as DailyPlayerStats).gameStatus;
      const inAction = g === 'Scheduled' || g === 'Live' || g === 'Final';
      if (!inAction) { notPlaying.push(s); continue; }
      if (isMiLB(s.sportId)) playingMiLB.push(s);
      else playingMLB.push(s);
    }
    const hit = (arr: SortableStat[]) => arr.filter((x) => x.position !== 'P');
    const pit = (arr: SortableStat[]) => arr.filter((x) => x.position === 'P');
    const hp = (arr: SortableStat[]) => [...hit(arr), ...pit(arr)];
    return [
      { key: 'playing-mlb-h', label: 'Playing Today · MLB · Hitters', stats: hit(playingMLB) },
      { key: 'playing-mlb-p', label: 'Playing Today · MLB · Pitchers', stats: pit(playingMLB) },
      { key: 'playing-milb-h', label: 'Playing Today · MiLB · Hitters', stats: hit(playingMiLB) },
      { key: 'playing-milb-p', label: 'Playing Today · MiLB · Pitchers', stats: pit(playingMiLB) },
      { key: 'notplaying', label: 'Not Playing', stats: hp(notPlaying) },
      { key: 'injured', label: 'IL', stats: injured },
    ].filter((sec) => sec.stats.length > 0);
  })();

  // Range stats share the same group/level/position/name filters.
  const filteredRange = (rangeData[rangeWindow] ?? []).filter((s) => {
    if (!inActiveGroup(s.playerId)) return false;
    if (levelFilter === 'MLB' && s.sportId !== 1) return false;
    if (levelFilter === 'MiLB' && !isMiLB(s.sportId)) return false;
    if (levelFilter === 'NPB' && s.sportId !== 100) return false;
    if (levelFilter === 'KBO' && s.sportId !== 101) return false;
    if (positionFilter === 'pitcher' && s.position !== 'P') return false;
    if (positionFilter === 'hitter' && s.position === 'P') return false;
    if (nameFilter && !s.playerName.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    return true;
  });

  const toggleSelected = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkAdd = async (groupId: string) => {
    if (selectedIds.size === 0) return;
    await bulkAddToGroup(Array.from(selectedIds), groupId);
    exitSelect();
  };

  // Initial auth check still resolving.
  if (!user && !loaded) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen authError={authError} />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 mb-1">Hot Sheet</h1>
          <p className="text-sm text-zinc-500">Track live MLB & MiLB player stats</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="relative">
            <button
              onClick={() => setShowFeedback((v) => !v)}
              className="text-[11px] px-2 py-1 rounded-full border border-blue-500/40 text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 transition-colors cursor-pointer"
              title="How to reach me with feedback"
            >
              💬 Feedback
            </button>
            {showFeedback && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowFeedback(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 w-64 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl p-3 text-left">
                  <p className="text-xs font-semibold text-zinc-200 mb-1">Got an idea or a bug?</p>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Just <strong className="text-zinc-200">text me</strong>, <strong className="text-zinc-200">email me</strong>, or <strong className="text-zinc-200">DM me on WhatsApp</strong> — whatever&apos;s easiest. I read everything and ship fast.
                  </p>
                  <a
                    href="mailto:ThomasMTrudeau@gmail.com?subject=Hot%20Sheet%20feedback"
                    className="mt-2 inline-block text-[11px] text-blue-300 hover:text-blue-200 underline underline-offset-2"
                  >
                    ThomasMTrudeau@gmail.com
                  </a>
                </div>
              </>
            )}
          </div>
          {isPremium ? (
            <button
              onClick={() => setShowPremium((v) => !v)}
              className={`text-[11px] px-2 py-1 rounded-full border transition-colors cursor-pointer ${
                showPremium ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
              }`}
              title="Show/hide premium metrics — WAR, peak wRC+, ERA/20 TBF (only you can see this toggle)"
            >
              Premium {showPremium ? 'on' : 'off'}
            </button>
          ) : (
            <button
              onClick={() => setShowPremiumInfo(true)}
              className="text-[11px] px-2 py-1 rounded-full border border-amber-500/40 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors cursor-pointer"
              title="See what premium unlocks across the app"
            >
              ✨ Premium
            </button>
          )}
          <NotificationBell
            notifications={notifications}
            onOpen={markNotificationsRead}
            onClear={clearAllNotifications}
          />
          <PushToggle />
          <div className="flex flex-col items-end">
            <span className="text-xs text-zinc-500 hidden sm:block max-w-[180px] truncate">{user.email}</span>
            <div className="flex items-center gap-2">
              {isPremium && (
                <>
                  <button onClick={referFriend} title="Copy your referral link — friends get 20% off their first payment, you get $5 off your next bill per subscriber."
                    className="text-[11px] text-amber-400/80 hover:text-amber-300 transition-colors cursor-pointer">🎁 Refer</button>
                  <button onClick={openBilling} title="Manage your subscription — payment method, plan, cancel."
                    className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer">Billing</button>
                </>
              )}
              <button
                onClick={handleLogout}
                className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-3">
        <SearchBar
          onFollow={follow}
          isFollowing={(id) => players.some(p => p.id === id)}
          groups={groups}
          onCreateList={addGroup}
          memberOf={(id) => memberships.get(id) ?? []}
          onAssignGroups={assignGroups}
        />
      </div>

      <TipRotator tips={TIPS} className="mb-3" />

      {/* Groups */}
      <GroupBar
        groups={groups}
        activeGroup={activeGroup}
        counts={groupCounts}
        onSelect={setActiveGroup}
        onCreate={addGroup}
        onRename={editGroup}
        onDelete={removeGroup}
        onImport={() => setShowImport(true)}
      />

      {/* Controls — hidden in the Call-Ups view (they don't apply there) */}
      {!isDiscovery && (
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
      )}

      {/* Refresh indicator */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-zinc-600">
          {isCallups
            ? `${callups.length} recent call-up${callups.length !== 1 ? 's' : ''}`
            : isPromotions
            ? `${promotions.length} recent promotion${promotions.length !== 1 ? 's' : ''}`
            : isRisers
            ? `${risers.length} mover${risers.length !== 1 ? 's' : ''}`
            : isProjections
            ? `${oopsy.hitters.length + oopsy.pitchers.length} weekly projections${oopsy.week ? ` · week of ${oopsy.week}` : ''}`
            : isTrade
            ? 'Trade checker · experimental'
            : isRegression
            ? 'SP regression'
            : isScouting
            ? 'Scouting'
            : isTrends
            ? 'WAR Trends'
            : isRange
            ? `${filteredRange.length} player${filteredRange.length !== 1 ? 's' : ''} with games`
            : `${sortedStats.length} player${sortedStats.length !== 1 ? 's' : ''}${filteredStats.length !== currentStats.length ? ` (${currentStats.length} total)` : ''}`}
        </div>
        <div className="flex items-center gap-2">
          {groups.length > 0 && players.length > 0 && !isRange && !isDiscovery && (
            <button
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              className={`text-xs transition-colors cursor-pointer ${selectMode ? 'text-blue-400 hover:text-blue-300' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          )}
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

      {/* NPB/KBO are season-only in the app — no live/daily feed */}
      {!isDiscovery && (levelFilter === 'NPB' || levelFilter === 'KBO') && (
        <div className="mb-4 text-[11px] text-zinc-400 bg-zinc-800/40 border border-zinc-700/40 rounded-lg px-3 py-2">
          ⓘ NPB &amp; KBO show <span className="text-zinc-300">season stats only</span> — not generated live, and there are no daily game lines.
        </div>
      )}

      {/* Content */}
      {!loaded ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : isDiscovery && premiumPending ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" /></div>
      ) : isCallups || isPromotions ? (
        <MoversList
          items={[...callups, ...promotions]}
          onFollow={follow}
          isFollowing={(id) => players.some((p) => p.id === id)}
          loading={callupsLoading}
          caption={`MLB call-ups + MiLB promotions in the last ${moversDays} day${moversDays === 1 ? '' : 's'} · tap Follow to add${isPremium ? '' : ' · alphabetical — premium sorts by upside (WAR) with scouting badges'}`}
          emptyText={`No call-ups or promotions in the last ${moversDays} day${moversDays === 1 ? '' : 's'}`}
          verb="moves"
          showWar={showPremium}
          isPremium={isPremium}
          days={moversDays}
          onDays={setMoversDays}
        />
      ) : isRisers ? (
        <RisersView
          risers={showPremium ? risers : []}
          window={risersWindow}
          onWindow={setRisersWindow}
          loading={risersLoading}
          isPremium={isPremium}
          isFollowing={(name) => isFollowingName(name)}
        />
      ) : isProjections ? (
        <ProjectionsView
          pitchers={showPremium ? oopsy.pitchers : []}
          hitters={showPremium ? oopsy.hitters : []}
          week={oopsy.week}
          loading={oopsyLoading}
          isPremium={isPremium}
          isFollowing={(name) => isFollowingName(name)}
        />
      ) : isTrade ? (
        <TradeChecker isPremium={isPremium} isOwner={isOwner} />
      ) : isRegression ? (
        <RegressionView
          rows={showPremium ? regression : []}
          hitters={showPremium ? regressionHitters : []}
          loading={regressionLoading}
          isPremium={isPremium}
          isFollowing={(name) => isFollowingName(name)}
        />
      ) : isScouting ? (
        <ScoutingView
          rows={showPremium ? scouting : []}
          loading={scoutingLoading}
          isPremium={isPremium}
          isFollowing={(name) => isFollowingName(name)}
          onFollow={follow}
          groups={groups}
        />
      ) : isTrends ? (
        <TrendsView isPremium={isPremium} isFollowing={(name) => isFollowingName(name)} />
      ) : players.length === 0 ? (
        <EmptyState />
      ) : isRange ? (
        <RangeView
          stats={filteredRange}
          window={rangeWindow}
          sortKey={rangeSort}
          onSort={setRangeSort}
          loading={loading}
        />
      ) : sortedStats.length === 0 && !loading ? (
        <div className="text-center py-12 text-sm text-zinc-500">
          No players match your filters
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                {section.label}
                <span className="ml-2 text-zinc-600 font-normal normal-case">
                  {section.stats.length}
                </span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {section.stats.map((stat) => {
                  const selected = selectedIds.has(stat.playerId);
                  return (
                    <div
                      key={stat.playerId}
                      className={`relative rounded-xl ${selectMode ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-blue-500' : ''}`}
                      onClick={selectMode ? () => toggleSelected(stat.playerId) : undefined}
                    >
                      <PlayerCard
                        type={activeTab === 'season' ? 'season' : 'daily'}
                        stats={stat as DailyPlayerStats & SeasonPlayerStats}
                        onUnfollow={unfollow}
                        leagueAvg={leagueAvgs.get(stat.sportId)}
                        premium={showPremium ? premiumMap[stat.playerId] : undefined}
                        oopsy={showPremium ? oopsyByName.get(normalizeCardName(stat.playerName)) : undefined}
                        groupControl={{
                          groups,
                          memberOf: memberships.get(stat.playerId) ?? [],
                          onAssignGroups: assignGroups,
                        }}
                      />
                      {selectMode && (
                        <>
                          {/* Capture clicks so the card's own links/buttons don't fire while selecting. */}
                          <div className="absolute inset-0 z-10 rounded-xl" />
                          <span
                            className={`absolute top-2 left-2 z-20 w-5 h-5 rounded-md flex items-center justify-center border ${selected ? 'bg-blue-600 border-blue-600' : 'bg-zinc-900/80 border-zinc-600'}`}
                          >
                            {selected && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Bulk-tag action bar */}
      {selectMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-full shadow-2xl px-3 py-2 max-w-[95vw] overflow-x-auto">
          <span className="text-xs text-zinc-400 whitespace-nowrap px-1">
            {selectedIds.size} selected
          </span>
          <span className="text-zinc-600">·</span>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => handleBulkAdd(g.id)}
              disabled={selectedIds.size === 0}
              className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-blue-600 hover:bg-blue-500 text-white disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-default cursor-pointer transition-colors"
            >
              + {g.name}
            </button>
          ))}
          <button
            onClick={exitSelect}
            className="px-2.5 py-1 rounded-full text-xs text-zinc-400 hover:text-zinc-200 whitespace-nowrap cursor-pointer transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Premium preview — reachable app-wide from the header ✨ Premium button. */}
      {showPremiumInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowPremiumInfo(false)}
        >
          <div
            className="relative w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowPremiumInfo(false)}
              className="absolute top-3 right-3 z-10 text-zinc-500 hover:text-zinc-200 text-sm cursor-pointer"
              aria-label="Close"
            >
              ✕
            </button>
            <PremiumTeaser />
          </div>
        </div>
      )}

      <RosterImport
        open={showImport}
        onClose={() => setShowImport(false)}
        groups={groups}
        onFollow={follow}
        onCreateList={addGroup}
      />
    </div>
  );
}
