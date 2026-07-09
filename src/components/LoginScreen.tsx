'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginScreen({ authError }: { authError?: boolean }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(authError ? 'Sign-in failed — please try again.' : '');
  const [loading, setLoading] = useState<'magic' | 'google' | null>(null);

  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined;

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr) return;
    setLoading('magic');
    setError('');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: redirectTo },
    });
    setLoading(null);
    if (error) setError(error.message);
    else setSent(true);
  };

  const signInWithGoogle = async () => {
    setLoading('google');
    setError('');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    }
    // On success the browser redirects to Google, so no further state needed.
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <h1 className="text-2xl font-bold text-zinc-100 mb-1 text-center">Hot Sheet</h1>
        <p className="text-sm text-zinc-500 mb-8 text-center">
          Track live MLB, MiLB, NPB &amp; KBO player stats
        </p>

        {sent ? (
          <div className="text-center space-y-3">
            <div className="text-3xl">📬</div>
            <p className="text-sm text-zinc-300">Check your email</p>
            <p className="text-xs text-zinc-500">
              We sent a sign-in link to <span className="text-zinc-400">{email.trim().toLowerCase()}</span>.
              Open it on this device to continue.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(''); }}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={signInWithGoogle}
              disabled={loading !== null}
              className="w-full py-3 bg-white hover:bg-zinc-100 text-zinc-900 font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 4.75 12 4.75Z" />
              </svg>
              {loading === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <div className="flex items-center gap-3">
              <div className="h-px bg-zinc-800 flex-1" />
              <span className="text-[11px] text-zinc-600 uppercase tracking-wider">or</span>
              <div className="h-px bg-zinc-800 flex-1" />
            </div>

            <form onSubmit={sendMagicLink} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                placeholder="you@email.com"
                autoFocus
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-center"
              />
              <button
                type="submit"
                disabled={loading !== null}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {loading === 'magic' ? 'Sending…' : 'Email me a sign-in link'}
              </button>
              <p className="text-[11px] text-zinc-500 text-center">
                Email links are limited and can be slow — <span className="text-zinc-400">Google sign-in is fastest &amp; most reliable</span>.
              </p>
            </form>

            {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
