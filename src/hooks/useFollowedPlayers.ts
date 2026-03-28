'use client';

import { useState, useEffect, useCallback } from 'react';
import { FollowedPlayer } from '@/lib/types';
import { getFollowedPlayers, followPlayer as storageFollow, unfollowPlayer as storageUnfollow } from '@/lib/storage';

export function useFollowedPlayers() {
  const [players, setPlayers] = useState<FollowedPlayer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPlayers(getFollowedPlayers());
    setLoaded(true);
  }, []);

  const follow = useCallback((player: FollowedPlayer) => {
    const updated = storageFollow(player);
    setPlayers(updated);
  }, []);

  const unfollow = useCallback((playerId: number) => {
    const updated = storageUnfollow(playerId);
    setPlayers(updated);
  }, []);

  const isFollowing = useCallback(
    (playerId: number) => players.some((p) => p.id === playerId),
    [players]
  );

  return { players, loaded, follow, unfollow, isFollowing };
}
