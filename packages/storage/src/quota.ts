/**
 * Ask the browser not to evict us.
 *
 * Chrome decides silently from engagement heuristics, Firefox prompts, and Safari leans
 * on whether the app was installed to the Home Screen. Under Safari's ITP an origin left
 * untouched for seven days loses all script-writable storage unless it is an installed
 * web app - which is why the UI pushes iOS users to install rather than just bookmark.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export interface StorageEstimate {
  readonly usedBytes: number;
  readonly quotaBytes: number;
  readonly persisted: boolean;
}

export async function estimateStorage(): Promise<StorageEstimate> {
  const estimate = (await navigator.storage?.estimate?.()) ?? {};
  return {
    usedBytes: estimate.usage ?? 0,
    quotaBytes: estimate.quota ?? 0,
    persisted: (await navigator.storage?.persisted?.()) ?? false,
  };
}
