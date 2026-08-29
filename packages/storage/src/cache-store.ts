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

        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > 0) {
          totalBytes += declared - file.bytes;
        }

        // Tee so we can count bytes without buffering the body twice: one branch feeds
        // the cache, the other drives the progress bar.
        const [toCache, toCount] = response.body!.tee();
        const counting = (async () => {
          const reader = toCount.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedBytes += value.byteLength;
            report('downloading', file.name);
          }
        })();

        await cache.put(url, new Response(toCache, { headers: response.headers }));
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
