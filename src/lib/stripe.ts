import Stripe from 'stripe';

// Billing is DORMANT until the Stripe env vars exist (same pattern as
// WAR_SHEET_ID): every billing route no-ops with a clear error, and the UI
// shows "coming soon" on the subscribe buttons.
//
// Required env (Vercel):
//   STRIPE_SECRET_KEY      — sk_live_… (or sk_test_… while testing)
//   STRIPE_WEBHOOK_SECRET  — whsec_… for /api/billing/webhook
//   STRIPE_PRICE_MONTHLY   — price id of the $19.99/mo recurring price
//   STRIPE_PRICE_YEARLY    — price id of the $149.99/yr recurring price
let client: Stripe | null = null;
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

export type Plan = 'monthly' | 'yearly';
export function priceIdFor(plan: Plan): string | undefined {
  return plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY;
}

// Referral economics: the FRIEND gets 20% off their first payment via the
// referrer's personal promotion code; the REFERRER earns a $5 credit toward
// their own subscription per converted friend (Stripe customer balance).
export const REFERRAL_COUPON_ID = 'hs-referral-20-once';
export const REFERRAL_CREDIT_CENTS = 500;

// Find-or-create the shared 20%-off-first-payment coupon that all personal
// referral codes hang off.
export async function ensureReferralCoupon(stripe: Stripe): Promise<string> {
  try {
    await stripe.coupons.retrieve(REFERRAL_COUPON_ID);
    return REFERRAL_COUPON_ID;
  } catch {
    const c = await stripe.coupons.create({
      id: REFERRAL_COUPON_ID,
      percent_off: 20,
      duration: 'once',
      name: 'Hot Sheet referral — 20% off first payment',
    });
    return c.id;
  }
}
