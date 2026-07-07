import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 Proxy (formerly Middleware). Keeps the Supabase session fresh.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on page routes only. Skip Next internals, static assets, and the public
  // stats APIs (they don't need auth and are polled every 5 min).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
