import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Honour an assigned PORT when one is set; otherwise Vite's default.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    proxy: {
      // Makes /api/chat same-origin from the browser's point of view, so we
      // need no CORS on the backend and no absolute URLs in the frontend.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // The SSE response must not be buffered by the dev proxy, or the
        // whole answer arrives in one lump at the end instead of streaming.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache, no-transform';
          });
        },
      },
    },
  },
});
