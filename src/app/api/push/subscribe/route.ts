import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Saves (upserts) a Web Push subscription for the signed-in user, keyed by the
// browser's push endpoint so re-subscribing the same device updates in place.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { subscription } = await request.json();
    const endpoint = subscription?.endpoint;
    if (!endpoint) return NextResponse.json({ error: 'missing subscription' }, { status: 400 });

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        { endpoint, user_id: user.id, subscription, updated_at: new Date().toISOString() },
        { onConflict: 'endpoint' }
      );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('push subscribe error:', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
