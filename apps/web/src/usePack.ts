import { useCallback, useEffect, useState } from 'react';
import type { AssetPack, PackManager, PackProgress } from '@sioditor/storage';

export interface PackHandle {
  readonly pack: AssetPack;
  readonly ready: boolean;
  /**
   * False until the initial availability probe resolves. Without this the UI cannot tell
   * "not downloaded" apart from "not yet known", and briefly offers a download for a pack
   * that is already cached - which on a slow machine is long enough to click.
   */
  readonly checked: boolean;
  readonly progress: PackProgress | undefined;
  readonly download: () => void;
  /** Re-runs the availability probe, after the storage panel has changed things. */
  readonly recheck: () => void;
}

/** Tracks one asset pack's availability and drives its download. */
export function usePack(manager: PackManager, pack: AssetPack): PackHandle {
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState<PackProgress>();

  const probe = useCallback(() => {
    let cancelled = false;
    void manager
      .isReady(pack)
      .then((value) => {
        if (!cancelled) setReady(value);
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [manager, pack]);

  useEffect(probe, [probe]);

  const download = useCallback(() => {
    void manager
      .download(pack, setProgress)
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, [manager, pack]);

  return { pack, ready, checked, progress, download, recheck: probe };
}
