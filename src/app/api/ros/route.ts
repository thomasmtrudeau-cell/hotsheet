import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Rest-of-season projections (OOPSY) — PREMIUM ONLY. Served from the 'ros'
// Supabase storage bucket, uploaded by the daily pipeline run on Tom's Mac
// (sts-replica/upload_ros.py). The Trade Checker's present-value production layer
// prefers these forward-looking rates over current-year actuals. Returns empty
// (not an error) when the bucket/file doesn't exist yet, so PV falls back
// cleanly and the client shows no freshness pill.
export async function GET() {
  const empty = { asOf: null, hitters: {}, pitchers: {} };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json(empty);

    const sb = createServiceClient();
    const { data, error } = await sb.storage.from('ros').download('ros_latest.json');
    if (error || !data) return NextResponse.json(empty);
    const json = JSON.parse(await data.text());
    return NextResponse.json({
      asOf: typeof json?.asOf === 'string' ? json.asOf : null,
      hitters: json?.hitters ?? {},
      pitchers: json?.pitchers ?? {},
    });
  } catch (error) {
    console.error('ros route error:', error);
    return NextResponse.json(empty);
  }
}
