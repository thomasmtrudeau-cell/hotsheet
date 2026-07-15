'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Background push opt-in: registers the service worker, subscribes/unsubscribes,
// and (on iOS) explains the add-to-home-screen requirement. Renders nothing on
// browsers with no push support.
export default function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    if (!ok) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => reg.pushManager.getSubscription())
      // eslint-disable-next-line react-hooks/set-state-in-effect
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const subscribe = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setStatus('Notifications are blocked in your browser settings.'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as BufferSource,
      });
      const res = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: JSON.parse(JSON.stringify(sub)) }),
      });
      if (!res.ok) throw new Error('save failed');
      setSubscribed(true); setStatus('On — you\'ll get alerts even with the app closed.');
    } catch {
      setStatus('Couldn\'t enable notifications. Try again.');
    } finally { setBusy(false); }
  }, []);

  const unsubscribe = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false); setStatus('Off.');
    } catch {
      setStatus('Couldn\'t turn off. Try again.');
    } finally { setBusy(false); }
  }, []);

  const sendTest = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      setStatus(res.ok ? 'Test sent — check your notifications.' : 'Test failed.');
    } catch { setStatus('Test failed.'); }
    finally { setBusy(false); }
  }, []);

  if (!supported) return null;
  const needsInstall = isIOS && !isStandalone;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Background notifications"
        className={`text-sm px-2 py-1 rounded-full border transition-colors cursor-pointer ${
          subscribed ? 'border-orange-500/50 text-orange-300 bg-orange-500/10' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
        }`}
      >
        {subscribed ? '🔔' : '🔕'}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3 text-left">
          <div className="text-xs font-semibold text-zinc-200 mb-1">Background alerts</div>
          <p className="text-[11px] text-zinc-500 mb-2">Call-ups, IL moves, and roster changes for your players — pushed even when Hot Sheet is closed.</p>
          <p className="text-[11px] text-zinc-400 mb-2">Your alerts always collect in the <strong>🔔 bell</strong> here in the app either way — this toggle only adds system pop-ups for when the tab is closed.</p>
          {needsInstall ? (
            <p className="text-[11px] text-amber-300/90 leading-relaxed">
              On iPhone/iPad, first add Hot Sheet to your home screen: tap the Share button <span aria-hidden>⎋</span>, then <strong>Add to Home Screen</strong>. Open it from there to enable notifications.
            </p>
          ) : subscribed ? (
            <div className="flex flex-col gap-1.5">
              <button disabled={busy} onClick={sendTest} className="text-[11px] px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer disabled:opacity-50">Send test notification</button>
              <button disabled={busy} onClick={unsubscribe} className="text-[11px] px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-red-300 cursor-pointer disabled:opacity-50">Turn off</button>
            </div>
          ) : (
            <button disabled={busy} onClick={subscribe} className="w-full text-[11px] px-2 py-1.5 rounded bg-orange-600 hover:bg-orange-500 text-white font-semibold cursor-pointer disabled:opacity-50">
              {busy ? 'Enabling…' : 'Enable notifications'}
            </button>
          )}
          {status && <p className="text-[10px] text-zinc-400 mt-2">{status}</p>}
        </div>
      )}
    </div>
  );
}
