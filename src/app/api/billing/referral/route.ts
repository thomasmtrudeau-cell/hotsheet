import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getStripe, ensureReferralCoupon } from '@/lib/stripe';

// Get (or mint) the signed-in premium user's personal referral code.
// Friend gets 20% off their first payment; the referrer earns a $5 credit per
// converted friend (granted by the webhook). Codes look like HS-AB12.
export async function GET() {
  try {
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'signin_required' }, { status: 401 });
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json({ error: 'premium_only' }, { status: 403 });

    const sb = createServiceClient();
    const { data: existing } = await sb.from('referral_codes').select('code').eq('user_id', user.id).single();
    if (existing?.code) return NextResponse.json({ code: existing.code });

    const coupon = await ensureReferralCoupon(stripe);
    // Retry a few times in the (unlikely) event of a code collision.
    for (let i = 0; i < 5; i++) {
      const code = `HS-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      try {
        const promo = await stripe.promotionCodes.create({ promotion: { type: 'coupon', coupon }, code, metadata: { user_id: user.id } });
        const { error } = await sb.from('referral_codes').insert({ user_id: user.id, code, promo_id: promo.id });
        if (error) throw error;
        return NextResponse.json({ code });
      } catch { /* collision — retry */ }
    }
    return NextResponse.json({ error: 'code_generation_failed' }, { status: 500 });
  } catch (error) {
    console.error('referral error:', error);
    return NextResponse.json({ error: 'referral_failed' }, { status: 500 });
  }
}
