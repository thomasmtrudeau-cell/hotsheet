import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSpRegression } from '@/lib/war';

// SP sell-high / buy-low regression — PREMIUM ONLY. Returns empty sets for
// non-premium / unconfigured so the client shows the teaser.
export async function GET() {
  const empty = { sellHighs: [], buyLows: [] };
  try {
    const sheetId = process.env.WAR_SHEET_ID;
    if (!sheetId) return NextResponse.json(empty);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);

    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json(empty);

    return NextResponse.json(await getSpRegression(sheetId));
  } catch (error) {
    console.error('Regression route error:', error);
    return NextResponse.json(empty);
  }
}
