import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string };
const buildTime = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const appVersion = `${pkg.version}+${buildTime}`;

/** Emits /asset-manifest.json listing every built file so the hand-written service worker can precache the app shell. */
function assetManifestPlugin(): Plugin {
  return {
    name: 'tank-asset-manifest',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).map((f) => '/' + f);
      const extra = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];
      this.emitFile({
        type: 'asset',
        fileName: 'asset-manifest.json',
        source: JSON.stringify({ version: appVersion, files: [...new Set([...extra, ...files])] }),
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [assetManifestPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  preview: {
    port: 4173,
  },
});
