import { NextRequest, NextResponse } from 'next/server';
import { getNPBBatters, getNPBPitchers } from '@/lib/npb-scraper';

// Cache NPB data for 1 hour (it updates once daily)
let cache: { batters: unknown[]; pitchers: unknown[]; expires: number } | null = null;

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') || 'batting';
  const search = request.nextUrl.searchParams.get('q')?.toLowerCase();

  try {
    const now = Date.now();
    if (!cache || cache.expires < now) {
      const [batters, pitchers] = await Promise.all([
        getNPBBatters(),
        getNPBPitchers(),
      ]);
      cache = { batters, pitchers, expires: now + 3600_000 };
    }

    let data = type === 'pitching' ? cache.pitchers : cache.batters;

    // Filter by search query if provided
    if (search) {
      data = (data as Array<{ name: string }>).filter((p) =>
        p.name.toLowerCase().includes(search)
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('NPB stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch NPB stats' }, { status: 500 });
  }
}
