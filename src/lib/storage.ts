import { FollowedPlayer } from './types';

const STORAGE_KEY = 'hotsheet_followed_players';

export function getFollowedPlayers(): FollowedPlayer[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function followPlayer(player: FollowedPlayer): FollowedPlayer[] {
  const players = getFollowedPlayers();
  if (players.some((p) => p.id === player.id)) return players;
  const updated = [...players, { ...player, followedAt: new Date().toISOString() }];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function unfollowPlayer(playerId: number): FollowedPlayer[] {
  const players = getFollowedPlayers();
  const updated = players.filter((p) => p.id !== playerId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function isFollowing(playerId: number): boolean {
  return getFollowedPlayers().some((p) => p.id === playerId);
}
