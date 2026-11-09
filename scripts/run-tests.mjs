// Cross-platform test runner: Node 20.11's --test can't glob and Windows shells don't expand globs.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');
const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join('test', f));

if (files.length === 0) {
  console.error('No test files found in test/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
