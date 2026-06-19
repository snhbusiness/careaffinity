// Chloé Domicile — service worker (notifications push + auto-update)
// 🔁 Pour forcer une mise à jour de l'app installée : change ce numéro de version.
const VERSION = '2026-06-14-21';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: 'Chloé Domicile', body: 'Nouvelle activité' }; }
  const title = data.title || 'Chloé Domicile';
  const options = {
    body: data.body || '',
    icon: 'icon-512.png',
    badge: 'icon-512.png',
    data: { url: data.url || 'admin.html' },
    vibrate: [120, 60, 120]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || 'admin.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
