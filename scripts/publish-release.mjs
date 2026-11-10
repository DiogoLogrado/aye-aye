// Last step of `npm run release`: publishes the installer built in release/ as a GitHub release.
//
// gh creates the release as a draft, uploads the files, and only then publishes it, so installed
// apps never see a release without its installer or latest.yml. Before uploading, this checks that
// latest.yml describes this version and matches the installer byte for byte (apps verify the
// download against its SHA-512). The release text is the version's CHANGELOG.md entry.
// Runs with tsx (it reads the changelog with the app's own parser). `--dry-run` checks everything
// and prints the release text without publishing.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notesForVersion } from '../electron/changelog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { version } = pkg;
const { owner, repo } = pkg.build.publish;
const tag = `v${version}`;

const fail = (message) => {
  console.error(`Not publishing ${tag}: ${message}`);
  process.exit(1);
};

const releaseDir = path.join(root, pkg.build.directories.output);
const installer = path.join(releaseDir, pkg.build.nsis.artifactName.replace('${version}', version));
const blockmap = `${installer}.blockmap`;
const latestYml = path.join(releaseDir, 'latest.yml');
for (const file of [installer, blockmap, latestYml]) {
  if (!fs.existsSync(file)) fail(`${path.relative(root, file)} is missing. Build it first.`);
}

// latest.yml is flat YAML written by electron-builder; the top-level keys are enough here.
const yml = Object.fromEntries(
  fs
    .readFileSync(latestYml, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^(\w+):\s*'?([^']*)'?$/.exec(line))
    .filter(Boolean)
    .map((match) => [match[1], match[2].trim()]),
);
const installerSha512 = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
if (yml.version !== version) fail(`latest.yml is for version ${yml.version}, not ${version}.`);
if (yml.path !== path.basename(installer)) fail(`latest.yml points to ${yml.path}, not ${path.basename(installer)}.`);
if (yml.sha512 !== installerSha512) fail("latest.yml's SHA-512 doesn't match the installer. Rebuild.");

const notes = notesForVersion(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
if (!notes) fail(`CHANGELOG.md has no entry for ${version}.`);

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

if (process.argv.includes('--dry-run')) {
  console.log(`Dry run: ${tag} from ${commit.slice(0, 7)} is ready to publish to ${owner}/${repo}.`);
  console.log(`Files: ${[installer, blockmap, latestYml].map((f) => path.basename(f)).join(', ')}`);
  console.log(`Release text:\n${notes}`);
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aye-aye-release-'));
const notesFile = path.join(tempDir, 'notes.md');
fs.writeFileSync(notesFile, `${notes}\n`);

try {
  // gh authenticates with GH_TOKEN (checked by check-release.mjs).
  execFileSync(
    'gh',
    [
      'release',
      'create',
      tag,
      installer,
      blockmap,
      latestYml,
      '--repo',
      `${owner}/${repo}`,
      '--target',
      commit,
      '--title',
      version,
      '--notes-file',
      notesFile,
    ],
    { cwd: root, stdio: 'inherit' },
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
console.log(`Published ${tag}: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
