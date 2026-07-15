import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Who am I — tier only. Lets the client distinguish "premium, data still
// loading" from "not premium" so premium tabs show a spinner, not the teaser.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ tier: null });
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    return NextResponse.json({ tier: profile?.tier ?? 'free' });
  } catch {
    return NextResponse.json({ tier: null });
  }
}
