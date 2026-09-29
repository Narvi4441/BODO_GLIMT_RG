// PWA en línea: sin caché ni soporte offline en este MVP.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
