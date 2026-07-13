import { FollowedPlayer, DailyPlayerStats, LEVEL_LABELS, isMLBSystem } from './types';

export type NotificationType = 'il_off' | 'il_on' | 'promoted' | 'demoted' | 'team_change' | 'rehab' | 'lineup_spot' | 'save' | 'two_start';

export interface HotNotification {
  id: string;
  key: string; // dedupe key — same key within the window means same event
  playerId: number;
  playerName: string;
  type: NotificationType;
  message: string;
  createdAt: string;
  read: boolean;
}

const NOTIFICATIONS_KEY = 'hotsheet_notifications';
const MAX_STORED = 50;
const DEDUPE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const NOTIFICATION_STYLE: Record<NotificationType, { emoji: string; color: string }> = {
  il_off: { emoji: '🟢', color: 'text-green-400' },
  il_on: { emoji: '🚑', color: 'text-red-400' },
  promoted: { emoji: '⬆️', color: 'text-blue-400' },
  demoted: { emoji: '⬇️', color: 'text-amber-400' },
  team_change: { emoji: '🔁', color: 'text-purple-400' },
  rehab: { emoji: '🩹', color: 'text-teal-400' },
  lineup_spot: { emoji: '📋', color: 'text-cyan-400' },
  save: { emoji: '🔒', color: 'text-indigo-400' },
  two_start: { emoji: '🗓️', color: 'text-indigo-300' },
};

// Distance from the majors: MLB highest, Single-A lowest.
const LEVEL_RANK: Record<number, number> = { 1: 5, 11: 4, 12: 3, 13: 2, 14: 1 };

function makeNotification(
  player: { id: number; fullName?: string },
  playerName: string,
  type: NotificationType,
  keySuffix: string,
  message: string
): HotNotification {
  return {
    id: crypto.randomUUID(),
    key: `${player.id}:${type}:${keySuffix}`,
    playerId: player.id,
    playerName,
    type,
    message,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

// Compare a player's stored state against a freshly hydrated one and emit
// the roster-move / IL events in between. MLB-system players only —
// NPB/KBO data has no team-id or injury signal.
export function diffPlayer(prev: FollowedPlayer, next: FollowedPlayer): HotNotification[] {
  if (!isMLBSystem(prev.sportId) || !isMLBSystem(next.sportId)) return [];
  const out: HotNotification[] = [];
  const name = next.fullName || prev.fullName;

  const prevRank = LEVEL_RANK[prev.sportId] ?? 0;
  const nextRank = LEVEL_RANK[next.sportId] ?? 0;
  const levelLabel = LEVEL_LABELS[next.sportId] ?? '?';

  if (prevRank && nextRank && prevRank !== nextRank) {
    if (nextRank > prevRank) {
      const msg =
        next.sportId === 1
          ? `Called up to the majors — ${next.currentTeam.name}`
          : `Promoted to ${levelLabel} — ${next.currentTeam.name}`;
      out.push(makeNotification(next, name, 'promoted', `${next.sportId}:${next.currentTeam.id}`, msg));
    } else {
      const msg =
        prev.sportId === 1
          ? `Sent down to ${levelLabel} — ${next.currentTeam.name}`
          : `Demoted to ${levelLabel} — ${next.currentTeam.name}`;
      out.push(makeNotification(next, name, 'demoted', `${next.sportId}:${next.currentTeam.id}`, msg));
    }
  } else if (prev.currentTeam.id !== next.currentTeam.id) {
    // Same level, new team — trade or affiliate reassignment.
    const orgNote =
      next.parentOrgAbbrev && next.parentOrgAbbrev !== prev.parentOrgAbbrev
        ? ` (${next.parentOrgAbbrev} org)`
        : '';
    out.push(
      makeNotification(
        next, name, 'team_change', `${next.currentTeam.id}`,
        `Now with ${next.currentTeam.name}${orgNote} — was ${prev.currentTeam.name}`
      )
    );
  }

  if (prev.injury && !next.injury) {
    out.push(
      makeNotification(
        next, name, 'il_off', prev.injury.code,
        `Activated from the ${prev.injury.label}`
      )
    );
  } else if (!prev.injury && next.injury) {
    const note = next.injury.note ? ` — ${next.injury.note}` : '';
    out.push(
      makeNotification(
        next, name, 'il_on', next.injury.code,
        `Placed on the ${next.injury.label}${note}`
      )
    );
  }

  return out;
}

// Is a rehabbing player CONFIRMED to actually take the field today? A team
// having a game isn't enough — a rehab pitcher may be on the affiliate's roster
// while heading to the majors (Grayson Rodriguez), and a rehab hitter may sit.
// So we require a real confirmation: pitchers must be the announced probable
// (or have already pitched); hitters must be in the posted lineup (or have
// already batted). No confirmation → no notification.
function rehabInActionConfirmed(s: DailyPlayerStats): boolean {
  const isPitcher = s.position === 'P';
  if (s.gameStatus === 'Live' || s.gameStatus === 'Final') {
    // Trust the boxscore: did they actually appear?
    return isPitcher ? s.inningsPitched !== undefined : s.atBats !== undefined;
  }
  if (s.gameStatus === 'Scheduled') {
    if (isPitcher) return s.lineupStatus === 'probable_pitcher';
    return (
      s.lineupStatus === 'starting' ||
      s.battingOrder !== undefined ||
      (s.startingPosition !== undefined && s.startingPosition !== '')
    );
  }
  return false;
}

// A player on an official rehab assignment (MLB roster status "RA") who is
// CONFIRMED in today's game — the early signal before formal activation. This
// is the roster-derived flag (NOT "on the IL + has a minor-league game", which
// also matches an ordinary injured minor-leaguer), gated on real lineup/probable
// confirmation so it never fires for a rehab guy who isn't actually playing.
export function rehabNotifications(stats: DailyPlayerStats[], date: string): HotNotification[] {
  return stats
    .filter((s) => s.onRehab && rehabInActionConfirmed(s))
    .map((s) => {
      const scheduled = s.gameStatus === 'Scheduled';
      const msg = s.position === 'P'
        ? `Rehab start today — ${scheduled ? 'probable' : 'pitching'} for ${s.team} (${s.level})`
        : `Rehab game today — in the lineup for ${s.team} (${s.level})`;
      return makeNotification({ id: s.playerId }, s.playerName, 'rehab', date, msg);
    });
}

// --- Opportunity signals (derived from the daily lineup/boxscore) ---

const LINEUP_KEY = 'hotsheet_last_lineup'; // { [playerId]: lastKnownBattingOrder }

function ordinal(n: number): string {
  // Floor defensively: MLB encodes the batting spot as e.g. "901" (9th) and an
  // older build stored the /100 value unfloored (9.01), which would render as
  // "9.01th". Flooring here renders any such value cleanly.
  n = Math.floor(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getLastLineup(): Record<number, number> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LINEUP_KEY) || '{}');
  } catch {
    return {};
  }
}

// Batting-order movement: fires when a player climbs into the top of the order
// or jumps 3+ spots (either direction). Low-noise — small wiggles at the top
// (1↔2) don't alert, and a player who bats the same spot never re-fires because
// we only compare against the last KNOWN order and persist it each run.
export function lineupNotifications(stats: DailyPlayerStats[], date: string): HotNotification[] {
  if (typeof window === 'undefined') return [];
  const last = getLastLineup();
  const next: Record<number, number> = { ...last };
  const out: HotNotification[] = [];

  for (const s of stats) {
    const order = s.battingOrder;
    if (!order || !isMLBSystem(s.sportId)) continue;
    const prev = last[s.playerId];
    next[s.playerId] = order;
    if (prev === undefined || order === prev) continue;

    if (order <= 2 && prev > 2) {
      out.push(makeNotification({ id: s.playerId }, s.playerName, 'lineup_spot', `${date}:top${order}`,
        `Batting ${ordinal(order)} today — up from ${ordinal(prev)}`));
    } else if (prev - order >= 3) {
      out.push(makeNotification({ id: s.playerId }, s.playerName, 'lineup_spot', `${date}:up${order}`,
        `Moved up to ${ordinal(order)} in the order (was ${ordinal(prev)})`));
    } else if (order - prev >= 3) {
      out.push(makeNotification({ id: s.playerId }, s.playerName, 'lineup_spot', `${date}:down${order}`,
        `Dropped to ${ordinal(order)} in the order (was ${ordinal(prev)})`));
    }
  }

  try {
    localStorage.setItem(LINEUP_KEY, JSON.stringify(next));
  } catch {
    // storage full / unavailable — skip persistence, alerts still returned
  }
  return out;
}

// Two-start week: a followed SP lined up for 2+ starts NEXT fantasy week.
// Keyed by next week's Monday so it fires once per week per pitcher, not daily.
export function twoStartNotifications(stats: DailyPlayerStats[], date: string): HotNotification[] {
  const d = new Date(date + 'T00:00:00Z');
  const nextMonday = new Date(d);
  nextMonday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7);
  const weekKey = nextMonday.toISOString().slice(0, 10);
  const fmt = (s: string) => {
    const [, m, day] = s.split('-');
    return `${parseInt(m, 10)}/${parseInt(day, 10)}`;
  };
  return stats
    .filter((s) => (s.twoStartDates?.length ?? 0) >= 2)
    .map((s) =>
      makeNotification({ id: s.playerId }, s.playerName, 'two_start', weekKey,
        `Two-start week ahead — starts ${s.twoStartDates!.map(fmt).join(' & ')}`)
    );
}

// Closer usage: a pitcher who recorded a save today. One per player per day.
export function closerNotifications(stats: DailyPlayerStats[], date: string): HotNotification[] {
  return stats
    .filter((s) => (s.saves ?? 0) > 0)
    .map((s) =>
      makeNotification({ id: s.playerId }, s.playerName, 'save', date,
        `Recorded a save${(s.saves ?? 0) > 1 ? ` (${s.saves})` : ''} — ${s.team}`)
    );
}

// --- localStorage persistence ---

export function getNotifications(): HotNotification[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveNotifications(items: HotNotification[]): void {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(items.slice(0, MAX_STORED)));
}

// Prepends new notifications, skipping any whose dedupe key already fired
// within the window. Returns the updated stored list.
export function addNotifications(items: HotNotification[]): HotNotification[] {
  const existing = getNotifications();
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  const recentKeys = new Set(
    existing.filter((n) => new Date(n.createdAt).getTime() > cutoff).map((n) => n.key)
  );
  const fresh = items.filter((n) => {
    if (recentKeys.has(n.key)) return false;
    recentKeys.add(n.key); // also dedupe within this batch
    return true;
  });
  if (fresh.length === 0) return existing;
  const updated = [...fresh, ...existing];
  saveNotifications(updated);
  return updated.slice(0, MAX_STORED);
}

export function markAllNotificationsRead(): HotNotification[] {
  const updated = getNotifications().map((n) => (n.read ? n : { ...n, read: true }));
  saveNotifications(updated);
  return updated;
}

export function clearNotifications(): void {
  saveNotifications([]);
}
