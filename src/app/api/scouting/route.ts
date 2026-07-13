import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getScouting } from '@/lib/war';

// Scouting list — PREMIUM ONLY (peak WAR + level + tools for every projected
// player). Returns empty for non-premium / unconfigured so the client teases.
export async function GET() {
  const empty = { rows: [] };
  try {
    const sheetId = process.env.WAR_SHEET_ID;
    if (!sheetId) return NextResponse.json(empty);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);

    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json(empty);

    return NextResponse.json(await getScouting(sheetId));
  } catch (error) {
    console.error('Scouting route error:', error);
    return NextResponse.json(empty);
  }
}
