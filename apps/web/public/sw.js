/* Chheda staff share – service worker: web push + notification click. No offline caching of rate data (never show an old rate). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let data = { title: 'Chheda Jewellers', body: 'Open the staff app.', url: '/staff' };
  try { data = { ...data, ...event.data.json() }; } catch { /* plain text */ if (event.data) data.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: data.tag, renotify: true, data: { url: data.url } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/staff', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url === url && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
