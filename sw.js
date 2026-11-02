// Service worker: офлајн рад. Нова верзија се активира тек кад корисник кликне „Освјежи“.
const VERSION = '1.2.0';
const CACHE = 'zk-' + VERSION;
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'rates.json', 'Pregled_stopa_CBCG.html',
  'js/app.js', 'js/engine.js', 'js/rational.js', 'js/dates.js', 'js/parse.js', 'js/storage.js', 'js/rates.js',
  'js/serialize.js', 'js/i18n.js', 'js/stats.js', 'js/xlsx-export.js', 'lib/exceljs.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'css/fonts.css',
  'fonts/golos-text-cyrillic-400-normal.woff2',
  'fonts/golos-text-cyrillic-500-normal.woff2',
  'fonts/golos-text-cyrillic-600-normal.woff2',
  'fonts/golos-text-latin-400-normal.woff2',
  'fonts/golos-text-latin-500-normal.woff2',
  'fonts/golos-text-latin-600-normal.woff2',
  'fonts/golos-text-latin-ext-400-normal.woff2',
  'fonts/golos-text-latin-ext-500-normal.woff2',
  'fonts/golos-text-latin-ext-600-normal.woff2',
  'fonts/literata-cyrillic-500-normal.woff2',
  'fonts/literata-cyrillic-600-normal.woff2',
  'fonts/literata-latin-500-normal.woff2',
  'fonts/literata-latin-600-normal.woff2',
  'fonts/literata-latin-ext-500-normal.woff2',
  'fonts/literata-latin-ext-600-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('zk-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    const cl = await self.clients.matchAll();
    cl.forEach(c => c.postMessage({ type: 'cached', version: VERSION }));
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // спољни извори (ЦБЦГ, одлуке) иду директно на мрежу
  if (url.searchParams.has('check')) return; // провјера ажурирања стопа увијек са мреже
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      throw err;
    }
  })());
});
