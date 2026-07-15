import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const maxDuration = 30;

// WAR Trends — PREMIUM ONLY (WAR never reaches anyone else).
//  GET /api/trends            → index: every player in the LATEST capture (for search)
//  GET /api/trends?players=k1|h,k2|p  → full capture series for up to 8 players
// Pitcher history starts 2026-07-13: earlier captures stored the wrong sheet
// column and were purged, so pitcher lines are simply shorter than hitter lines.
export async function GET(request: NextRequest) {
  const empty = { index: [], series: [] };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    if (profile?.tier !== 'premium') return NextResponse.json(empty);

    const sb = createServiceClient();
    const playersParam = request.nextUrl.searchParams.get('players');

    if (!playersParam) {
      // Index = the latest capture's full roster.
      const { data: latest } = await sb.from('war_snapshots')
        .select('captured_at').order('captured_at', { ascending: false }).limit(1);
      const latestAt = latest?.[0]?.captured_at;
      if (!latestAt) return NextResponse.json({ index: [] });
      const index: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('war_snapshots')
          .select('name_key, display_name, is_pitcher, level, war')
          .eq('captured_at', latestAt)
          .order('war', { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        if (!data?.length) break;
        index.push(...data.map((r) => ({ nameKey: r.name_key, player: r.display_name, isPitcher: r.is_pitcher, level: r.level ?? undefined, war: Number(r.war) })));
        if (data.length < 1000) break;
      }
      return NextResponse.json({ index });
    }

    // Series for the requested players ("<nameKey>|h" or "<nameKey>|p").
    const wanted = playersParam.split(',').slice(0, 8).map((s) => {
      const i = s.lastIndexOf('|');
      return { key: s.slice(0, i), pitcher: s.slice(i + 1) === 'p' };
    }).filter((w) => w.key);
    if (wanted.length === 0) return NextResponse.json({ series: [] });

    const { data, error } = await sb.from('war_snapshots')
      .select('name_key, display_name, is_pitcher, captured_at, war')
      .in('name_key', wanted.map((w) => w.key))
      .order('captured_at', { ascending: true })
      .limit(20000);
    if (error) throw error;

    const series = wanted.map((w) => {
      const rows = (data ?? []).filter((r) => r.name_key === w.key && r.is_pitcher === w.pitcher);
      return {
        nameKey: w.key,
        player: rows[rows.length - 1]?.display_name ?? w.key,
        isPitcher: w.pitcher,
        points: rows.map((r) => ({ at: r.captured_at, war: Number(r.war) })),
      };
    }).filter((s) => s.points.length > 0);
    return NextResponse.json({ series });
  } catch (error) {
    console.error('trends route error:', error);
    return NextResponse.json(empty);
  }
}
