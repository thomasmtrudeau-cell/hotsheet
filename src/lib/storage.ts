import { FollowedPlayer, Group } from './types';

// All persistence is localStorage — per-browser, no accounts.
const PLAYERS_KEY = 'hotsheet_followed_players';
const GROUPS_KEY = 'hotsheet_groups';
const MEMBERSHIPS_KEY = 'hotsheet_player_groups';
const SEEDED_KEY = 'hotsheet_groups_seeded';
// Legacy keys from the old name-login + Vercel Blob era (one-time import).
const LEGACY_USER_KEY = 'hotsheet_username';
const LEGACY_IMPORTED_KEY = 'hotsheet_blob_imported';

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Followed players ---

export function getPlayers(): FollowedPlayer[] {
  return read<FollowedPlayer[]>(PLAYERS_KEY, []);
}

export function setPlayers(players: FollowedPlayer[]): void {
  write(PLAYERS_KEY, players);
}

// --- Groups ---

export function getGroups(): Group[] {
  return read<Group[]>(GROUPS_KEY, []);
}

export function setGroups(groups: Group[]): void {
  write(GROUPS_KEY, groups);
}

// First-run starter groups. Runs once per browser; users can rename/delete.
export function seedDefaultGroupsOnce(): Group[] {
  const existing = getGroups();
  if (typeof window === 'undefined') return existing;
  if (localStorage.getItem(SEEDED_KEY)) return existing;
  localStorage.setItem(SEEDED_KEY, '1');
  if (existing.length > 0) return existing;
  const seeded: Group[] = [
    { id: crypto.randomUUID(), name: 'Watch List', sortOrder: 0 },
    { id: crypto.randomUUID(), name: 'My Team', sortOrder: 1 },
  ];
  setGroups(seeded);
  return seeded;
}

// --- Group memberships (playerId -> groupIds) ---

export function getMemberships(): Map<number, string[]> {
  const obj = read<Record<string, string[]>>(MEMBERSHIPS_KEY, {});
  const map = new Map<number, string[]>();
  for (const [pid, ids] of Object.entries(obj)) map.set(Number(pid), ids);
  return map;
}

export function setMemberships(map: Map<number, string[]>): void {
  const obj: Record<string, string[]> = {};
  map.forEach((ids, pid) => {
    if (ids.length > 0) obj[String(pid)] = ids;
  });
  write(MEMBERSHIPS_KEY, obj);
}

// --- Legacy import ---

// The old app synced follows to Vercel Blob keyed by a login name. If this
// browser has a legacy username but no local follows (e.g. cleared cache),
// pull the blob copy down once so nobody loses their list.
export async function importLegacyPlayersOnce(): Promise<FollowedPlayer[] | null> {
  if (typeof window === 'undefined') return null;
  if (localStorage.getItem(LEGACY_IMPORTED_KEY)) return null;
  const username = localStorage.getItem(LEGACY_USER_KEY);
  localStorage.setItem(LEGACY_IMPORTED_KEY, '1');
  if (!username || getPlayers().length > 0) return null;
  try {
    const res = await fetch(`/api/users?name=${encodeURIComponent(username)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const players: FollowedPlayer[] = data.players || [];
    if (players.length === 0) return null;
    setPlayers(players);
    return players;
  } catch {
    return null;
  }
}
