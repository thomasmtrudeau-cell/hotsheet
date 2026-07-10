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
