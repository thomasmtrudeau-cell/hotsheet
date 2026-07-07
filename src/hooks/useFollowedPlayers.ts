'use client';

import { useState, useEffect, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { FollowedPlayer, Group } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
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
  const [user, setUser] = useState<User | null>(null);
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
      store.setCachedPlayers(fresh);
      await store.bulkUpsertCloudPlayers(fresh);
      if (rosterSignature(fresh) !== rosterSignature(prev)) setPlayers(fresh);
    } catch {
      // Offline / API hiccup — diff again next load.
    }
  }, []);

  // Load everything for the signed-in user, migrating any pre-account
  // localStorage data (players, groups, memberships) up on first login.
  const loadAll = useCallback(async () => {
    let cloudPlayers = await store.fetchCloudPlayers();
    if (cloudPlayers.length === 0) {
      // First login: adopt whatever this browser already had.
      let local = store.getCachedPlayers();
      if (local.length === 0) {
        local = (await store.importLegacyPlayersOnce()) ?? [];
      }
      if (local.length > 0) {
        await store.bulkUpsertCloudPlayers(local);
        cloudPlayers = local;
      }
    }

    let cloudGroups = await store.fetchGroups();
    let migratedGroups = false;
    if (cloudGroups.length === 0) {
      const localGroups = store.getCachedGroups();
      if (localGroups.length > 0) {
        await store.bulkInsertGroups(localGroups);
        cloudGroups = localGroups;
        migratedGroups = true;
      } else {
        // Brand-new account: start with the same defaults the local app seeded.
        const seeded = [
          await store.createGroup('Watch List', 0),
          await store.createGroup('My Team', 1),
        ].filter((g): g is Group => g !== null);
        cloudGroups = seeded;
      }
    }

    let cloudMemberships = await store.fetchMemberships();
    if (cloudMemberships.size === 0 && migratedGroups) {
      // Group UUIDs were preserved, so local membership rows apply verbatim.
      const localMemberships = store.getCachedMemberships();
      if (localMemberships.size > 0) {
        await store.bulkInsertMemberships(
          localMemberships,
          new Set(cloudPlayers.map((p) => p.id)),
          new Set(cloudGroups.map((g) => g.id))
        );
        cloudMemberships = localMemberships;
      }
    }

    setPlayers(cloudPlayers);
    setGroups(cloudGroups);
    setMemberships(cloudMemberships);
    setNotifications(getNotifications());
    setLoaded(true);
    refreshAndDiff(cloudPlayers);
  }, [refreshAndDiff]);

  // Track auth state.
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let loadedForUserId: string | null = null;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      if (data.user) {
        loadedForUserId = data.user.id;
        loadAll();
      } else {
        setLoaded(true);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (nextUser) {
        // Token refreshes fire this too — only reload on an actual user change.
        if (loadedForUserId !== nextUser.id) {
          loadedForUserId = nextUser.id;
          setLoaded(false);
          loadAll();
        }
      } else {
        loadedForUserId = null;
        setPlayers([]);
        setGroups([]);
        setMemberships(new Map());
        setLoaded(true);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadAll]);

  // --- Player actions ---

  const follow = useCallback(async (player: FollowedPlayer) => {
    const withTime = { ...player, followedAt: new Date().toISOString() };
    setPlayers((prev) => {
      if (prev.some((p) => p.id === player.id)) return prev;
      const updated = [...prev, withTime];
      store.setCachedPlayers(updated);
      return updated;
    });
    await store.upsertCloudPlayer(withTime);
  }, []);

  const unfollow = useCallback(async (playerId: number) => {
    setPlayers((prev) => {
      const updated = prev.filter((p) => p.id !== playerId);
      store.setCachedPlayers(updated);
      return updated;
    });
    setMemberships((prev) => {
      const next = new Map(prev);
      next.delete(playerId);
      store.setCachedMemberships(next);
      return next;
    });
    await store.deleteCloudPlayer(playerId);
  }, []);

  const isFollowing = useCallback(
    (playerId: number) => players.some((p) => p.id === playerId),
    [players]
  );

  // --- Group actions ---

  const addGroup = useCallback(async (name: string) => {
    const group = await store.createGroup(name.trim(), groups.length);
    if (group) {
      setGroups((prev) => {
        const updated = [...prev, group];
        store.setCachedGroups(updated);
        return updated;
      });
    }
    return group;
  }, [groups.length]);

  const editGroup = useCallback(async (groupId: string, name: string) => {
    setGroups((prev) => {
      const updated = prev.map((g) => (g.id === groupId ? { ...g, name: name.trim() } : g));
      store.setCachedGroups(updated);
      return updated;
    });
    await store.renameGroup(groupId, name.trim());
  }, []);

  const removeGroup = useCallback(async (groupId: string) => {
    setGroups((prev) => {
      const updated = prev.filter((g) => g.id !== groupId);
      store.setCachedGroups(updated);
      return updated;
    });
    // Drop this group from membership state (players stay in "All").
    setMemberships((prev) => {
      const next = new Map<number, string[]>();
      prev.forEach((ids, pid) => next.set(pid, ids.filter((id) => id !== groupId)));
      store.setCachedMemberships(next);
      return next;
    });
    await store.deleteGroup(groupId);
  }, []);

  // Set exactly which groups a player belongs to.
  const assignGroups = useCallback(async (playerId: number, groupIds: string[]) => {
    setMemberships((prev) => {
      const next = new Map(prev);
      next.set(playerId, groupIds);
      store.setCachedMemberships(next);
      return next;
    });
    await store.setPlayerGroups(playerId, groupIds);
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
    user,
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
