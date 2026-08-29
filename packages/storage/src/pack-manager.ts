import { AssetStore } from './asset-store.js';
import { CacheAssetStore } from './cache-store.js';
import type { AssetPack, PackProgress } from './packs.js';
import { PACKS } from './packs.js';

/**
 * One entry point for pack availability, dispatching to whichever store a pack needs.
 * Callers should not have to know or care that Pyodide lives in Cache Storage and clang
 * lives in OPFS.
 */
export class PackManager {
  readonly opfs = new AssetStore();
  readonly cache = new CacheAssetStore();

  private store(pack: AssetPack): AssetStore | CacheAssetStore {
    return pack.storage === 'opfs' ? this.opfs : this.cache;
  }

  isReady(pack: AssetPack): Promise<boolean> {
    return this.store(pack).isReady(pack);
  }

  download(
    pack: AssetPack,
    onProgress: (progress: PackProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.store(pack).download(pack, onProgress, signal);
  }

  remove(pack: AssetPack): Promise<void> {
    return this.store(pack).remove(pack);
  }

  async states(): Promise<Map<string, boolean>> {
    const entries = await Promise.all(
      PACKS.map(async (pack) => [pack.id, await this.isReady(pack)] as const),
    );
    return new Map(entries);
  }
}
