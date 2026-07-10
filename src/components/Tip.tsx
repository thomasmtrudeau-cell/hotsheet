'use client';

import { useState, useEffect } from 'react';

// First-run explainer tips. Each tip has a stable `id`. Users can dismiss a tip
// for now (✕ — comes back next visit) or forever ("Don't show again" — stored in
// localStorage). Rendered nothing-until-mounted to avoid hydration mismatch.

const SESSION_DISMISSED = new Set<string>(); // "hide for now" — resets on reload
const permKey = (id: string) => `hotsheet_tip_${id}`;

// Let users re-enable all tips (used by a "Reset tips" affordance if we add one).
export function resetAllTips() {
  if (typeof window === 'undefined') return;
  Object.keys(localStorage)
    .filter((k) => k.startsWith('hotsheet_tip_'))
    .forEach((k) => localStorage.removeItem(k));
  SESSION_DISMISSED.clear();
}

// Rotating "did you know" bar: shows ONE tip at a time from a pool, cycling a
// different one each visit. ✕ hides the bar for this session; "Next" advances to
// another tip now; "Don't show again" permanently retires the current tip.
export function TipRotator({ tips, className = '' }: {
  tips: { id: string; node: React.ReactNode }[];
  className?: string;
}) {
  const [state, setState] = useState<{ mounted: boolean; dismissed: Set<string>; cursor: number }>(
    { mounted: false, dismissed: new Set(), cursor: 0 }
  );
  const [sessionHidden, setSessionHidden] = useState(false);

  useEffect(() => {
    const perm = new Set<string>();
    for (const t of tips) if (localStorage.getItem(permKey(t.id)) === '1') perm.add(t.id);
    const rot = parseInt(localStorage.getItem('hotsheet_tip_rot') || '0', 10) || 0;
    localStorage.setItem('hotsheet_tip_rot', String(rot + 1));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ mounted: true, dismissed: perm, cursor: rot });
  }, [tips]);

  if (!state.mounted || sessionHidden) return null;
  const available = tips.filter((t) => !state.dismissed.has(t.id));
  if (available.length === 0) return null;
  const current = available[state.cursor % available.length];

  const dontShow = () => setState((s) => {
    localStorage.setItem(permKey(current.id), '1');
    const dismissed = new Set(s.dismissed); dismissed.add(current.id);
    return { ...s, dismissed };
  });

  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/25 text-[12px] text-blue-100/90 ${className}`}>
      <span className="shrink-0 mt-px">💡</span>
      <div className="flex-1 leading-snug">{current.node}</div>
      <div className="flex items-center gap-2 shrink-0">
        {available.length > 1 && (
          <button
            onClick={() => setState((s) => ({ ...s, cursor: s.cursor + 1 }))}
            className="text-[10px] text-blue-300/70 hover:text-blue-200 cursor-pointer whitespace-nowrap"
            title="Show another tip"
          >
            Next ›
          </button>
        )}
        <button
          onClick={dontShow}
          className="text-[10px] text-blue-300/70 hover:text-blue-200 underline underline-offset-2 cursor-pointer whitespace-nowrap"
          title="Never show this tip again"
        >
          Don&apos;t show again
        </button>
        <button
          onClick={() => setSessionHidden(true)}
          className="text-blue-300/70 hover:text-blue-100 cursor-pointer leading-none"
          title="Hide tips for now"
          aria-label="Hide tips for now"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function Tip({ id, children, className = '' }: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (SESSION_DISMISSED.has(id)) return;
    if (localStorage.getItem(permKey(id)) === '1') return;
    // Post-hydration sync with localStorage (a client-only source); initial
    // render is hidden on both server and client, so there's no mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
  }, [id]);

  if (!visible) return null;

  const hideForNow = () => { SESSION_DISMISSED.add(id); setVisible(false); };
  const hideForever = () => { localStorage.setItem(permKey(id), '1'); setVisible(false); };

  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/25 text-[12px] text-blue-100/90 ${className}`}>
      <span className="shrink-0 mt-px">💡</span>
      <div className="flex-1 leading-snug">{children}</div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={hideForever}
          className="text-[10px] text-blue-300/70 hover:text-blue-200 underline underline-offset-2 cursor-pointer whitespace-nowrap"
          title="Never show this tip again"
        >
          Don&apos;t show again
        </button>
        <button
          onClick={hideForNow}
          className="text-blue-300/70 hover:text-blue-100 cursor-pointer leading-none"
          title="Hide for now"
          aria-label="Hide for now"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
