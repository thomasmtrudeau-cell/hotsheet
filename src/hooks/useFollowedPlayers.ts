'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { FollowedPlayer, Group } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import {
  getCachedPlayers,
  setCachedPlayers,
  fetchCloudPlayers,
  upsertCloudPlayer,
  deleteCloudPlayer,
  bulkUpsertCloudPlayers,
  fetchGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  fetchMemberships,
  setPlayerGroups,
} from '@/lib/storage';

export function useFollowedPlayers() {
  const [user, setUser] = useState<User | null>(null);
  const [players, setPlayers] = useState<FollowedPlayer[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  // playerId -> groupIds[]
  const [memberships, setMemberships] = useState<Map<number, string[]>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const authReadyRef = useRef(false);

  // Load everything for the signed-in user (with one-time local→cloud migration).
  const loadAll = useCallback(async () => {
    const [cloudPlayers, cloudGroups, cloudMemberships] = await Promise.all([
      fetchCloudPlayers(),
      fetchGroups(),
      fetchMemberships(),
    ]);

    // First-login migration: if the cloud is empty but this browser has a
    // local cache (e.g. legacy tom/kent/nolan follows), push them up.
    if (cloudPlayers.length === 0) {
      const cached = getCachedPlayers();
      if (cached.length > 0) {
        await bulkUpsertCloudPlayers(cached);
        setPlayers(cached);
        setGroups(cloudGroups);
        setMemberships(cloudMemberships);
        setLoaded(true);
        return;
      }
    }

    setPlayers(cloudPlayers);
    setGroups(cloudGroups);
    setMemberships(cloudMemberships);
    setLoaded(true);
  }, []);

  // Track auth state.
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      authReadyRef.current = true;
      if (data.user) loadAll();
      else setLoaded(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (nextUser) {
        setLoaded(false);
        loadAll();
      } else {
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
      setCachedPlayers(updated);
      return updated;
    });
    await upsertCloudPlayer(withTime);
  }, []);

  const unfollow = useCallback(async (playerId: number) => {
    setPlayers((prev) => {
      const updated = prev.filter((p) => p.id !== playerId);
      setCachedPlayers(updated);
      return updated;
    });
    setMemberships((prev) => {
      const next = new Map(prev);
      next.delete(playerId);
      return next;
    });
    await deleteCloudPlayer(playerId);
  }, []);

  const isFollowing = useCallback(
    (playerId: number) => players.some((p) => p.id === playerId),
    [players]
  );

  // --- Group actions ---

  const addGroup = useCallback(async (name: string) => {
    const group = await createGroup(name.trim(), groups.length);
    if (group) setGroups((prev) => [...prev, group]);
    return group;
  }, [groups.length]);

  const editGroup = useCallback(async (groupId: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));
    await renameGroup(groupId, name.trim());
  }, []);

  const removeGroup = useCallback(async (groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    // Drop this group from local membership state (players stay in "All").
    setMemberships((prev) => {
      const next = new Map<number, string[]>();
      prev.forEach((ids, pid) => next.set(pid, ids.filter((id) => id !== groupId)));
      return next;
    });
    await deleteGroup(groupId);
  }, []);

  // Set exactly which groups a player belongs to.
  const assignGroups = useCallback(async (playerId: number, groupIds: string[]) => {
    setMemberships((prev) => {
      const next = new Map(prev);
      next.set(playerId, groupIds);
      return next;
    });
    await setPlayerGroups(playerId, groupIds);
  }, []);

  return {
    user,
    players,
    groups,
    memberships,
    loaded,
    follow,
    unfollow,
    isFollowing,
    addGroup,
    editGroup,
    removeGroup,
    assignGroups,
    reload: loadAll,
  };
}
