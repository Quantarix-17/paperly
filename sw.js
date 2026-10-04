// PaperLy — service worker (app shell offline cache).
// Code update dile CACHE_VERSION ta bodle din (v1 -> v2), tahole purono cache muche jabe.
const CACHE_VERSION = 'v6';
const SHELL_CACHE = 'shell-' + CACHE_VERSION;
const LIB_CACHE = 'libs-' + CACHE_VERSION;

const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest', './icons/tamim.png', './pwa.js',
  './css/styles.css',
  './js/config.js', './js/constants.js', './js/ui-helpers.js', './js/tab-manager.js',
  './js/ai-models.js', './js/command-menu.js', './js/math-renderer.js',
  './js/document-editor.js', './js/ocr.js', './js/pdf-export.js',
  './js/diagram-library.js', './js/chart-library.js', './js/illustration-library.js',
  './js/element-library.js', './js/slide-studio.js', './js/word-export.js', './js/app.js',
  './js/firebase-config.js', './js/paperly-vault.js', './js/paperly-cloud.js'
];

// Shudhu ei CDN gulo cache hobe (library/font). AI API call kokhono cache hoy na.
const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
  'www.gstatic.com'];   // Firebase JS SDK modules (so a signed-in user can still open the app offline)

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // ekta file na thakleo install jeno fail na kore
      Promise.all(SHELL_FILES.map(f => cache.add(f).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== LIB_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache the connectivity ping (pwa.js) and never touch Firebase Hosting auth-handler paths.
  if (url.pathname.indexOf('generate_204') !== -1 || url.pathname.indexOf('/__/') === 0) return;

  // App shell: prottek launch-e hard refresh (network-first), offline hole cache theke
  if (url.origin === self.location.origin) {
    event.respondWith(
      // cache:'reload' = hard refresh: browser-er HTTP cache bypass kore sorasori server theke ane
      fetch(new Request(req.url, { cache: 'reload', credentials: 'same-origin' })).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }

  // CDN library/font: cache-first
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(LIB_CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
  // baki sob (AI API ityadi) — sorasori network, kono cache na
});