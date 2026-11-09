import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, 'client'),
  plugins: [react()],
  build: {
    outDir: path.join(rootDir, 'dist', 'client'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
