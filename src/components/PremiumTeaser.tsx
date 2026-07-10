'use client';

// Shown to regular (non-premium) users where a premium feature would live.
// It advertises the ScoutTheStatline data layer without exposing any of it, and
// frames premium as something that could open up if there's enough interest.
export default function PremiumTeaser() {
  const features: { label: string; blurb: string }[] = [
    {
      label: 'Prospect Risers board',
      blurb: 'A live leaderboard of the players whose peak projection is climbing fastest — before the industry catches on. Pick your window (7 / 14 / 30 days).',
    },
    {
      label: 'Peak WAR',
      blurb: 'A single forward-looking value grade for every hitter and pitcher, majors through the low minors.',
    },
    {
      label: 'Peak wRC+',
      blurb: 'Where a hitter’s bat projects to peak, on the same 100-is-average scale you already read.',
    },
    {
      label: 'ERA / 20 TBF',
      blurb: 'A rate-stable run-prevention grade for pitchers that holds up across small samples and level changes.',
    },
  ];

  return (
    <div className="max-w-xl mx-auto text-center py-10 px-4">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold mb-4">
        <span>🚀</span> Premium preview
      </div>
      <h2 className="text-xl font-bold text-zinc-100 mb-2">Scouting intelligence, built in</h2>
      <p className="text-sm text-zinc-400 leading-relaxed mb-6">
        These are upcoming premium features powered by proprietary projections from{' '}
        <span className="text-amber-300 font-medium">ScoutTheStatline.com</span> — the same forward-looking
        grades used to evaluate talent, layered right onto the players you already follow. They’re not
        live for everyone yet, but they could open up if there’s enough interest.
      </p>

      <div className="text-left space-y-2.5 mb-7">
        {features.map((f) => (
          <div key={f.label} className="flex gap-2.5 px-3 py-2.5 bg-zinc-800/50 border border-zinc-700/40 rounded-lg">
            <span className="text-amber-400 mt-0.5 shrink-0">✦</span>
            <div>
              <div className="text-sm font-semibold text-zinc-100">{f.label}</div>
              <div className="text-[12px] text-zinc-400 leading-snug">{f.blurb}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-sm text-zinc-400">
        Want in, or want to learn more?{' '}
        <a
          href="mailto:ThomasMTrudeau@gmail.com?subject=Hot%20Sheet%20premium%20interest"
          className="text-amber-300 font-medium hover:text-amber-200 underline underline-offset-2"
        >
          ThomasMTrudeau@gmail.com
        </a>
      </div>
      <p className="text-[11px] text-zinc-600 mt-2">Tell us which metric you’d use most — demand decides what ships.</p>
    </div>
  );
}
