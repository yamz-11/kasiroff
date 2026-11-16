// public/sw.js — service worker sederhana tanpa library.
// Naikkan nilai V setiap kali deploy versi baru agar cache disiapkan ulang.
const V = 'v2';
const STATIC = 'kasir-static-' + V;
const PAGES = 'kasir-pages-' + V;
const PRECACHE_PAGES = ['/', '/pos', '/dashboard'];

// Simpan halaman + semua file JS/CSS yang dirujuk HTML-nya, supaya bisa dibuka offline sejak pertama
async function warm() {
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  const assets = new Set();
  for (const url of PRECACHE_PAGES) {
    const res = await fetch(url, { cache: 'reload' });
    await pages.put(url, res.clone());
    const html = await res.text();
    for (const m of html.matchAll(/(?:\/_next\/)?(static\/(?:chunks|css|media)\/[^"'\\\s)]+)/g)) {
      assets.add('/_next/' + m[1]);
    }
  }
  await Promise.all([...assets].map((a) => statics.add(a).catch(() => {})));
}

self.addEventListener('install', (e) => {
  e.waitUntil(warm().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(V)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase dll. tidak disentuh
  if (url.searchParams.has('_rsc')) return;                                // navigasi client: biar Next yang urus

  if (url.pathname.startsWith('/_next/static/') || /\.(?:png|svg|ico|webp|woff2?)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
  } else {
    e.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(reject, 4000)), // koneksi buruk -> pakai cache
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (
      (await cache.match(req)) ||
      (req.mode === 'navigate' ? await cache.match('/') : undefined) ||
      Response.error()
    );
  }
}
