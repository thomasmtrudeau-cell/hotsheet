import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

// Stripe customer portal: manage payment method, switch plan, CANCEL (takes
// effect at the end of the current billing period — the webhook flips tier when
// the subscription actually ends).
export async function POST(request: NextRequest) {
  try {
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'signin_required' }, { status: 401 });
    const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    if (!profile?.stripe_customer_id) return NextResponse.json({ error: 'no_subscription' }, { status: 400 });
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: request.nextUrl.origin,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('portal error:', error);
    return NextResponse.json({ error: 'portal_failed' }, { status: 500 });
  }
}
