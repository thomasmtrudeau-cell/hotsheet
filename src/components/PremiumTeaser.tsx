'use client';

import { useState } from 'react';

// Shown to regular (non-premium) users where a premium feature would live. It
// advertises the ScoutTheStatline data layer + the premium tools without exposing
// any of it. Context-aware: the headline/lead and the top feature match the tab
// the user is looking at (Trade, Regression, Scouting, …).
export type TeaserContext = 'trade' | 'regression' | 'scouting' | 'risers' | 'projections' | 'callups' | 'promotions' | 'trends' | 'default';

interface Feature { key: string; label: string; blurb: string }

const FEATURES: Feature[] = [
  { key: 'trade', label: 'Trade Checker', blurb: 'Value any trade for both sides — win-now (PV) and keeper (FV) — tuned to your league (teams, keepers, format, roster slots), with injury, playing-time, park and free-agent-fill adjustments baked in.' },
  { key: 'regression', label: 'SP Regression — sell-high / buy-low', blurb: 'Starters whose peak true-talent ERA/20 has drifted from their actual current-year ERA (live MLB + every MiLB level), with IL status and rotation-vs-bullpen role.' },
  { key: 'scouting', label: 'Scouting board', blurb: 'Every projected player by peak WAR, filter by level from the majors down to rookie ball — surface 2+ WAR prospects before they pop.' },
  { key: 'risers', label: 'Prospect Risers', blurb: 'A live board of whose peak projection is climbing fastest — before the industry catches on. Pick your window (7 / 14 / 30 days).' },
  { key: 'trends', label: 'WAR Trends', blurb: 'Chart any player\u2019s peak-WAR projection over time — spot risers and faders the moment the projection moves, and compare up to 8 players.' },
  { key: 'callups', label: 'Call-Ups feed', blurb: 'Every MLB call-up of the last 7 days with peak WAR and rate grades attached — know instantly which debuts matter for your league.' },
  { key: 'promotions', label: 'Promotions feed', blurb: 'Every MiLB level-jump of the last 7 days, graded — catch the org moves that signal a prospect is arriving ahead of schedule.' },
  { key: 'projections', label: 'Weekly projections', blurb: 'Rest-of-season and weekly-rank projections layered onto the players you follow.' },
  { key: 'war', label: 'Peak WAR, wRC+ & ERA/20', blurb: 'Forward-looking value + rate grades for every hitter and pitcher, majors through the low minors — plus speed / power / dual-threat and defense tool tags on every card.' },
];

const HEADS: Record<TeaserContext, { title: string; lead: string; top: string }> = {
  trade: { title: 'Trade Checker — premium · experimental', lead: 'Grade any trade for both sides, tuned to your exact league. Powered by proprietary projections from', top: 'trade' },
  regression: { title: 'SP Regression — premium', lead: 'Find sell-high and buy-low starters by comparing true-talent to actual results. Powered by proprietary projections from', top: 'regression' },
  scouting: { title: 'Scouting board — premium', lead: 'Scout every projected player by peak WAR and level, majors through rookie ball. Powered by proprietary projections from', top: 'scouting' },
  risers: { title: 'Prospect Risers — premium', lead: 'Catch the players whose projection is climbing fastest. Powered by proprietary projections from', top: 'risers' },
  projections: { title: 'Weekly projections — premium', lead: 'Rest-of-season and weekly-rank projections on the players you follow. Powered by proprietary projections from', top: 'projections' },
  trends: { title: 'WAR Trends — premium', lead: 'Chart projection movement over time and catch breakouts early. Powered by proprietary projections from', top: 'trends' },
  callups: { title: 'Call-Ups — premium', lead: 'Every MLB call-up of the last week, with value grades attached. Powered by proprietary projections from', top: 'callups' },
  promotions: { title: 'Promotions — premium', lead: 'Every MiLB level-jump of the last week, graded. Powered by proprietary projections from', top: 'promotions' },
  default: { title: 'Scouting intelligence, built in', lead: 'Forward-looking grades layered onto the players you already follow. Powered by proprietary projections from', top: 'war' },
};

// Kick off Stripe checkout. Gracefully degrades: 503 = billing not configured
// yet (fall back to the email CTA), 401 = needs sign-in.
async function startCheckout(plan: 'monthly' | 'yearly', setMsg: (m: string) => void) {
  setMsg('');
  try {
    const ref = localStorage.getItem('hotsheet_ref') ?? undefined;
    const res = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, ref }) });
    const d = await res.json();
    if (res.ok && d?.url) { window.location.href = d.url; return; }
    if (res.status === 401) setMsg('Sign in first, then subscribe.');
    else if (res.status === 503) setMsg('Subscriptions are almost ready — email us below and we\u2019ll flip it on for you the day they open.');
    else setMsg('Something went wrong starting checkout — try again or email us below.');
  } catch { setMsg('Something went wrong starting checkout — try again or email us below.'); }
}

export default function PremiumTeaser({ context = 'default' }: { context?: TeaserContext }) {
  const [msg, setMsg] = useState('');
  const head = HEADS[context];
  // Lead with the context's own feature, then the rest.
  const ordered = [...FEATURES].sort((a, b) => (a.key === head.top ? -1 : b.key === head.top ? 1 : 0));

  return (
    <div className="max-w-xl mx-auto text-center py-10 px-4">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold mb-4">
        <span>🚀</span> Premium preview
      </div>
      <h2 className="text-xl font-bold text-zinc-100 mb-2">{head.title}</h2>
      <p className="text-sm text-zinc-400 leading-relaxed mb-6">
        {head.lead}{' '}
        <span className="text-amber-300 font-medium">ScoutTheStatline.com</span> — not live for everyone yet,
        but it could open up if there’s enough interest.
      </p>

      <div className="text-left space-y-2.5 mb-7">
        {ordered.map((f, i) => (
          <div key={f.key} className={`flex gap-2.5 px-3 py-2.5 rounded-lg border ${i === 0 && context !== 'default' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-800/50 border-zinc-700/40'}`}>
            <span className="text-amber-400 mt-0.5 shrink-0">✦</span>
            <div>
              <div className="text-sm font-semibold text-zinc-100">{f.label}</div>
              <div className="text-[12px] text-zinc-400 leading-snug">{f.blurb}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 justify-center mb-3">
        <button onClick={() => startCheckout('monthly', setMsg)}
          className="px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold cursor-pointer">
          $19.99 / month <span className="block text-[11px] font-normal opacity-80">cancel anytime — access through your billing month</span>
        </button>
        <button onClick={() => startCheckout('yearly', setMsg)}
          className="px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-amber-500/40 text-amber-200 text-sm font-semibold cursor-pointer">
          $149.99 / year <span className="block text-[11px] font-normal opacity-80">~37% off — two months+ free</span>
        </button>
      </div>
      {msg && <p className="text-[12px] text-amber-300/90 mb-2">{msg}</p>}
      <p className="text-[11px] text-zinc-500">Have a referral code? Enter it at checkout for 20% off your first payment.</p>
      <div className="text-[12px] text-zinc-500 mt-3">
        Questions?{' '}
        <a href="mailto:ThomasMTrudeau@gmail.com?subject=Hot%20Sheet%20premium" className="text-amber-300/90 hover:text-amber-200 underline underline-offset-2">ThomasMTrudeau@gmail.com</a>
      </div>
    </div>
  );
}
