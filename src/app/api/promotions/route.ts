import { NextRequest, NextResponse } from 'next/server';
import { getPromotionsList } from '@/lib/mlb-api';
import { createClient } from '@/lib/supabase/server';

// MiLB players promoted a level in the last 3 days, WAR-sorted. WAR number is
// premium-only; the WAR-derived order is kept for everyone.
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const sheetId = process.env.WAR_SHEET_ID;
    const list = await getPromotionsList(date, 3, sheetId);

    let premium = false;
    if (sheetId) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
        premium = profile?.tier === 'premium';
      }
    }
    const out = premium ? list : list.map((c) => ({ ...c, war: undefined }));
    return NextResponse.json(out);
  } catch (error) {
    console.error('Promotions route error:', error);
    return NextResponse.json([]);
  }
}
