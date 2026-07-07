'use client';

import { useState, useEffect, useCallback } from 'react';
import { FollowedPlayer, Group } from '@/lib/types';
import * as store from '@/lib/storage';
import {
  HotNotification,
  diffPlayer,
  getNotifications,
  addNotifications,
  markAllNotificationsRead,
  clearNotifications,
} from '@/lib/notifications';

// Signature of the fields whose changes matter (level, team, IL status) —
// used to skip state updates (and the stat refetch they trigger) when a
// background refresh comes back identical.
function rosterSignature(players: FollowedPlayer[]): string {
  return players
    .map((p) => `${p.id}:${p.sportId}:${p.currentTeam.id}:${p.injury?.code ?? ''}`)
    .sort()
    .join('|');
}

export function useFollowedPlayers() {
  const [players, setPlayers] = useState<FollowedPlayer[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  // playerId -> groupIds[]
  const [memberships, setMemberships] = useState<Map<number, string[]>>(new Map());
  const [notifications, setNotifications] = useState<HotNotification[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Re-hydrate players from the MLB API and turn any changes (promotion,
  // demotion, IL on/off, team change) into notifications.
  const refreshAndDiff = useCallback(async (prev: FollowedPlayer[]) => {
    if (prev.length === 0) return;
    try {
      const res = await fetch('/api/players/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: prev }),
      });
      if (!res.ok) return;
      const fresh = (await res.json()) as FollowedPlayer[];
      if (!Array.isArray(fresh) || fresh.length !== prev.length) return;

      const prevById = new Map(prev.map((p) => [p.id, p]));
      const events = fresh.flatMap((next) => {
        const old = prevById.get(next.id);
        return old ? diffPlayer(old, next) : [];
      });
      if (events.length > 0) setNotifications(addNotifications(events));

      // Persist the refreshed copies so the next visit diffs against these.
      store.setPlayers(fresh);
      if (rosterSignature(fresh) !== rosterSignature(prev)) setPlayers(fresh);
    } catch {
      // Offline / API hiccup — diff again next load.
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      let loadedPlayers = store.getPlayers();
      if (loadedPlayers.length === 0) {
        const imported = await store.importLegacyPlayersOnce();
        if (imported) loadedPlayers = imported;
      }
      if (!active) return;
      setPlayers(loadedPlayers);
      setGroups(store.seedDefaultGroupsOnce());
      setMemberships(store.getMemberships());
      setNotifications(getNotifications());
      setLoaded(true);
      refreshAndDiff(loadedPlayers);
    })();
    return () => {
      active = false;
    };
  }, [refreshAndDiff]);

  // --- Player actions ---

  const follow = useCallback((player: FollowedPlayer) => {
    setPlayers((prev) => {
      if (prev.some((p) => p.id === player.id)) return prev;
      const updated = [...prev, { ...player, followedAt: new Date().toISOString() }];
      store.setPlayers(updated);
      return updated;
    });
  }, []);

  const unfollow = useCallback((playerId: number) => {
    setPlayers((prev) => {
      const updated = prev.filter((p) => p.id !== playerId);
      store.setPlayers(updated);
      return updated;
    });
    setMemberships((prev) => {
      const next = new Map(prev);
      next.delete(playerId);
      store.setMemberships(next);
      return next;
    });
  }, []);

  const isFollowing = useCallback(
    (playerId: number) => players.some((p) => p.id === playerId),
    [players]
  );

  // --- Group actions ---

  const addGroup = useCallback((name: string) => {
    const group: Group = { id: crypto.randomUUID(), name: name.trim(), sortOrder: 0 };
    setGroups((prev) => {
      const updated = [...prev, { ...group, sortOrder: prev.length }];
      store.setGroups(updated);
      return updated;
    });
    return group;
  }, []);

  const editGroup = useCallback((groupId: string, name: string) => {
    setGroups((prev) => {
      const updated = prev.map((g) => (g.id === groupId ? { ...g, name: name.trim() } : g));
      store.setGroups(updated);
      return updated;
    });
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setGroups((prev) => {
      const updated = prev.filter((g) => g.id !== groupId);
      store.setGroups(updated);
      return updated;
    });
    // Drop this group from membership state (players stay in "All").
    setMemberships((prev) => {
      const next = new Map<number, string[]>();
      prev.forEach((ids, pid) => next.set(pid, ids.filter((id) => id !== groupId)));
      store.setMemberships(next);
      return next;
    });
  }, []);

  // Set exactly which groups a player belongs to.
  const assignGroups = useCallback((playerId: number, groupIds: string[]) => {
    setMemberships((prev) => {
      const next = new Map(prev);
      next.set(playerId, groupIds);
      store.setMemberships(next);
      return next;
    });
  }, []);

  // --- Notification actions ---

  // Lets the page feed in events generated elsewhere (e.g. rehab games
  // detected in the daily stats).
  const ingestNotifications = useCallback((events: HotNotification[]) => {
    if (events.length > 0) setNotifications(addNotifications(events));
  }, []);

  const markNotificationsRead = useCallback(() => {
    setNotifications(markAllNotificationsRead());
  }, []);

  const clearAllNotifications = useCallback(() => {
    clearNotifications();
    setNotifications([]);
  }, []);

  return {
    players,
    groups,
    memberships,
    notifications,
    loaded,
    follow,
    unfollow,
    isFollowing,
    addGroup,
    editGroup,
    removeGroup,
    assignGroups,
    ingestNotifications,
    markNotificationsRead,
    clearAllNotifications,
  };
}
