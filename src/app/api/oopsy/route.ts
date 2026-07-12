import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOopsy } from '@/lib/oopsy';

// OOPSY weekly projections — PREMIUM ONLY. Returns empty sets (not an error) for
// signed-out / non-premium users or when no sheet is configured, so the client
// shows the teaser. The projection numbers never reach a non-premium payload.
export async function GET() {
  const empty = { pitchers: [], hitters: [] };
  try {
    const sheetId = process.env.OOPSY_SHEET_ID;
    if (!sheetId) return NextResponse.json(empty);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);

    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json(empty);

    return NextResponse.json(await getOopsy(sheetId));
  } catch (error) {
    console.error('OOPSY route error:', error);
    return NextResponse.json(empty);
  }
}
