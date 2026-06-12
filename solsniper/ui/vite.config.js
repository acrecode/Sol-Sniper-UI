import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API + WS are served by the Fastify backend on :8787.
// Dev proxy keeps the frontend same-origin so there is no CORS/WS friction.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
