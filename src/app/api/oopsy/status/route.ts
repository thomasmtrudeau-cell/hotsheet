import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { PremiumSnapshot } from '@/lib/war';

// OOPSY data-freshness meta for the header badge: capturedAt = when the premium
// snapshot was last rebuilt (fetch time); lastChange = when the sheet's numbers
// last actually DIFFERED, with a small WAR-diff summary. Never returns sheet
// content. Access: ADMIN_EMAIL env when set (Tom only), else any premium user.
// 204 (not an error) whenever there's nothing to show.
let cache: { at: number; body: { capturedAt: string; lastChange?: PremiumSnapshot['lastChange'] } } | null = null;

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new NextResponse(null, { status: 204 });
    const admin = process.env.ADMIN_EMAIL;
    if (admin) {
      if (user.email?.toLowerCase() !== admin.trim().toLowerCase()) return new NextResponse(null, { status: 204 });
    } else {
      const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
      if (profile?.tier !== 'premium') return new NextResponse(null, { status: 204 });
    }
    if (cache && Date.now() - cache.at < 5 * 60_000) return NextResponse.json(cache.body);
    const { data } = await createServiceClient().storage.from('war').download('war_premium.json');
    if (!data) return new NextResponse(null, { status: 204 });
    const snap = JSON.parse(await data.text()) as PremiumSnapshot;
    const body = { capturedAt: snap.capturedAt, lastChange: snap.lastChange };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (error) {
    console.error('oopsy status route error:', error);
    return new NextResponse(null, { status: 204 });
  }
}
