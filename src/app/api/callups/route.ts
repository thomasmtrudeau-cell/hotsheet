import { NextRequest, NextResponse } from 'next/server';
import { getCallupList } from '@/lib/mlb-api';

// Pre-built list of MLB call-ups in the last 7 days (public discovery feed).
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const list = await getCallupList(date, 7);
    return NextResponse.json(list);
  } catch (error) {
    console.error('Call-ups route error:', error);
    return NextResponse.json([]);
  }
}
