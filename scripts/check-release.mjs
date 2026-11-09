// Runs before `npm run release`. Every installed app downloads whatever is published, so only
// release committed code that is already on GitHub's main branch, under a new version number.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = `v${version}`;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const problems = [];

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  problems.push('Set GH_TOKEN to a GitHub token with "Contents: Read and write" on this repository.');
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
