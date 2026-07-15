import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe, REFERRAL_CREDIT_CENTS } from '@/lib/stripe';
import { createServiceClient } from '@/lib/supabase/service';

// Stripe → tier sync. Signature-verified; service-role writes only.
//  checkout.session.completed        → tier=premium, save customer id, referral credit
//  customer.subscription.updated     → mirror status (cancel-at-period-end stays premium)
//  customer.subscription.deleted     → tier=free
// Refunds/cancels are done in the Stripe dashboard; these events flow back here
// automatically, so no separate admin plumbing is needed.
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });

  let event: Stripe.Event;
  try {
    const sig = request.headers.get('stripe-signature') ?? '';
    event = stripe.webhooks.constructEvent(await request.text(), sig, secret);
  } catch {
    return NextResponse.json({ error: 'bad_signature' }, { status: 400 });
  }

  const sb = createServiceClient();
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      if (userId) {
        await sb.from('profiles').update({ tier: 'premium', stripe_customer_id: customerId ?? null, subscription_status: 'active' }).eq('id', userId);
      }
      // Referral attribution: which promotion code (if any) was used?
      try {
        const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ['discounts.promotion_code'] });
        const promo = full.discounts?.[0]?.promotion_code;
        const promoId = typeof promo === 'string' ? promo : promo?.id;
        if (promoId) {
          const { data: rc } = await sb.from('referral_codes').select('user_id').eq('promo_id', promoId).single();
          if (rc && rc.user_id !== userId) {
            const { data: refProfile } = await sb.from('profiles').select('stripe_customer_id').eq('id', rc.user_id).single();
            if (refProfile?.stripe_customer_id) {
              // Negative balance = credit applied to the referrer's next invoice.
              await stripe.customers.createBalanceTransaction(refProfile.stripe_customer_id, {
                amount: -REFERRAL_CREDIT_CENTS, currency: 'usd',
                description: 'Hot Sheet referral credit — a friend subscribed with your code',
              });
            }
          }
        }
      } catch (e) { console.error('referral credit failed (non-fatal):', e); }
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const active = sub.status === 'active' || sub.status === 'trialing';
      // cancel_at_period_end keeps access until the period actually ends —
      // "cancel any time for the next billing month".
      await sb.from('profiles')
        .update({ tier: active ? 'premium' : 'free', subscription_status: sub.cancel_at_period_end ? 'canceling' : sub.status })
        .eq('stripe_customer_id', customerId);
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      await sb.from('profiles').update({ tier: 'free', subscription_status: 'canceled' }).eq('stripe_customer_id', customerId);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('webhook handler error:', error);
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 });
  }
}
