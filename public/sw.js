'use strict';

// Service Worker de l'arrière-boutique L'Hair Afro (PWA installable).
// Rôle minimal et sûr : rendre l'appli installable + servir la coquille hors
// ligne. L'API n'est JAMAIS mise en cache (données toujours fraîches).

const CACHE = 'lha-admin-v2';
const SHELL = [
  '/admin',
  '/manifest.webmanifest',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // POST/PUT/… : réseau direct
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tiers : on ne touche pas
  if (url.pathname.startsWith('/api/')) return; // API : toujours réseau, jamais cache

  // Navigations (ouverture de l'appli) : réseau d'abord, repli sur la coquille.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/admin')));
    return;
  }
  // Autres GET (icônes, manifest) : cache d'abord, sinon réseau.
  e.respondWith(caches.match(req).then((c) => c || fetch(req)));
});
