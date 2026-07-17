import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValueBoardInputs } from '@/lib/war';

// Value Board inputs — OWNER-ONLY for now. Raw per-player model inputs for every
// projected player (the client runs them through the shared value pipeline). The
// board's grades don't yet reliably match the Trade Checker (different live-layer
// coverage), so it's gated to Tom until it's trustworthy. Also hidden in the UI.
const OWNER_EMAIL = 'thomasmtrudeau@gmail.com';
export async function GET(request: NextRequest) {
  const empty = { rows: [] };
  try {
    const sheetId = process.env.WAR_SHEET_ID;
    if (!sheetId) return NextResponse.json(empty);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);
    if ((user.email ?? '').toLowerCase() !== OWNER_EMAIL) return NextResponse.json(empty);
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json(empty);
    const side = request.nextUrl.searchParams.get('side') === 'pit' ? 'pit' as const : 'bat' as const;
    return NextResponse.json(await getValueBoardInputs(sheetId, side));
  } catch (error) {
    console.error('values route error:', error);
    return NextResponse.json(empty);
  }
}
