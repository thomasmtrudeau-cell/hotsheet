'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { FollowedPlayer } from '@/lib/types';
import {
  getFollowedPlayers,
  setFollowedPlayersLocal,
  getUsername,
  loadFromCloud,
  saveToCloud,
} from '@/lib/storage';

export function useFollowedPlayers() {
  const [players, setPlayers] = useState<FollowedPlayer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const usernameRef = useRef<string | null>(null);

  // Load players — from cloud if logged in, otherwise local
  const load = useCallback(async () => {
    const username = getUsername();
    usernameRef.current = username;

    if (username) {
      const cloudPlayers = await loadFromCloud(username);
      setPlayers(cloudPlayers);
    } else {
      setPlayers(getFollowedPlayers());
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const syncToCloud = useCallback(async (updated: FollowedPlayer[]) => {
    setFollowedPlayersLocal(updated);
    setPlayers(updated);
    const username = usernameRef.current || getUsername();
    if (username) {
      await saveToCloud(username, updated);
    }
  }, []);

  const follow = useCallback(async (player: FollowedPlayer) => {
    setPlayers((prev) => {
      if (prev.some((p) => p.id === player.id)) return prev;
      const updated = [...prev, { ...player, followedAt: new Date().toISOString() }];
      syncToCloud(updated);
      return updated;
    });
  }, [syncToCloud]);

  const unfollow = useCallback(async (playerId: number) => {
    setPlayers((prev) => {
      const updated = prev.filter((p) => p.id !== playerId);
      syncToCloud(updated);
      return updated;
    });
  }, [syncToCloud]);

  const isFollowing = useCallback(
    (playerId: number) => players.some((p) => p.id === playerId),
    [players]
  );

  return { players, loaded, follow, unfollow, isFollowing, reload: load };
}
