/* Mesiraadio service worker */
const CACHE = 'mesiraadio-v1';
const SHELL = ['./', 'world.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  /* ainult sama päritolu GET; striimid, fondid jm lähevad otse võrku */
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isShell = e.request.mode === 'navigate' ||
    SHELL.some(p => url.pathname.endsWith(p.replace('./','/')) || (p === './' && (url.pathname === '/' || url.pathname.endsWith('/index.html'))));
  if (!isShell) return;
  /* võrk ees (värskendused jõuavad kohale), vahemälu varuks (offline) */
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() =>
      caches.match(e.request, {ignoreSearch: true}).then(m => m || caches.match('./'))
    )
  );
});
