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
// Key-order-insensitive stringify, for change detection against rows that
// round-tripped through Postgres jsonb (which sorts object keys).
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val
  );
}

function rosterSignature(players: FollowedPlayer[]): string {
  return players
    .map((p) => `${p.id}:${p.sportId}:${p.currentTeam.id}:${p.injury?.code ?? ''}`)
    .sort()
    .join('|');
}

export function useFollowedPlayers() {
  const [user, setUser] = useState<User | null>(null);
  const [players, setPlayers] = useState<FollowedPlayer[]>([]);
  // Always-current mirror of `players`, so an in-flight background refresh can
  // reconcile against the LIVE roster when it resolves (not the stale snapshot it
  // started with) — otherwise a delete made mid-refresh gets silently undone.
  const playersRef = useRef<FollowedPlayer[]>(players);
  // Player ids deleted this session. A slow page-load refresh can resolve AFTER a
  // quick delete and re-upsert the player from the stale roster snapshot it
  // started with (the mobile "deleted player comes back" bug). Tombstoning the id
  // makes every refresh permanently skip it — for the local merge AND the cloud
  // upsert — until the player is explicitly re-followed.
  const deletedIdsRef = useRef<Set<number>>(new Set());
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
        // Only diff against a fully-hydrated baseline. A just-followed player's
        // stored record came from search — no injury data, and often his parent-org
        // team rather than his current rehab affiliate — so its FIRST hydration
        // would fire pre-existing conditions ("placed on IL", "affiliate move") as
        // fake new alerts. Seed silently on first hydration; diff from then on.
        return old?.baselined ? diffPlayer(old, next) : [];
      });
      if (events.length > 0) setNotifications(addNotifications(events));

      // Persist the refreshed copies (now marked baselined) so future refreshes
      // diff. CRITICAL: reconcile against the LIVE roster (playersRef), not the
      // `prev` snapshot this refresh started with. A player deleted while this was
      // in flight is no longer live, so we must NOT re-cache, re-upsert, or re-add
      // him — otherwise the delete silently comes back (the mobile bug: slow
      // network widens the race between page-load's refresh and a quick delete).
      const deleted = deletedIdsRef.current;
      const baselined = fresh.map((p) => ({ ...p, baselined: true }));
      const freshById = new Map(baselined.map((p) => [p.id, p]));
      // Drop tombstoned ids from the live snapshot too — even if the ref hasn't
      // caught up with a just-fired delete, a deleted player is never re-surfaced.
      const live = playersRef.current.filter((p) => !deleted.has(p.id));
      const liveIds = new Set(live.map((p) => p.id));
      const merged = live.map((p) => freshById.get(p.id) ?? p); // update in place; drop nothing, add nothing
      store.setCachedPlayers(merged);
      // Persist refreshed rows UPDATE-only (an upsert would re-insert a player
      // deleted from another device — the classic "he came back" bug), and only
      // rows whose data actually changed (stable-key compare: cloud jsonb
      // reorders keys, so a naive stringify would flag every row every time).
      const changed = baselined.filter((p) => {
        if (!liveIds.has(p.id) || deleted.has(p.id)) return false;
        return stableJson(p) !== stableJson(prevById.get(p.id));
      });
      await store.bulkUpdateCloudPlayers(changed);
      if (rosterSignature(merged) !== rosterSignature(playersRef.current)) {
        setPlayers((cur) => cur.filter((p) => !deleted.has(p.id)).map((p) => freshById.get(p.id) ?? p));
      }
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

    // Replay deletes that never reached the cloud (mobile kills backgrounded
    // tabs mid-request) and tombstone them for this whole session, so neither
    // the cached paint nor the cloud fetch below can show them again.
    const pendingDeletes = await store.flushPendingDeletes();
    pendingDeletes.forEach((id) => deletedIdsRef.current.add(id));

    // Snapshot pre-account local data BEFORE any cloud fetch. The fetch helpers
    // overwrite the localStorage cache with the (possibly empty) cloud copy, so
    // reading the cache *after* fetching would wipe the very data we migrate.
    const localGroups0 = store.getCachedGroups();
    const localMemberships0 = store.getCachedMemberships();

    // Optimistic first paint: the cache provably belongs to THIS user (the owner
    // reconcile above wiped it otherwise), so paint the last-known roster INSTANTLY
    // and let the cloud fetch below reconcile in the background. This is what makes
    // a cold launch feel immediate instead of blocking on several Supabase round-
    // trips before anything renders. Skipped on a fresh device (nothing cached).
    const cachedPlayers = store.getCachedPlayers().filter((p) => !deletedIdsRef.current.has(p.id));
    if (cachedPlayers.length > 0) {
      setPlayers(cachedPlayers);
      setGroups(localGroups0);
      setMemberships(localMemberships0);
      setNotifications(getNotifications());
      setLoaded(true);
    }

    let cloudPlayers = (await store.fetchCloudPlayers()).filter((p) => !deletedIdsRef.current.has(p.id));
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

    // Reconcile the optimistic paint with the cloud truth. Re-filter through the
    // tombstones — a delete tapped DURING the group/membership fetches above
    // would otherwise be undone by this stale snapshot. Keep the existing
    // players array reference when the roster is unchanged (the common relaunch
    // case) so the stat-fetch effect doesn't fire a second, redundant fan-out.
    const finalPlayers = cloudPlayers.filter((p) => !deletedIdsRef.current.has(p.id));
    store.setCachedPlayers(finalPlayers);
    setPlayers((cur) =>
      rosterSignature(cur) === rosterSignature(finalPlayers) && cur.length === finalPlayers.length
        ? cur
        : finalPlayers
    );
    setGroups(cloudGroups);
    setMemberships(cloudMemberships);
    setNotifications(getNotifications());
    setLoaded(true);
    refreshAndDiff(finalPlayers);
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
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => {
    if (!loaded || players.length === 0) return;
    const id = setInterval(() => refreshAndDiff(playersRef.current), 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [loaded, players.length, refreshAndDiff]);

  // --- Player actions ---

  const follow = useCallback(async (player: FollowedPlayer, groupIds: string[] = []) => {
    deletedIdsRef.current.delete(player.id); // re-following clears any tombstone
    store.removePendingDelete(player.id);    // …including the durable one
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
    deletedIdsRef.current.add(playerId); // tombstone: no in-flight refresh may revive him
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
    // Players whose ONLY list was this one become orphaned — delete them from All
    // Players too (per Tom: deleting a list drops any player not in another list).
    // A player still in another list, or followed with no list at all (absent from
    // the memberships map), is untouched.
    const orphaned = new Set<number>();
    memberships.forEach((ids, pid) => {
      if (ids.includes(groupId) && ids.every((id) => id === groupId)) orphaned.add(pid);
    });
    orphaned.forEach((pid) => deletedIdsRef.current.add(pid)); // tombstone so a refresh can't revive them

    setGroups((prev) => {
      const updated = prev.filter((g) => g.id !== groupId);
      store.setCachedGroups(updated);
      return updated;
    });
    setMemberships((prev) => {
      const next = new Map<number, string[]>();
      prev.forEach((ids, pid) => {
        if (orphaned.has(pid)) return; // gone entirely
        next.set(pid, ids.filter((id) => id !== groupId));
      });
      store.setCachedMemberships(next);
      return next;
    });
    if (orphaned.size) {
      setPlayers((prev) => {
        const updated = prev.filter((p) => !orphaned.has(p.id));
        store.setCachedPlayers(updated);
        return updated;
      });
    }
    await store.deleteGroup(groupId);
    await Promise.all([...orphaned].map((pid) => store.deleteCloudPlayer(pid)));
  }, [memberships]);

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
