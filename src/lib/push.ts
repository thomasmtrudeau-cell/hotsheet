import webpush from 'web-push';

// Web Push configuration. VAPID keys identify this app server to the browser
// push services. The public key is also exposed to the client via
// NEXT_PUBLIC_VAPID_PUBLIC_KEY (safe — it's public by design); the private key
// stays server-only. Dormant (helpers no-op) unless both keys are configured.
let configured = false;
export function pushConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:notifications@hotsheet.app', pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;   // collapses same-tag notifications on the device
  url?: string;   // where notificationclick navigates
}

// Sends one payload to one subscription. Returns 'gone' when the endpoint is
// dead (404/410) so the caller can prune it, 'ok' on success, 'error' otherwise.
export async function sendPush(
  subscription: webpush.PushSubscription,
  payload: PushPayload
): Promise<'ok' | 'gone' | 'error'> {
  if (!pushConfigured()) return 'error';
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600 });
    return 'ok';
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) return 'gone';
    console.error('push send error:', status ?? err);
    return 'error';
  }
}
