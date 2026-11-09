// `npm run icons`: regenerates assets/icon.ico and assets/icon-256.png from assets/icon.svg.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBinary = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set by VS Code; would stop Electron from rendering

const child = spawn(electronBinary, [path.join(root, 'scripts', 'render-icons.mjs')], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
