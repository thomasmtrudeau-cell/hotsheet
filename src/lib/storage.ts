import { FollowedPlayer, Group } from './types';
import { createClient } from './supabase/client';

async function currentUserId(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

const STORAGE_KEY = 'hotsheet_followed_players';

// --- Local storage (offline cache + pre-login fallback) ---

export function getCachedPlayers(): FollowedPlayer[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function setCachedPlayers(players: FollowedPlayer[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}

// --- Cloud (Supabase, per-user, protected by RLS) ---

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

// One-time migration: push any locally-cached follows up to the cloud.
// Used on first login so existing users (tom/kent/nolan) don't lose their lists.
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

// --- Groups (user-defined collections; "All Players" is implicit) ---

export async function fetchGroups(): Promise<Group[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('fetchGroups:', error.message);
    return [];
  }
  return (data ?? []).map((g) => ({ id: g.id, name: g.name, sortOrder: g.sort_order }));
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

// --- Group membership ---

// Returns a map of playerId -> array of groupIds the player belongs to.
export async function fetchMemberships(): Promise<Map<number, string[]>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('player_groups')
    .select('player_id, group_id');

  const map = new Map<number, string[]>();
  if (error) {
    console.error('fetchMemberships:', error.message);
    return map;
  }
  for (const row of data ?? []) {
    const list = map.get(row.player_id) ?? [];
    list.push(row.group_id);
    map.set(row.player_id, list);
  }
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
