/**
 * Registered explicitly rather than by the plugin's auto-injected snippet, so the app
 * controls when it happens and can report failures instead of swallowing them.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { type: 'module' });
  } catch (cause) {
    console.error('service worker registration failed', cause);
  }
}
