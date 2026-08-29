import { useCallback, useEffect, useState } from 'react';
import type { AssetPack, PackManager, PackProgress } from '@sioditor/storage';

export interface PackHandle {
  readonly pack: AssetPack;
  readonly ready: boolean;
  readonly progress: PackProgress | undefined;
  readonly download: () => void;
}

/** Tracks one asset pack's availability and drives its download. */
export function usePack(manager: PackManager, pack: AssetPack): PackHandle {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<PackProgress>();

  useEffect(() => {
    let cancelled = false;
    void manager.isReady(pack).then((value) => {
      if (!cancelled) setReady(value);
    });
    return () => {
      cancelled = true;
    };
  }, [manager, pack]);

  const download = useCallback(() => {
    void manager
      .download(pack, setProgress)
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, [manager, pack]);

  return { pack, ready, progress, download };
}
