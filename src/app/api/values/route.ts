import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValueBoardInputs } from '@/lib/war';

// Value Board inputs — PREMIUM ONLY. Raw per-player model inputs for every
// projected player (the client computes PV/FV/lens grades against the user's
// league settings, same math as the Trade Checker's base model). No live
// game-log/injury layers here — this is the model's spine, for bulk review.
export async function GET(request: NextRequest) {
  const empty = { rows: [] };
  try {
    const sheetId = process.env.WAR_SHEET_ID;
    if (!sheetId) return NextResponse.json(empty);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json(empty);
    const side = request.nextUrl.searchParams.get('side') === 'pit' ? 'pit' as const : 'bat' as const;
    return NextResponse.json(await getValueBoardInputs(sheetId, side));
  } catch (error) {
    console.error('values route error:', error);
    return NextResponse.json(empty);
  }
}
