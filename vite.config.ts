import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: { preserveSymlinks: true },
  server: { port: 5197, host: '127.0.0.1', strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
