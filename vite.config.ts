import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'web',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 6677,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});