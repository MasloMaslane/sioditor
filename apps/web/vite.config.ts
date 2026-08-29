import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Cross-origin isolation is a hard requirement, not a nice-to-have: SharedArrayBuffer
 * backs Pyodide's interrupt buffer and (later) blocking stdin. Production gets these
 * from our own server config in deploy/; dev and preview must match it exactly, or
 * behaviour diverges between `pnpm dev` and the real deployment.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },

  // Pyodide ships its own loader that fetches sibling assets by URL; prebundling it
  // rewrites those paths and breaks the self-hosted indexURL.
  optimizeDeps: { exclude: ['pyodide'] },

  worker: { format: 'es' },

  build: {
    target: 'es2022',
    sourcemap: true,
  },

  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: null,
      manifest: {
        name: 'sioditor',
        short_name: 'sioditor',
        description: 'Offline C++ and Python editor for OI practice',
        theme_color: '#11161d',
        background_color: '#11161d',
        display: 'standalone',
        start_url: '/',
      },
      injectManifest: {
        // App shell only. The clang and Pyodide payloads are hundreds of megabytes and
        // are fetched on demand into OPFS instead: Workbox precaching is atomic and
        // eager, so a single hash change would re-download the lot.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/toolchain/**', '**/pyodide/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
