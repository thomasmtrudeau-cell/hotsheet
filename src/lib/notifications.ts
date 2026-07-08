import { FollowedPlayer, DailyPlayerStats, LEVEL_LABELS, isMLBSystem } from './types';

export type NotificationType = 'il_off' | 'il_on' | 'promoted' | 'demoted' | 'team_change' | 'rehab';

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

// A player on an official rehab assignment (MLB roster status "RA") with a game
// today — the early signal before formal activation. This is the roster-derived
// flag, NOT "on the IL + has a minor-league game" (that also matches an ordinary
// injured minor-leaguer, who is not rehabbing).
export function rehabNotifications(stats: DailyPlayerStats[], date: string): HotNotification[] {
  return stats
    .filter(
      (s) =>
        s.onRehab &&
        (s.gameStatus === 'Scheduled' || s.gameStatus === 'Live' || s.gameStatus === 'Final')
    )
    .map((s) =>
      makeNotification(
        { id: s.playerId }, s.playerName, 'rehab', date,
        `Rehab game today — in action for ${s.team} (${s.level})`
      )
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
