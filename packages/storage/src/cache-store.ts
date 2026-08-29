import type { AssetPack, PackProgress } from './packs.js';

/** One cache per pack version, so superseding a version is a single delete. */
function cacheName(pack: AssetPack): string {
  return `sioditor-pack-${pack.id}-${pack.version}`;
}

/**
 * Stores a pack in Cache Storage, keyed by the URL it will later be requested from.
 *
 * This exists for payloads whose own loader insists on fetching by URL - Pyodide being
 * the case that forces it. The service worker answers those requests from here, so the
 * runtime never learns it is offline.
 */

/**
 * Rejects a response that is the app shell rather than the asset.
 *
 * A misconfigured server - or a dev server's SPA fallback - answers a missing asset with
 * 200 and index.html. Storing that produces a cache entry that looks fine and then fails
 * deep inside WebAssembly.compile or the Python loader, with nothing pointing at the
 * cause.
 */
function assertNotAppShell(url: string, response: Response): void {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('text/html')) {
    throw new Error(
      `${url} returned an HTML page rather than the asset - the server is falling back ` +
        'to index.html, or the file was never deployed',
    );
  }
}

export class CacheAssetStore {
  async isReady(pack: AssetPack): Promise<boolean> {
    if (!(await caches.has(cacheName(pack)))) return false;
    const cache = await caches.open(cacheName(pack));
    const matches = await Promise.all(
      pack.files.map(async (f) => (await cache.match(`${pack.baseUrl}/${f.name}`)) !== undefined),
    );
    return matches.every(Boolean);
  }

  async download(
    pack: AssetPack,
    onProgress: (progress: PackProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const totalEstimate = pack.files.reduce((sum, f) => sum + f.bytes, 0);

    if (await this.isReady(pack)) {
      onProgress({
        packId: pack.id,
        state: 'ready',
        receivedBytes: totalEstimate,
        totalBytes: totalEstimate,
      });
      return;
    }

    const cache = await caches.open(cacheName(pack));
    let totalBytes = totalEstimate;
    let receivedBytes = 0;

    const report = (state: PackProgress['state'], currentFile?: string, error?: string) => {
      onProgress({
        packId: pack.id,
        state,
        receivedBytes,
        totalBytes,
        ...(currentFile === undefined ? {} : { currentFile }),
        ...(error === undefined ? {} : { error }),
      });
    };

    report('downloading');

    try {
      for (const file of pack.files) {
        const url = `${pack.baseUrl}/${file.name}`;
        const response = await fetch(url, signal ? { signal } : {});
        if (!response.ok) {
          throw new Error(`${url} returned ${response.status} ${response.statusText}`);
        }
        assertNotAppShell(url, response);

        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > 0) {
          totalBytes += declared - file.bytes;
        }

        // Tee so we can count bytes without buffering the body twice: one branch feeds
        // the cache, the other drives the progress bar.
        const [toCache, toCount] = response.body!.tee();

        // Copying the response headers verbatim is wrong and fails in a way that is hard
        // to trace: `response.body` is already decoded, so a stored Content-Encoding of
        // gzip or br describes bytes that are no longer encoded. cache.match() still
        // finds such an entry - so availability checks pass - and only decoding it later
        // fails. Content-Length is stale for the same reason.
        const headers = new Headers();
        const contentType = response.headers.get('content-type');
        if (contentType) headers.set('content-type', contentType);
        const counting = (async () => {
          const reader = toCount.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedBytes += value.byteLength;
            report('downloading', file.name);
          }
        })();

        await cache.put(url, new Response(toCache, { headers }));
        await counting;
      }
      report('ready');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      report('failed', undefined, message);
      throw cause;
    }
  }

  async remove(pack: AssetPack): Promise<void> {
    await caches.delete(cacheName(pack));
  }
}
