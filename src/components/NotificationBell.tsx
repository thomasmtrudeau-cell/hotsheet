'use client';

import { useEffect, useRef, useState } from 'react';
import { HotNotification, NOTIFICATION_STYLE } from '@/lib/notifications';

interface NotificationBellProps {
  notifications: HotNotification[];
  onOpen: () => void; // mark-all-read
  onClear: () => void;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export default function NotificationBell({ notifications, onOpen, onClear }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) onOpen();
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={toggle}
        className="relative p-2 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        title="Notifications"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 max-w-[calc(100vw-1.5rem)] bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-700">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Notifications
            </span>
            {notifications.length > 0 && (
              <button
                onClick={onClear}
                className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-sm text-zinc-500 text-center">
                No roster moves yet — promotions, demotions and IL changes for your players show up here.
              </div>
            ) : (
              notifications.map((n) => {
                const style = NOTIFICATION_STYLE[n.type];
                return (
                  <div
                    key={n.id}
                    className={`px-4 py-2.5 border-b border-zinc-700/50 last:border-0 ${
                      n.read ? '' : 'bg-blue-500/5'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="text-base leading-5">{style.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-zinc-100">{n.playerName}</div>
                        <div className={`text-xs ${style.color}`}>{n.message}</div>
                        <div className="text-[10px] text-zinc-600 mt-0.5">{timeAgo(n.createdAt)}</div>
                      </div>
                      {!n.read && <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-blue-500 shrink-0" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
