import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
  },
  server: {
    host: true, // Needed for Docker
    allowedHosts: true,
    port: 5173,
    watch: {
      usePolling: true, // Critical for Docker on MacOS/Windows
      interval: 100,
    },
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8087', // Local dev or Docker container
        changeOrigin: true,
        // rewrite: (path) => path.replace(/^\/api/, '/api'), // No rewrite needed if backend expects /api
      },
    },
  },
});
