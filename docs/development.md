# Development

Requires Node.js 20.19 or newer (the repo pins Node 24 in `.nvmrc`).

```bash
npm install
npm run app        # build and open the desktop app
```

Or run it in the browser:

```bash
npm run build
npm start          # http://127.0.0.1:4317 (change with AYE_AYE_PORT)
```

The desktop app starts its own server on `127.0.0.1:4318` (or any free port) and stops it when the window closes.

## Commands

| Command | |
|---|---|
| `npm run dev` | Server and UI with hot reload, in the browser |
| `npm test` | Unit and API tests (no database needed) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type-check and build the UI |
| `npm run app:smoke` | Start the desktop app hidden with a throwaway data folder, check it works, exit |
| `npm run icons` | Regenerate the app icons from `assets/icon.svg` |
| `npm run dist` | Build the Windows installer into `release/` without publishing it |
| `npm run release` | Build the installer and publish it as a GitHub release |

## Project layout

| Folder | |
|---|---|
| `server/` | Express API, MongoDB access, write safety, credential storage |
| `client/` | React UI |
| `electron/` | Desktop window, menus, shortcuts, auto-update |
| `scripts/` | Build, test and release helpers |
| `test/` | Tests, with an in-memory store and fake collections |
| `assets/` | App icon source and generated icons |

## Releasing

Installed apps update themselves from GitHub Releases, so a release reaches everyone who has the app.

You need the [GitHub CLI](https://cli.github.com/) (`gh`) and a GitHub token with **Contents: Read and write** on this repository.

1. Merge the changes into `main` and pull.
2. Bump `version` in `package.json` (for example `0.3.0` → `0.4.0`) and rename `## Unreleased` in `CHANGELOG.md` to that version. Commit and push.
3. Release. The first line asks for the token without showing it or saving it in the shell history:

   ```powershell
   $env:GH_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'GitHub token' -AsSecureString)).Password
   npm run release
   Remove-Item Env:GH_TOKEN
   ```

`npm run release` refuses to run unless you're on `main`, the working tree is clean, local `main` matches GitHub, the version hasn't been released yet, and `CHANGELOG.md` has an entry for it. It runs the tests and builds the installer. Then `scripts/publish-release.mjs` checks that `latest.yml` matches the installer and creates the `v<version>` release with `gh`. The release text is the changelog entry, and the release has three files: the installer, its `.blockmap` (for smaller, partial downloads) and `latest.yml` (the version and SHA-512 the app checks).

The release is created as a draft, the files are uploaded, and only then is it published, so installed apps never see a release with missing files. If an upload fails, delete the leftover draft on GitHub and run `npm run release` again. `node --import tsx scripts/publish-release.mjs --dry-run` runs the checks on the files in `release/` without publishing.

The installed app shows the changelog entry for its new version once, after it updates, so write entries for people using the app.

## Dependencies

Electron, electron-builder and electron-updater are pinned to exact versions. electron-builder and electron-updater are released together, so upgrade them as a pair.

`npm audit` reports a moderate issue in `minimatch`, used only by electron-builder at build time to match its own configuration patterns. It isn't part of the installed app.

Built with Electron, React, Vite, Express and the official MongoDB Node.js driver.
