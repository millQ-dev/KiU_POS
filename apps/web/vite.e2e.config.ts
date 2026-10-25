import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';
const port = Number(process.env.E2E_WEB_PORT ?? '5173');

/** Vite config for disposable-DB browser E2E — proxies /api to the ephemeral API. */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: {
      '/health': apiTarget,
      '/api': apiTarget,
    },
  },
});
