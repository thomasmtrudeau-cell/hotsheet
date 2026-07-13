import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Removes a Web Push subscription for the signed-in user. RLS already scopes
// deletes to the caller's own rows; we still match the endpoint so unsubscribing
// one device doesn't kill the user's other devices.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { endpoint } = await request.json();
    if (!endpoint) return NextResponse.json({ error: 'missing endpoint' }, { status: 400 });

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('push unsubscribe error:', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
