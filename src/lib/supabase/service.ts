import { createClient } from '@supabase/supabase-js';

// Service-role client for privileged server-only work (WAR snapshots + risers).
// Bypasses RLS — NEVER import this into client code. Requires SUPABASE_SERVICE_ROLE_KEY.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
