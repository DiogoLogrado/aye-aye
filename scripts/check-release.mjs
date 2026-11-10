// Runs before `npm run release`. Every installed app downloads whatever is published, so only
// release committed code that is already on GitHub's main branch, under a new version number,
// with release notes. Runs with tsx (it reads the changelog with the app's own parser).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { notesForVersion } from '../electron/changelog.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = `v${version}`;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const problems = [];

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  problems.push('Set GH_TOKEN to a GitHub token with "Contents: Read and write" on this repository.');
}

try {
  execFileSync('gh', ['--version'], { stdio: 'ignore' });
} catch {
  problems.push('Install the GitHub CLI (gh): it publishes the release.');
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
if (!notesForVersion(changelog, version)) {
  problems.push(`CHANGELOG.md has no entry for ${version}. Rename "## Unreleased" to "## ${version}" (or add one).`);
}

const branch = git('branch', '--show-current');
if (branch !== 'main') problems.push(`Releases are made from main (current branch: ${branch || 'detached'}).`);

if (git('status', '--porcelain') !== '') problems.push('Commit or stash your changes first.');

git('fetch', '--quiet', 'origin', 'main');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
  problems.push('Local main differs from GitHub. Pull or push first.');
}

if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '') {
  problems.push(`${tag} is already released. Bump "version" in package.json.`);
}

if (problems.length > 0) {
  console.error(`Not releasing ${tag}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Releasing ${tag} from ${git('rev-parse', '--short', 'HEAD')}.`);
