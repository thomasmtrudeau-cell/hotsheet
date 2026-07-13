import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { hydrateFollowedPlayers } from '@/lib/mlb-api';
import { diffPlayer } from '@/lib/notifications';
import { sendPush, pushConfigured, PushPayload } from '@/lib/push';
import { FollowedPlayer, isMLBSystem } from '@/lib/types';
import { NOTIFICATION_STYLE } from '@/lib/notifications';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Background push: diffs each subscriber's followed players against the state we
// last pushed them, and delivers roster-move / IL notifications even when the app
// is closed. State is tracked per subscription (per device), so each device gets
// each event exactly once. First run for a subscription just seeds the baseline
// (no backlog storm on opt-in). Triggered by Vercel cron (Bearer CRON_SECRET)
// or an external scheduler (?secret=).
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET) {
    const viaHeader = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
    const viaQuery = request.nextUrl.searchParams.get('secret') === process.env.CRON_SECRET;
    if (!viaHeader && !viaQuery) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!pushConfigured()) return NextResponse.json({ skipped: 'push not configured' });

  const sb = createServiceClient();
  const { data: subs, error } = await sb
    .from('push_subscriptions')
    .select('endpoint, user_id, subscription, last_state');
  if (error) return NextResponse.json({ error: 'db', detail: error.message }, { status: 500 });
  if (!subs || subs.length === 0) return NextResponse.json({ subscriptions: 0 });

  // Hydrate each user's followed players once (shared across their devices).
  const hydratedByUser = new Map<string, FollowedPlayer[]>();
  async function currentFor(userId: string): Promise<FollowedPlayer[]> {
    if (hydratedByUser.has(userId)) return hydratedByUser.get(userId)!;
    const { data: rows } = await sb.from('followed_players').select('data').eq('user_id', userId);
    const players = (rows ?? []).map((r) => r.data as FollowedPlayer).filter((p) => isMLBSystem(p.sportId));
    const hydrated = players.length > 0 ? await hydrateFollowedPlayers(players) : [];
    hydratedByUser.set(userId, hydrated);
    return hydrated;
  }

  let pushed = 0;
  let seeded = 0;
  let pruned = 0;

  for (const sub of subs) {
    try {
      const current = await currentFor(sub.user_id);
      const stateNow: Record<string, FollowedPlayer> = {};
      for (const p of current) stateNow[p.id] = p;

      const prevState = (sub.last_state ?? {}) as Record<string, FollowedPlayer>;
      const isSeed = Object.keys(prevState).length === 0;

      if (!isSeed) {
        const payloads: PushPayload[] = [];
        for (const cur of current) {
          const prev = prevState[cur.id];
          if (!prev) continue; // newly-followed since last run — seed silently
          for (const n of diffPlayer(prev, cur)) {
            payloads.push({
              title: `${NOTIFICATION_STYLE[n.type]?.emoji ?? '🔥'} ${n.playerName}`,
              body: n.message,
              tag: n.key,
              url: '/',
            });
          }
        }
        for (const payload of payloads) {
          const res = await sendPush(sub.subscription, payload);
          if (res === 'ok') pushed++;
          else if (res === 'gone') {
            await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            pruned++;
            break; // endpoint dead — stop sending to it
          }
        }
      } else {
        seeded++;
      }

      // Advance this device's baseline to what we've now shown it.
      await sb
        .from('push_subscriptions')
        .update({ last_state: stateNow, updated_at: new Date().toISOString() })
        .eq('endpoint', sub.endpoint);
    } catch (e) {
      console.error('push-check subscription error:', sub.endpoint, e);
    }
  }

  return NextResponse.json({ subscriptions: subs.length, pushed, seeded, pruned });
}
