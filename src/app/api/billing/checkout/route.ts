import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getStripe, priceIdFor, Plan } from '@/lib/stripe';

// Start a Stripe Checkout session for premium ($19.99/mo or $149.99/yr).
// Hosted checkout — no card data ever touches this app. Body: { plan, ref? }
// where ref is a referral code captured from a ?ref= share link.
export async function POST(request: NextRequest) {
  try {
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'signin_required' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const plan: Plan = body?.plan === 'yearly' ? 'yearly' : 'monthly';
    const price = priceIdFor(plan);
    if (!price) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });

    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier === 'premium') return NextResponse.json({ error: 'already_premium' }, { status: 400 });

    const origin = request.nextUrl.origin;
    // Referral code (from a friend's share link) — pre-applied so the friend
    // doesn't have to type it; otherwise the promo-code box is open on checkout.
    let discounts: { promotion_code: string }[] | undefined;
    const ref = typeof body?.ref === 'string' ? body.ref.trim().toUpperCase() : '';
    if (ref) {
      const sb = createServiceClient();
      const { data: rc } = await sb.from('referral_codes').select('promo_id, user_id').eq('code', ref).single();
      if (rc && rc.user_id !== user.id) discounts = [{ promotion_code: rc.promo_id }];
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      ...(discounts ? { discounts } : { allow_promotion_codes: true }),
      subscription_data: { metadata: { user_id: user.id } },
      // Stripe Tax: safe to enable before any registrations exist — no tax is
      // collected until a registration is active (Dashboard → Tax → Registrations).
      automatic_tax: { enabled: true },
      success_url: `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?billing=cancelled`,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('checkout error:', error);
    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
  }
}
