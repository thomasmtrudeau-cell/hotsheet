import { NextRequest, NextResponse } from 'next/server';
import { getCallupList } from '@/lib/mlb-api';
import { createClient } from '@/lib/supabase/server';

// Pre-built MLB call-ups (last 7 days), sorted by peak WAR (upside). The WAR
// number is exposed only to premium; the WAR-derived ORDER is kept for everyone.
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const sheetId = process.env.WAR_SHEET_ID;
    const list = await getCallupList(date, 7, sheetId);

    // Only premium users see the WAR figure.
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
    const out = premium ? list : list.map((c) => ({ ...c, war: undefined, peakWrcPlus: undefined, era20: undefined, speed: undefined, power: undefined }));
    return NextResponse.json(out);
  } catch (error) {
    console.error('Call-ups route error:', error);
    return NextResponse.json([]);
  }
}
