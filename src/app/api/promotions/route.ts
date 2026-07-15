import { NextRequest, NextResponse } from 'next/server';
import { getPromotionsList } from '@/lib/mlb-api';
import { createClient } from '@/lib/supabase/server';

// MiLB players promoted a level in the last 7 days, WAR-sorted. WAR number is
// premium-only; the WAR-derived order is kept for everyone.
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const days = Math.min(14, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 7));
    const sheetId = process.env.WAR_SHEET_ID;
    const list = await getPromotionsList(date, days, sheetId);

    let premium = false;
    if (sheetId) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
        premium = profile?.tier === 'premium';
      }
    }
    // Strip ALL premium numbers for non-premium (WAR + peak wRC+ + ERA/20); the
    // WAR-derived order stays. Real values never reach a non-premium payload.
    const out = premium ? list : list.map((c) => ({ ...c, war: undefined, peakWrcPlus: undefined, era20: undefined, speed: undefined, power: undefined, dual: undefined, def: undefined, presentValue: undefined, futureValue: undefined, age: undefined, hr: undefined, sb: undefined, curWrcPlus: undefined, curEra20: undefined, level: undefined, marketBaseline: undefined }));
    return NextResponse.json(out);
  } catch (error) {
    console.error('Promotions route error:', error);
    return NextResponse.json([]);
  }
}
