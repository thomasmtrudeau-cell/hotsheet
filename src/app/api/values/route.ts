import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValueBoardInputs, normalizeName } from '@/lib/war';
import { getBulkPositions } from '@/lib/mlb-api';

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
    const board = await getValueBoardInputs(sheetId, side);
    // Fill positions the auction export missed (deep prospects) from MLB's public
    // player list — real roster facts, not projections.
    if (side === 'bat') {
      const posMap = new Map<string, string>();
      for (const { name, pos } of await getBulkPositions()) {
        const k = normalizeName(name);
        if (!posMap.has(k)) posMap.set(k, pos);
      }
      for (const r of board.rows) if (!r.pos) { const mp = posMap.get(r.nameKey); if (mp) r.pos = mp; }
    }
    return NextResponse.json(board);
  } catch (error) {
    console.error('values route error:', error);
    return NextResponse.json(empty);
  }
}
