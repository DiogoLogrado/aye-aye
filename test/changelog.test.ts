import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { htmlToText, markdownToText, notesForVersion, releaseNotesText } from '../electron/changelog';

const changelog = `# Changelog

Intro text.

## 1.2.0

- Added **bold** thing with \`code\`.
- See [the guide](docs/user-guide.md).

## 1.1.0 (2026-01-01)

- Older change.

## 1.0.0
`;

describe('notesForVersion', () => {
  it('returns the section under the version heading, up to the next one', () => {
    assert.equal(
      notesForVersion(changelog, '1.2.0'),
      '- Added **bold** thing with `code`.\n- See [the guide](docs/user-guide.md).',
    );
  });

  it('accepts text after the version on the heading line', () => {
    assert.equal(notesForVersion(changelog, '1.1.0'), '- Older change.');
  });

  it('is undefined for missing, empty or partially matching versions', () => {
    assert.equal(notesForVersion(changelog, '9.9.9'), undefined);
    assert.equal(notesForVersion(changelog, '1.0.0'), undefined);
    assert.equal(notesForVersion(changelog, '1.2'), undefined);
  });

  it('handles Windows line endings', () => {
    assert.equal(notesForVersion(changelog.replace(/\n/g, '\r\n'), '1.1.0'), '- Older change.');
  });

  it('finds an entry for the version in package.json, or an Unreleased one waiting to be named', () => {
    const real = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    assert.ok(notesForVersion(real, version) ?? notesForVersion(real, 'Unreleased'));
  });
});

describe('markdownToText', () => {
  it('turns bullets, emphasis, code and links into plain text', () => {
    assert.equal(
      markdownToText(notesForVersion(changelog, '1.2.0') ?? ''),
      '• Added bold thing with code.\n• See the guide.',
    );
  });

  it('shortens very long notes', () => {
    const text = markdownToText(`- ${'x'.repeat(5000)}`);
    assert.ok(text.length <= 1201);
    assert.ok(text.endsWith('…'));
  });
});

describe('htmlToText', () => {
  it('turns GitHub release HTML into plain text bullets', () => {
    assert.equal(
      htmlToText('<ul>\n<li>A loading screen &amp; <strong>faster</strong> start.</li>\n<li>Fix &lt;tag&gt; &#39;quotes&#39;</li>\n</ul>'),
      "• A loading screen & faster start.\n• Fix <tag> 'quotes'",
    );
  });

  it('keeps paragraphs apart and drops extra blank lines', () => {
    assert.equal(htmlToText('<p>One</p>\n\n\n<p>Two<br>Three</p>'), 'One\n\nTwo\nThree');
  });

  it('leaves unknown or invalid entities as they are', () => {
    assert.equal(htmlToText('&bogus; &#0; &#x1F600;'), '&bogus; &#0; 😀');
  });
});

describe('releaseNotesText', () => {
  it('accepts electron-updater HTML strings and per-version lists', () => {
    assert.equal(releaseNotesText('<p>Hi</p>'), 'Hi');
    assert.equal(releaseNotesText([{ version: '1', note: '<p>A</p>' }, { version: '2', note: null }]), 'A');
  });

  it('is undefined when there are no notes', () => {
    assert.equal(releaseNotesText(null), undefined);
    assert.equal(releaseNotesText(undefined), undefined);
    assert.equal(releaseNotesText(''), undefined);
    assert.equal(releaseNotesText([]), undefined);
  });
});
