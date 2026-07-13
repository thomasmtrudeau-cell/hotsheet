import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendPush, pushConfigured } from '@/lib/push';

export const runtime = 'nodejs';

// Fires a test notification to every device the signed-in user has subscribed —
// used by the "Send test" button so the user can confirm alerts actually arrive.
export async function POST() {
  try {
    if (!pushConfigured()) return NextResponse.json({ error: 'push not configured' }, { status: 503 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', user.id);
    if (!subs || subs.length === 0) return NextResponse.json({ error: 'no subscriptions' }, { status: 404 });

    const results = await Promise.all(
      subs.map((s) => sendPush(s.subscription, {
        title: '🔥 Hot Sheet',
        body: 'Push notifications are on — you\'ll get roster moves and IL changes here.',
        tag: 'hotsheet-test',
        url: '/',
      }))
    );
    return NextResponse.json({ sent: results.filter((r) => r === 'ok').length, total: subs.length });
  } catch (error) {
    console.error('push test error:', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
