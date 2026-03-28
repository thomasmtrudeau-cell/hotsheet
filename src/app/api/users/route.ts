import { NextRequest, NextResponse } from 'next/server';
import { put, list, del } from '@vercel/blob';

const ALLOWED_USERS = ['tom', 'kent', 'nolan'];

function getUserBlobPath(username: string): string {
  return `users/${username.toLowerCase()}.json`;
}

// GET /api/users?name=tom — load a user's followed players
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name')?.toLowerCase();
  if (!name || !ALLOWED_USERS.includes(name)) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 401 });
  }

  try {
    const { blobs } = await list({ prefix: getUserBlobPath(name) });
    if (blobs.length === 0) {
      return NextResponse.json({ username: name, players: [] });
    }

    const res = await fetch(blobs[0].url);
    const players = await res.json();
    return NextResponse.json({ username: name, players });
  } catch (error) {
    console.error('Load user error:', error);
    return NextResponse.json({ username: name, players: [] });
  }
}

// POST /api/users — save a user's followed players
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, players } = body as { username: string; players: unknown[] };

    const name = username?.toLowerCase();
    if (!name || !ALLOWED_USERS.includes(name)) {
      return NextResponse.json({ error: 'Unknown user' }, { status: 401 });
    }

    // Delete existing blob for this user (if any)
    const { blobs } = await list({ prefix: getUserBlobPath(name) });
    for (const blob of blobs) {
      await del(blob.url);
    }

    // Write new blob
    await put(getUserBlobPath(name), JSON.stringify(players), {
      access: 'public',
      addRandomSuffix: false,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Save user error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
