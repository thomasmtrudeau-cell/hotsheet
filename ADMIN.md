# Hot Sheet — Admin Runbook

## Registered users / sign-ins
Supabase → Auth → Users: https://supabase.com/dashboard/project/rgrefmbjajdojtlwfrlf/auth/users
(email, provider, created, last sign-in). Tier lives in the `profiles` table.

## Billing (Stripe)
All money operations happen in the **Stripe dashboard** — the webhook keeps the
app's tier in sync automatically, so there is no separate admin UI to maintain.

- **Refund**: Stripe → Payments → payment → Refund. (Refunding does NOT cancel
  the subscription — cancel it too if that's the intent.)
- **Cancel a subscriber**: Stripe → Customers → subscription → Cancel
  (immediately, or at period end). The `customer.subscription.deleted` webhook
  flips their tier to `free` automatically.
- **Who's subscribed / revenue**: Stripe → Billing → Subscriptions.
- **Create a sale / promo code**: Stripe → Products → Coupons → New (then create
  a Promotion Code on it). Checkout has the promo box enabled.

### Tax & Invoicing
- **Tax**: checkout runs with `automatic_tax` enabled — Stripe collects nothing
  until you add a registration (Dashboard → Tax → Registrations →
  https://dashboard.stripe.com/tax/registrations). Add your home state when you
  have nexus; Stripe's threshold monitoring tells you when other states matter.
- **Invoicing**: subscriptions auto-generate invoices. Turn on customer emails
  (receipt + invoice PDFs) at Settings → Billing → Subscriptions and emails →
  https://dashboard.stripe.com/settings/billing/automatic
- **Security**: for LIVE mode, prefer a Restricted API Key (rk_…, Developers →
  API keys → Create restricted key) over the full secret key — grant write on
  Checkout Sessions, Customers, Subscriptions, Coupons, Promotion Codes, Billing
  Portal, and Customer Balance Transactions.

### One-time setup (do once, ~10 min)
1. Create the Stripe account → https://dashboard.stripe.com/register
2. Product: "Hot Sheet Premium" with two recurring prices:
   $19.99/month and $149.99/year → https://dashboard.stripe.com/products
3. Webhook endpoint → https://dashboard.stripe.com/webhooks → Add endpoint:
   `https://hotsheet-six.vercel.app/api/billing/webhook`
   Events: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy the signing secret.
4. Vercel env vars (Production): https://vercel.com/dashboard →  hotsheet →
   Settings → Environment Variables
   - `STRIPE_SECRET_KEY`     = sk_live_… (Developers → API keys)
   - `STRIPE_WEBHOOK_SECRET` = whsec_… (from step 3)
   - `STRIPE_PRICE_MONTHLY`  = price_… (monthly price id from step 2)
   - `STRIPE_PRICE_YEARLY`   = price_… (yearly price id from step 2)
5. Run `supabase/migrations/20260715_billing.sql` in the SQL editor:
   https://supabase.com/dashboard/project/rgrefmbjajdojtlwfrlf/sql/new
6. Redeploy. Until steps 1–5 are done, billing routes return 503 and the
   subscribe buttons show a friendly "almost ready" message.

## Comping premium (free access)
- **Permanent comp**: set `profiles.tier = 'premium'` for the user (SQL editor or
  table view). Ross + Jordan are comped this way.
- **Time-boxed comp**: also set `app_metadata.premium_until` (ISO timestamp) on
  the auth user — the daily cron sweeps expired comps back to `free`
  automatically. Eno is comped through 2026-07-31 this way.

## Referral program
- Every premium user can mint a personal code (🎁 Refer button): friend gets 20%
  off their first payment; referrer gets a $5 Stripe balance credit per
  conversion (applies to their next invoice automatically).
- Codes live in `referral_codes` (Supabase) + as Promotion Codes in Stripe.
