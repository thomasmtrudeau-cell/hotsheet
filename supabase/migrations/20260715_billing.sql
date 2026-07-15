-- Billing pipes (Stripe). profiles gains the Stripe linkage; referral_codes maps
-- each user's personal promo code (friend: 20% off first payment; referrer: $5
-- credit per conversion, granted by the webhook).
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists subscription_status text;

create table if not exists public.referral_codes (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  code     text not null unique,
  promo_id text not null,
  created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;
-- (no policies: only the service role touches this table)
