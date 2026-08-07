'use client';

import { useEffect, useRef, useState } from 'react';

interface OopsyStatus {
  capturedAt: string;
  lastChange?: { at: string; warMoved: number; newPlayers: number; topMovers: { name: string; from?: number; to?: number }[] };
}

// OOPSY data-freshness badge (header, admin/premium — the server decides who
// sees data; we render nothing on a 204). Shows when the sheet's numbers last
// actually CHANGED (not just when we re-fetched them); click for the detail:
// last capture time, how many WARs moved, top movers.
export default function OopsyBadge() {
  const [meta, setMeta] = useState<(OopsyStatus & { fetchedNow: number }) | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch('/api/oopsy/status')
      .then((r) => (r.status === 200 ? r.json() : null))
      .then((d: OopsyStatus | null) => setMeta(d && { ...d, fetchedNow: Date.now() }))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!meta?.capturedAt) return null;
  // Anchor "ago" labels to the fetch moment (render must stay pure; a badge
  // that's minutes stale is fine at this granularity).
  const rel = (iso: string) => {
    const h = (meta.fetchedNow - Date.parse(iso)) / 3_600_000;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
    return h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  };
  const titleCase = (n: string) => n.replace(/\b\w/g, (ch) => ch.toUpperCase());
  const c = meta.lastChange;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] px-2 py-1 rounded-full border border-sky-500/40 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 transition-colors cursor-pointer"
        title="OOPSY freshness — when the sheet's numbers last changed (tap for detail)"
      >
        Δ {c ? `${rel(c.at)}` : '—'}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-50 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-[11px] text-zinc-300 shadow-xl">
          <div className="font-semibold text-sky-300 mb-1">OOPSY data</div>
          <div><span className="text-zinc-500">Numbers last changed:</span> {c ? `${rel(c.at)} ago` : 'no change observed yet'}</div>
          <div><span className="text-zinc-500">Last checked:</span> {rel(meta.capturedAt)} ago</div>
          {c && (
            <div className="mt-1">
              <span className="text-zinc-500">That update:</span> WAR moved for {c.warMoved} player{c.warMoved === 1 ? '' : 's'}
              {c.newPlayers > 0 ? ` · ${c.newPlayers} new` : ''}
            </div>
          )}
          {c && c.topMovers.length > 0 && (
            <div className="mt-1.5">
              <div className="text-zinc-500 mb-0.5">Top WAR movers</div>
              {c.topMovers.map((mv) => (
                <div key={mv.name} className="flex justify-between gap-2">
                  <span className="truncate">{titleCase(mv.name)}</span>
                  <span className="text-zinc-500 shrink-0">{(mv.from ?? 0).toFixed(1)} → {(mv.to ?? 0).toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
