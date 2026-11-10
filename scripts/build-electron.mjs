// Bundles the desktop app's main process and preload into dist/electron (part of `npm run build:app`).
//
// The main process uses code splitting: modules it imports lazily (the server, the updater) become
// separate chunks, so their packages (mongodb, express, electron-updater…) only load after the
// window is already showing the splash screen. npm packages stay external (loaded from node_modules).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist', 'electron');

// Chunk names carry content hashes: start clean so old chunks never end up in the installer.
fs.rmSync(outdir, { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: ['electron/main.ts'],
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
  outdir,
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

await build({
  absWorkingDir: root,
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  outfile: path.join(outdir, 'preload.cjs'),
  logLevel: 'warning',
});
