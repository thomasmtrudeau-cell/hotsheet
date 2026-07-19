import { FollowedPlayer, Group } from './types';
import { createClient } from './supabase/client';

// Cloud (Supabase, per-user via RLS) is the source of truth; localStorage is
// kept as an offline cache and as the source for the one-time migration of
// pre-account data up to the signed-in user's account.
const PLAYERS_KEY = 'hotsheet_followed_players';
const GROUPS_KEY = 'hotsheet_groups';
const MEMBERSHIPS_KEY = 'hotsheet_player_groups';
// Which signed-in user the local cache above currently belongs to. localStorage
// is shared across every account on a device, so we tag the cache and wipe it
// when a different account signs in — otherwise one user's list could seed or
// be shown to another.
const CACHE_OWNER_KEY = 'hotsheet_cache_owner';
// Legacy keys from the old name-login + Vercel Blob era (one-time import).
const LEGACY_USER_KEY = 'hotsheet_username';
const LEGACY_IMPORTED_KEY = 'hotsheet_blob_imported';

async function currentUserId(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

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

// --- Cross-account cache hygiene ---

// Wipe the per-device local cache (players/groups/memberships). Cloud is the
// source of truth, so this only drops the offline copy.
export function clearLocalCache(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PLAYERS_KEY);
  localStorage.removeItem(GROUPS_KEY);
  localStorage.removeItem(MEMBERSHIPS_KEY);
  // Also drop the per-date "Playing Today" instant-paint cache — it's account-
  // agnostic by key, so don't let one user's cached daily stats survive a switch.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('hotsheet_daily_')) localStorage.removeItem(k);
  }
}

// If the cached data belongs to a different account than the one now signed in
// (or to no one yet), wipe it and claim it for the current user. Prevents one
// account's list from leaking into another on a shared browser.
export async function reconcileCacheOwner(): Promise<void> {
  if (typeof window === 'undefined') return;
  const userId = await currentUserId();
  if (!userId) return;
  if (localStorage.getItem(CACHE_OWNER_KEY) !== userId) {
    clearLocalCache();
    localStorage.setItem(CACHE_OWNER_KEY, userId);
  }
}

// --- Local cache ---

export function getCachedPlayers(): FollowedPlayer[] {
  return read<FollowedPlayer[]>(PLAYERS_KEY, []);
}

export function setCachedPlayers(players: FollowedPlayer[]): void {
  write(PLAYERS_KEY, players);
}

export function getCachedGroups(): Group[] {
  return read<Group[]>(GROUPS_KEY, []);
}

export function setCachedGroups(groups: Group[]): void {
  write(GROUPS_KEY, groups);
}

export function getCachedMemberships(): Map<number, string[]> {
  const obj = read<Record<string, string[]>>(MEMBERSHIPS_KEY, {});
  const map = new Map<number, string[]>();
  for (const [pid, ids] of Object.entries(obj)) map.set(Number(pid), ids);
  return map;
}

export function setCachedMemberships(map: Map<number, string[]>): void {
  const obj: Record<string, string[]> = {};
  map.forEach((ids, pid) => {
    if (ids.length > 0) obj[String(pid)] = ids;
  });
  write(MEMBERSHIPS_KEY, obj);
}

// --- Cloud: followed players ---

export async function fetchCloudPlayers(): Promise<FollowedPlayer[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('followed_players')
    .select('data')
    .order('followed_at', { ascending: true });

  if (error) {
    console.error('fetchCloudPlayers:', error.message);
    // Fall back to the local cache so the app still works offline.
    return getCachedPlayers();
  }

  const players = (data ?? []).map((row) => row.data as FollowedPlayer);
  setCachedPlayers(players);
  return players;
}

export async function upsertCloudPlayer(player: FollowedPlayer): Promise<void> {
  const supabase = createClient();
  const userId = await currentUserId();
  if (!userId) return;

  const { error } = await supabase.from('followed_players').upsert(
    {
      user_id: userId,
      player_id: player.id,
      data: player,
      followed_at: player.followedAt,
    },
    { onConflict: 'user_id,player_id' }
  );
  if (error) console.error('upsertCloudPlayer:', error.message);
}

export async function deleteCloudPlayer(playerId: number): Promise<void> {
  const supabase = createClient();
  const userId = await currentUserId();
  if (!userId) return;

  const { error } = await supabase
    .from('followed_players')
    .delete()
    .eq('user_id', userId)
    .eq('player_id', playerId);
  if (error) console.error('deleteCloudPlayer:', error.message);
}

export async function bulkUpsertCloudPlayers(players: FollowedPlayer[]): Promise<void> {
  const supabase = createClient();
  const userId = await currentUserId();
  if (!userId || players.length === 0) return;

  const rows = players.map((p) => ({
    user_id: userId,
    player_id: p.id,
    data: p,
    followed_at: p.followedAt,
  }));

  const { error } = await supabase
    .from('followed_players')
    .upsert(rows, { onConflict: 'user_id,player_id' });
  if (error) console.error('bulkUpsertCloudPlayers:', error.message);
}

// --- Cloud: groups ("All Players" is implicit and never stored) ---

export async function fetchGroups(): Promise<Group[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('fetchGroups:', error.message);
    return getCachedGroups();
  }
  const groups = (data ?? []).map((g) => ({ id: g.id, name: g.name, sortOrder: g.sort_order }));
  setCachedGroups(groups);
  return groups;
}

export async function createGroup(name: string, sortOrder = 0): Promise<Group | null> {
  const supabase = createClient();
  const userId = await currentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('groups')
    .insert({ user_id: userId, name, sort_order: sortOrder })
    .select('id, name, sort_order')
    .single();

  if (error) {
    console.error('createGroup:', error.message);
    return null;
  }
  return { id: data.id, name: data.name, sortOrder: data.sort_order };
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('groups').update({ name }).eq('id', groupId);
  if (error) console.error('renameGroup:', error.message);
}

export async function deleteGroup(groupId: string): Promise<void> {
  // player_groups rows cascade-delete; the players themselves stay in "All".
  const supabase = createClient();
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  if (error) console.error('deleteGroup:', error.message);
}

// --- Cloud: group membership ---

// Returns a map of playerId -> array of groupIds the player belongs to.
export async function fetchMemberships(): Promise<Map<number, string[]>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('player_groups')
    .select('player_id, group_id');

  if (error) {
    console.error('fetchMemberships:', error.message);
    return getCachedMemberships();
  }
  const map = new Map<number, string[]>();
  for (const row of data ?? []) {
    const list = map.get(row.player_id) ?? [];
    list.push(row.group_id);
    map.set(row.player_id, list);
  }
  setCachedMemberships(map);
  return map;
}

// Replaces a player's group memberships with exactly `groupIds`.
export async function setPlayerGroups(playerId: number, groupIds: string[]): Promise<void> {
  const supabase = createClient();
  const userId = await currentUserId();
  if (!userId) return;

  // Clear existing, then insert the new set. Small N per player, so this is fine.
  const { error: delErr } = await supabase
    .from('player_groups')
    .delete()
    .eq('user_id', userId)
    .eq('player_id', playerId);
  if (delErr) {
    console.error('setPlayerGroups (delete):', delErr.message);
    return;
  }

  if (groupIds.length === 0) return;

  const rows = groupIds.map((groupId) => ({ user_id: userId, group_id: groupId, player_id: playerId }));
  const { error: insErr } = await supabase.from('player_groups').insert(rows);
  if (insErr) console.error('setPlayerGroups (insert):', insErr.message);
}

// --- One-time migration: pre-account localStorage data → the user's account ---

// Inserts local groups keeping their UUIDs, so local membership rows can be
// pushed as-is right after.
export async function bulkInsertGroups(groups: Group[]): Promise<void> {
  const supabase = createClient();
  const userId = await currentUserId();
  if (!userId || groups.length === 0) return;

  const rows = groups.map((g) => ({
    id: g.id,
    user_id: userId,
    name: g.name,
    sort_order: g.sortOrder,
  }));
  const { error } = await supabase.from('groups').upsert(rows, { onConflict: 'id' });
  if (error) console.error('bulkInsertGroups:', error.message);
}

// Pushes local memberships up. Rows referencing players or groups that don't
// exist in the cloud are skipped (FK constraints would reject them anyway).
export async function bulkInsertMemberships(
  memberships: Map<number, string[]>,
  validPlayerIds: Set<number>,
  validGroupIds: Set<string>
): Promise<void> {
  const supabase = createClient();
  const userId = await currentUserId();
  if (!userId) return;

  const rows: Array<{ user_id: string; group_id: string; player_id: number }> = [];
  memberships.forEach((groupIds, playerId) => {
    if (!validPlayerIds.has(playerId)) return;
    for (const groupId of groupIds) {
      if (validGroupIds.has(groupId)) rows.push({ user_id: userId, group_id: groupId, player_id: playerId });
    }
  });
  if (rows.length === 0) return;

  const { error } = await supabase
    .from('player_groups')
    .upsert(rows, { onConflict: 'group_id,player_id' });
  if (error) console.error('bulkInsertMemberships:', error.message);
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
  if (!username || getCachedPlayers().length > 0) return null;
  try {
    const res = await fetch(`/api/users?name=${encodeURIComponent(username)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const players: FollowedPlayer[] = data.players || [];
    if (players.length === 0) return null;
    setCachedPlayers(players);
    return players;
  } catch {
    return null;
  }
}
