# Hot Sheet — Supabase setup (your dashboard steps)

All app code is wired up. These are the steps to do yourself in the Supabase + Google
dashboards (kept off MCP so the Stadium Ventures connection stays put).

## 1. Free up a slot + create the project
1. Delete the **All Star Kids** Supabase project (after confirming its Table Editor is empty).
2. **New project** → name `hotsheet`, region `us-east-1`, free plan.

## 2. Run the schema
Dashboard → **SQL Editor** → New query → paste all of `supabase/schema.sql` → **Run**.
(Re-runnable; creates profiles, followed_players, groups, player_groups + RLS.)

## 3. Get the keys
Dashboard → **Settings → API**. Copy:
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Add both to:
- `.env.local` (local dev)
- Vercel → Project → Settings → Environment Variables (production), then redeploy.

## 4. Auth URL configuration
Dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://hotsheet-six.vercel.app`
- **Redirect URLs** (add both):
  - `http://localhost:3000/**`
  - `https://hotsheet-six.vercel.app/**`

## 5. Email (magic link)
Dashboard → **Authentication → Providers → Email**: ensure Email is enabled.
"Confirm email" can stay on — magic-link sign-in works regardless.

## 6. Google sign-in
1. Google Cloud Console → create OAuth 2.0 Client (Web application).
2. Authorized redirect URI: `https://YOUR-PROJECT-ref.supabase.co/auth/v1/callback`
   (shown in the Supabase Google provider screen — copy it from there).
3. Paste the Google **Client ID** + **Client Secret** into Supabase → Authentication →
   Providers → **Google**, and enable it.

## 7. Done
Sign in with your email (or Google). On first sign-in, any players already saved in
this browser's local cache are auto-migrated up to your account.
