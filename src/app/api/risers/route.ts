import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Prospect risers: players whose peak WAR climbed >= 1.5 over the window.
// PREMIUM ONLY — WAR is never exposed to anyone else. Returns [] otherwise.
export async function GET(request: NextRequest) {
  try {
    // Premium gate.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json([]);
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json([]);

    const raw = Number(request.nextUrl.searchParams.get('window')) || 7;
    const windowDays = [7, 14, 30].includes(raw) ? raw : 7;

    const sb = createServiceClient();
    const { data, error } = await sb.rpc('war_risers', { window_days: windowDays });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error('risers route error:', error);
    return NextResponse.json([]);
  }
}
