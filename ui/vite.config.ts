// The dashboard's build. `npm run build:ui` writes it to web/app, which the server
// serves at / (and /mini). `npm run dev:ui` serves it
// with hot reload, passing /api, /events and /shared to an Overtime server
// (the test one on 4779 unless OVERTIME_DEV_SERVER says otherwise), and puts
// that server's saved settings into the page the way the server itself does.

import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { settingsScript } from '../lib/store.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const server = process.env.OVERTIME_DEV_SERVER || 'http://127.0.0.1:4779';

/** In dev, the page gets the server's saved settings, as the server's own pages do. */
function settingsInDev(): Plugin {
  return {
    name: 'overtime-settings',
    apply: 'serve',
    async transformIndexHtml(html) {
      try {
        const saved = await (await fetch(`${server}/api/settings`)).json();
        return html.replace('<!-- settings -->', settingsScript(saved));
      } catch {
        return html;
      }
    },
  };
}

export default defineConfig({
  root: here('.'),
  // Relative, so the same build works at / and /mini.
  base: './',
  plugins: [react(), tailwindcss(), settingsInDev()],
  resolve: {
    alias: [
      { find: /^@shared\//, replacement: `${here('../web/shared')}/` },
      { find: /^@\//, replacement: `${here('src')}/` },
    ],
  },
  build: {
    outDir: here('../web/app'),
    emptyOutDir: true,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        // Everything the page needs to start comes as one file; what loads later
        // (the other sections, the panel, the dialogs) still comes in its own.
        codeSplitting: { groups: [{ name: 'start', tags: ['$initial'] }] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ['/api', '/events', '/shared', '/office'].map((p) => [p, { target: server, changeOrigin: true }]),
    ),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // On London's clock, whoever runs them: the golden tests' snapshots have its times,
    // summer time included.
    env: { TZ: 'Europe/London' },
  },
});
