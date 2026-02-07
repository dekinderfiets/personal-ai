import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
  },
  server: {
    host: true, // Needed for Docker
    port: 5173,
    watch: {
      usePolling: true, // Critical for Docker on MacOS/Windows
      interval: 100,
    },
    proxy: {
      '/api': {
        target: 'http://index_service:8087', // Proxy to the backend service container by name
        changeOrigin: true,
        // rewrite: (path) => path.replace(/^\/api/, '/api'), // No rewrite needed if backend expects /api
      },
    },
  },
});
