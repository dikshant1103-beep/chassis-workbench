import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',           // relative paths — required for Electron file:// loading
  server: {
    port: 5173,
    open: true,
    proxy: {
      // Forward /api/* to FastAPI backend (Phase 5)
      // Start backend: cd /home/dikshant/Desktop/Moter_bike && uvicorn api.main:app --port 8770
      '/api': {
        target: 'http://localhost:8770',
        changeOrigin: true,
      },
    },
  },
});
