import { FollowedPlayer } from './types';

const STORAGE_KEY = 'hotsheet_followed_players';
const USER_KEY = 'hotsheet_username';

// --- Username ---

export function getUsername(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(USER_KEY);
}

export function setUsername(name: string): void {
  localStorage.setItem(USER_KEY, name.toLowerCase());
}

export function clearUsername(): void {
  localStorage.removeItem(USER_KEY);
}

// --- Local storage (offline fallback) ---

export function getFollowedPlayers(): FollowedPlayer[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function setFollowedPlayersLocal(players: FollowedPlayer[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}

// --- Cloud sync ---

export async function loadFromCloud(username: string): Promise<FollowedPlayer[]> {
  try {
    const res = await fetch(`/api/users?name=${encodeURIComponent(username)}`);
    if (!res.ok) return [];
    const data = await res.json();
    const players = data.players || [];
    // Update local cache
    setFollowedPlayersLocal(players);
    return players;
  } catch {
    // Offline — return local
    return getFollowedPlayers();
  }
}

export async function saveToCloud(username: string, players: FollowedPlayer[]): Promise<void> {
  // Always update local first
  setFollowedPlayersLocal(players);

  try {
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, players }),
    });
  } catch {
    // Offline — local is already saved
  }
}
