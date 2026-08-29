import { useCallback, useEffect, useRef, useState } from 'react';
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

const AUTO_DOWNLOAD_KEY = 'sioditor.auto-download';

/**
 * Whether to fetch every pack on load without being asked.
 *
 * On by default: the common case is somebody who wants the tool ready, and making them
 * hunt for a button first is a poor greeting. It is a setting rather than a hard default
 * because the full set is around 150 MB, which is not something to start unannounced on
 * a tethered phone during a round.
 */
function readAutoDownload(): boolean {
  try {
    return localStorage.getItem(AUTO_DOWNLOAD_KEY) !== 'off';
  } catch {
    // Storage can throw in a private window; assume the default rather than fail.
    return true;
  }
}

export interface StorageState {
  readonly autoDownload: boolean;
  readonly setAutoDownload: (on: boolean) => void;
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
  const [autoDownload, setAutoDownloadState] = useState(readAutoDownload);
  const autoStarted = useRef(false);

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

  const setAutoDownload = useCallback((on: boolean) => {
    setAutoDownloadState(on);
    try {
      localStorage.setItem(AUTO_DOWNLOAD_KEY, on ? 'on' : 'off');
    } catch {
      // Not being able to remember the choice is not worth failing over.
    }
  }, []);

  const downloadAll = useCallback(() => {
    setBusy(true);
    // Sequential rather than parallel: these are tens of megabytes each, and a contestant
    // arming the tool before a round wants a progress figure that means something.
    void (async () => {
      // Required first: Python and C++ make the app usable, and the optional extras -
      // NumPy and the precompiled header - only make it nicer.
      const ordered = [...PACKS].sort((a, b) => Number(a.optional) - Number(b.optional));
      for (const pack of ordered) {
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

  // Fetch whatever is missing, once, after the first look at what is already cached.
  useEffect(() => {
    if (!autoDownload || autoStarted.current || ready.size === 0) return;
    if (PACKS.every((pack) => ready.get(pack.id))) return;
    autoStarted.current = true;
    downloadAll();
  }, [autoDownload, downloadAll, ready]);

  return {
    estimate,
    autoDownload,
    setAutoDownload,
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
