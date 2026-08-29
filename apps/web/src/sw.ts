/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// App shell only. The toolchain payloads are deliberately absent from this manifest -
// Workbox installs precached entries atomically and eagerly, so putting a hundred
// megabytes here would make first install fragile and re-download everything whenever
// a single asset hash changed.
precacheAndRoute(self.__WB_MANIFEST);

const PACK_PREFIXES = ['/pyodide/', '/toolchain/'];

const isPackRequest = (url: URL): boolean =>
  url.origin === self.location.origin && PACK_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));

/**
 * Serve pack files from whichever pack cache holds them.
 *
 * Pyodide's loader resolves its own siblings by URL and cannot be handed a file handle,
 * so those bytes live in Cache Storage rather than OPFS. Answering from here is what
 * makes `loadPyodide` work with the network gone.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!isPackRequest(url)) return;

  event.respondWith(
    (async () => {
      // caches.match searches every cache, including the per-pack ones the downloader
      // populated, so the service worker needs no knowledge of pack naming.
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      return fetch(event.request);
    })(),
  );
});

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
