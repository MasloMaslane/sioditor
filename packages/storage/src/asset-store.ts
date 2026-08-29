import type { AssetPack, PackProgress } from './packs.js';

/**
 * Stores large toolchain payloads in the Origin Private File System.
 *
 * OPFS rather than the Cache API because a compiler needs random access into a sysroot,
 * pays no structured-clone tax on binary data, and writes large blobs an order of
 * magnitude faster. The Cache API stays where it belongs: the service worker's app shell.
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

export class AssetStore {
  private rootPromise: Promise<FileSystemDirectoryHandle> | undefined;

  private root(): Promise<FileSystemDirectoryHandle> {
    this.rootPromise ??= navigator.storage.getDirectory();
    return this.rootPromise;
  }

  /** Versioned so bumping a pack's version orphans the old copy rather than mixing them. */
  private async packDir(pack: AssetPack, create: boolean): Promise<FileSystemDirectoryHandle> {
    const root = await this.root();
    const packs = await root.getDirectoryHandle('packs', { create });
    return packs.getDirectoryHandle(`${pack.id}@${pack.version}`, { create });
  }

  async isReady(pack: AssetPack): Promise<boolean> {
    try {
      const dir = await this.packDir(pack, false);
      // A marker file, written last, is what makes a pack "ready". Checking the files
      // themselves would accept a download interrupted midway through the final write.
      await dir.getFileHandle('.complete', { create: false });
      return true;
    } catch {
      return false;
    }
  }

  async read(pack: AssetPack, name: string): Promise<Uint8Array> {
    const dir = await this.packDir(pack, false);
    const handle = await dir.getFileHandle(name, { create: false });
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  /**
   * Fetches every file in the pack into OPFS, reporting progress as it goes.
   *
   * Streamed rather than buffered: these payloads are tens of megabytes and holding one
   * in the JS heap before writing it defeats the point of using OPFS at all.
   */
  async download(
    pack: AssetPack,
    onProgress: (progress: PackProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (await this.isReady(pack)) {
      const total = pack.files.reduce((sum, f) => sum + f.bytes, 0);
      onProgress({ packId: pack.id, state: 'ready', receivedBytes: total, totalBytes: total });
      return;
    }

    const dir = await this.packDir(pack, true);
    let totalBytes = pack.files.reduce((sum, f) => sum + f.bytes, 0);
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

        // Trust the server's own number over our estimate when it gives one. With
        // build-time brotli the header reflects the decoded length, which is what we want.
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > 0) {
          totalBytes += declared - file.bytes;
        }

        const handle = await dir.getFileHandle(file.name, { create: true });
        const writable = await handle.createWritable();
        try {
          const body = response.body;
          if (!body) throw new Error(`${url} returned no body`);
          const reader = body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
            receivedBytes += value.byteLength;
            report('downloading', file.name);
          }
        } finally {
          await writable.close();
        }
      }

      // Written last, on purpose: see isReady.
      const marker = await dir.getFileHandle('.complete', { create: true });
      const writable = await marker.createWritable();
      await writable.write(new TextEncoder().encode(new Date().toISOString()));
      await writable.close();

      report('ready');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      report('failed', undefined, message);
      throw cause;
    }
  }

  /** Frees a pack's bytes. Used by the storage panel and when a version is superseded. */
  async remove(pack: AssetPack): Promise<void> {
    const root = await this.root();
    try {
      const packs = await root.getDirectoryHandle('packs', { create: false });
      await packs.removeEntry(`${pack.id}@${pack.version}`, { recursive: true });
    } catch {
      // Already gone: removing an absent pack is not an error worth surfacing.
    }
  }
}
