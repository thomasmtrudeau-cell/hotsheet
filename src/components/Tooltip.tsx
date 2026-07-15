'use client';

import { ReactNode } from 'react';

// Instant hover tooltip (native `title` has a ~1s browser delay). Pure CSS
// group-hover so it appears immediately on hover/focus. Keep content short.
export default function Tooltip({ children, text, className = '' }: { children: ReactNode; text: string; className?: string }) {
  return (
    <span className={`relative group/tt inline-flex ${className}`} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 normal-case tracking-normal whitespace-pre-line rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-normal leading-snug text-zinc-200 shadow-xl opacity-0 scale-95 transition-[opacity,transform] duration-75 group-hover/tt:opacity-100 group-hover/tt:scale-100 group-focus/tt:opacity-100 group-focus/tt:scale-100 min-w-[10rem] max-w-[16rem] text-left"
      >
        {text}
      </span>
    </span>
  );
}
