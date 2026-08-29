import { useCallback, useEffect, useState } from 'react';
import {
  estimateStorage,
  requestPersistence,
  PACKS,
  type AssetPack,
  type PackManager,
  type PackProgress,
  type StorageEstimate,
} from '@sioditor/storage';

export interface PackStatus {
  readonly pack: AssetPack;
  readonly ready: boolean;
  readonly progress: PackProgress | undefined;
}

export interface StorageState {
  readonly estimate: StorageEstimate | undefined;
  readonly packs: readonly PackStatus[];
  readonly busy: boolean;
  readonly refresh: () => void;
  readonly download: (id: string) => void;
  readonly downloadAll: () => void;
  readonly remove: (id: string) => void;
  readonly requestPersist: () => void;
}

/**
 * The state behind the storage panel: what is cached, what it costs, and whether the
 * browser has agreed not to evict it.
 */
export function useStorage(manager: PackManager): StorageState {
  const [estimate, setEstimate] = useState<StorageEstimate>();
  const [ready, setReady] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [progress, setProgress] = useState<ReadonlyMap<string, PackProgress>>(new Map());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void estimateStorage().then(setEstimate);
    void manager.states().then(setReady);
  }, [manager]);

  useEffect(refresh, [refresh]);

  const download = useCallback(
    (id: string) => {
      const pack = PACKS.find((p) => p.id === id);
      if (!pack) return;
      setBusy(true);
      void manager
        .download(pack, (update) => setProgress((prev) => new Map(prev).set(id, update)))
        .finally(() => {
          setBusy(false);
          refresh();
        });
    },
    [manager, refresh],
  );

  const downloadAll = useCallback(() => {
    setBusy(true);
    // Sequential rather than parallel: these are tens of megabytes each, and a contestant
    // arming the tool before a round wants a progress figure that means something.
    void (async () => {
      for (const pack of PACKS) {
        if (await manager.isReady(pack)) continue;
        await manager
          .download(pack, (update) => setProgress((prev) => new Map(prev).set(pack.id, update)))
          .catch(() => undefined);
      }
      setBusy(false);
      refresh();
    })();
  }, [manager, refresh]);

  const remove = useCallback(
    (id: string) => {
      const pack = PACKS.find((p) => p.id === id);
      if (!pack) return;
      void manager.remove(pack).finally(refresh);
    },
    [manager, refresh],
  );

  const requestPersist = useCallback(() => {
    void requestPersistence().finally(refresh);
  }, [refresh]);

  return {
    estimate,
    packs: PACKS.map((pack) => ({
      pack,
      ready: ready.get(pack.id) ?? false,
      progress: progress.get(pack.id),
    })),
    busy,
    refresh,
    download,
    downloadAll,
    remove,
    requestPersist,
  };
}
