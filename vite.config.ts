import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: 'src/frontend',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/frontend/src'),
    },
  },
  esbuild: {
    // This ensures Vite uses tsconfig.frontend.json for type-checking
    tsconfigRaw: path.resolve(__dirname, 'tsconfig.frontend.json'),
  },
});