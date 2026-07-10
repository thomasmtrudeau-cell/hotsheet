'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
    // localStorage is shared across every account on a device. Wipe the cache
    // if it belongs to a different user before reading anything from it, so no
    // account can inherit (or be shown) another account's list.
    await store.reconcileCacheOwner();

    // Snapshot pre-account local data BEFORE any cloud fetch. The fetch helpers
    // overwrite the localStorage cache with the (possibly empty) cloud copy, so
    // reading the cache *after* fetching would wipe the very data we migrate.
    const localGroups0 = store.getCachedGroups();
    const localMemberships0 = store.getCachedMemberships();

    let cloudPlayers = await store.fetchCloudPlayers();
    if (cloudPlayers.length === 0) {
      // First login for THIS account. Only import genuine pre-auth legacy data
      // (a one-time, globally-guarded blob import) — NEVER this browser's live
      // cache, which belongs to whichever account last used the device.
      const legacy = (await store.importLegacyPlayersOnce()) ?? [];
      if (legacy.length > 0) {
        await store.bulkUpsertCloudPlayers(legacy);
        cloudPlayers = legacy;
      }
    }

    let cloudGroups = await store.fetchGroups();
    if (cloudGroups.length === 0) {
      // Only adopt local groups when they accompany a genuine legacy import
      // (i.e. this account actually took on legacy players just now). Otherwise
      // a brand-new account starts with fresh default lists.
      if (cloudPlayers.length > 0 && localGroups0.length > 0) {
        await store.bulkInsertGroups(localGroups0);
        cloudGroups = localGroups0;
      } else {
        // Brand-new account: start with the same defaults the local app seeded.
        const seeded = [
          await store.createGroup('Watch List', 0),
          await store.createGroup('My Team', 1),
        ].filter((g): g is Group => g !== null);
        cloudGroups = seeded;
      }
    }

    // Migrate local group memberships up whenever the account has none yet.
    // NOT gated on "groups migrated this load" — across multiple sign-ins the
    // groups can already exist in the cloud while memberships still don't, and
    // the old gate skipped them forever. Map each local group id to its cloud
    // id: prefer an exact UUID match (migrated groups keep their id), else fall
    // back to matching by name (re-seeded groups got fresh UUIDs).
    let cloudMemberships = await store.fetchMemberships();
    if (cloudMemberships.size === 0) {
      const localMemberships = localMemberships0;
      if (localMemberships.size > 0) {
        const cloudIds = new Set(cloudGroups.map((g) => g.id));
        const cloudIdByName = new Map(cloudGroups.map((g) => [g.name, g.id]));
        const localNameById = new Map(localGroups0.map((g) => [g.id, g.name]));
        const remapped = new Map<number, string[]>();
        localMemberships.forEach((groupIds, playerId) => {
          const mapped = groupIds
            .map((gid) => (cloudIds.has(gid) ? gid : cloudIdByName.get(localNameById.get(gid) ?? '')))
            .filter((gid): gid is string => Boolean(gid));
          if (mapped.length > 0) remapped.set(playerId, mapped);
        });
        if (remapped.size > 0) {
          await store.bulkInsertMemberships(
            remapped,
            new Set(cloudPlayers.map((p) => p.id)),
            new Set(cloudGroups.map((g) => g.id))
          );
          cloudMemberships = remapped;
        }
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
        store.clearLocalCache(); // don't leave one user's list on the device for the next
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

  // Re-check the roster periodically so promotions/demotions of followed
  // players ping you during an open session, not only on load.
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => {
    if (!loaded || players.length === 0) return;
    const id = setInterval(() => refreshAndDiff(playersRef.current), 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [loaded, players.length, refreshAndDiff]);

  // --- Player actions ---

  const follow = useCallback(async (player: FollowedPlayer, groupIds: string[] = []) => {
    const withTime = { ...player, followedAt: new Date().toISOString() };
    setPlayers((prev) => {
      if (prev.some((p) => p.id === player.id)) return prev;
      const updated = [...prev, withTime];
      store.setCachedPlayers(updated);
      return updated;
    });
    await store.upsertCloudPlayer(withTime);
    // Optionally drop the player into groups as part of adding them. The cloud
    // player row must exist first (player_groups FKs to followed_players), which
    // the awaited upsert above guarantees.
    if (groupIds.length > 0) {
      setMemberships((prev) => {
        const next = new Map(prev);
        next.set(player.id, groupIds);
        store.setCachedMemberships(next);
        return next;
      });
      await store.setPlayerGroups(player.id, groupIds);
    }
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

  // Add one group to many players at once, preserving each player's other
  // groups (union, not replace). Used by bulk-select tagging.
  const bulkAddToGroup = useCallback(async (playerIds: number[], groupId: string) => {
    const newSets = new Map<number, string[]>();
    setMemberships((prev) => {
      const next = new Map(prev);
      for (const pid of playerIds) {
        const cur = next.get(pid) ?? [];
        if (!cur.includes(groupId)) {
          const set = [...cur, groupId];
          next.set(pid, set);
          newSets.set(pid, set);
        }
      }
      store.setCachedMemberships(next);
      return next;
    });
    await Promise.all(
      Array.from(newSets.entries()).map(([pid, set]) => store.setPlayerGroups(pid, set))
    );
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
    bulkAddToGroup,
    ingestNotifications,
    markNotificationsRead,
    clearAllNotifications,
  };
}
