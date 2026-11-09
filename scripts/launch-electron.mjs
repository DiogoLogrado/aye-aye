// Launches the desktop app from the project: `npm run app` (or `npm run app:smoke`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBinary = createRequire(import.meta.url)('electron');
const args = process.argv.slice(2);

const env = { ...process.env };
// VS Code (and tools it launches) set this; it makes Electron run as plain Node with no window.
delete env.ELECTRON_RUN_AS_NODE;

// Smoke tests use a throwaway data folder, so they never see the real connections.
let tempDataDir;
if (args.includes('--smoke-test') && !env.AYE_AYE_DATA_DIR) {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aye-aye-smoke-'));
  env.AYE_AYE_DATA_DIR = tempDataDir;
}

const child = spawn(electronBinary, ['.', ...args], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (tempDataDir) fs.rmSync(tempDataDir, { recursive: true, force: true });
  process.exit(code ?? (signal ? 1 : 0));
});
