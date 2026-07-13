// Hot Sheet service worker — handles background Web Push delivery and clicks.
// No offline caching (kept deliberately minimal); its only job is notifications.
self.addEventListener('push', function (event) {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: '🔥 Hot Sheet', body: event.data.text() };
  }
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge.png',
    tag: data.tag,            // same tag collapses onto one notification
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(data.title || '🔥 Hot Sheet', options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // Focus an already-open tab if we have one, otherwise open a new window.
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
