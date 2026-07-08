import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client. Reads/writes auth cookies via document.cookie
// automatically, and is the client used for all client-component data access
// (followed players). Row-Level Security is what keeps each user's data private.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
