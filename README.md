<img src="assets/icon-256.png" width="96" height="96" alt="Aye-aye logo">

# Aye-aye

A local MongoDB browser with a visual query builder, for desktop or browser. Every change is previewed, backed up and can be undone.

Named after the aye-aye, a lemur that finds food by tapping on wood, listening for hollow spots and pulling out what's hidden inside.

## Features

- **Connection tree:** connections ▸ databases ▸ collections. Each click opens a tab with the newest documents.
- **Favorites:** star collections to pin them at the top of the sidebar, grouped by database.
- **Query builder:** pick a field, an operator and a value; combine rows with *and* / *or*. Field names autocomplete from sampled documents, and values are typed from them (ObjectId, dates, numbers). The generated query is shown, syntax-colored, as it will run.
- **Raw mode:** write the full shell command, for example
  `db.getCollection("users").find({ name: /ada/i }).sort({ createdAt: -1 }).limit(20)`.
  `.sort()`, `.limit()`, `.skip()` and `.projection()` are supported, with paging.
- **Document viewer:** colored, collapsible JSON tree with a copy button on every document.
- **Counts:** instant estimate for a whole collection; exact count of a filtered query on request.
- **Editing:** add, edit and delete documents, and run write commands such as `updateMany`. Every write is previewed, needs confirmation, is backed up first and can be undone.

## Install (Windows)

Download `Aye-aye-Setup-<version>.exe` from the [Releases](../../releases) page and run it. It installs for your user only (no administrator rights needed), creates Desktop and Start menu shortcuts, and opens the app.

The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Choose **More info ▸ Run anyway**.

Uninstall from **Settings ▸ Apps**. Your saved connections are kept.

## Running from source

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

Click **Connection** in the sidebar, give the connection a name and paste a connection string. It's tested before it's saved.

### Desktop app

The desktop app starts its own server on `127.0.0.1:4318` (or any free port), stops it when the window closes, and remembers its size and position. Running it a second time focuses the open window.

| Menu | |
|---|---|
| File | New connection (`Ctrl+Shift+N`), open the data or backups folder, exit |
| Edit | Undo, redo, cut, copy, paste, select all |
| View | Reload (`Ctrl+R`), zoom in / out / reset (`Ctrl +`, `Ctrl -`, `Ctrl 0`, numpad too), full screen (`F11`) |
| Help | Version information |

## Editing data

- **Edit** a document as text, review a field-by-field diff, then save. Saving is refused if someone else changed the document after you loaded it.
- **Delete** a single document after a confirmation.
- **Add** a document, starting from `{}`. An `_id` is generated if you leave it out.
- **Write commands** in Raw mode (`insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`) show how many documents they'll affect before running. Commands that affect many documents ask you to type the collection name.

Every write backs up the affected documents first, and **Undo** restores them. Backups are kept in the data folder (File ▸ Open backups folder).

Never allowed: `drop`, `dropDatabase`, `renameCollection`, `deleteMany({})`, `$out` / `$merge`, server-side JavaScript (`$where`, `$function`, `$accumulator`) and arbitrary database commands.

## Security

| | |
|---|---|
| Passwords | Connection strings are stored only in the operating system's credential store (Windows Credential Manager, macOS Keychain, Secret Service on Linux). They're never written to a file, logged, or sent to the page, and error messages are redacted. |
| Network | The server listens on `127.0.0.1` only. |
| Other websites | Every request needs a random token created at startup, and Host and Origin headers are checked, which blocks CSRF and DNS rebinding. Strict Content Security Policy. |
| Desktop window | Sandboxed: no Node.js access from the page, no navigation to other sites, no popups, and every permission is denied except clipboard writes. |
| Queries | Parsed without `eval`. Server-side JavaScript operators are rejected. |

## Light on shared databases

Aye-aye is meant to be safe to point at a database other applications depend on:

- Every read is stopped by the server after 15 seconds, and pages are capped at 200 documents.
- At most 5 connections, closed after 60 seconds idle.
- Nothing polls or refreshes on its own. Exact counts of a filter only run when you click **Count**.
- Field samples used for autocomplete are cached for 5 minutes.
- Connections identify themselves in `db.currentOp()` and the server logs as
  `Aye-aye (local MongoDB query tool) <user>@<computer>`.

## Troubleshooting

**"Server unreachable", but other tools connect fine.** Add `&directConnection=true` to the connection string (remove the connection and add it again). When you connect to one member of a replica set, the driver asks the server for the replica set's member list and switches to those hostnames. If the replica set was configured with internal names, such as a Docker container ID, your machine can't resolve them. `directConnection=true` makes the driver talk only to the host you gave it.

**Connection string parameters** you may see in strings exported from other tools:

| Parameter | Meaning |
|---|---|
| `authSource=admin` | The database the user is defined in. Required when the user lives in `admin`. |
| `authMechanism=SCRAM-SHA-1` | Forces the older authentication hash. Only needed for users without SCRAM-SHA-256 credentials. |
| `retryWrites=true`, `loadBalanced=false` | Driver defaults. |
| `serverSelectionTimeoutMS`, `connectTimeoutMS` | Overridden by Aye-aye's own 10-second timeouts. |

Exported connection files often contain passwords in plain text. Delete them once the connection is added.

## Development

| Command | |
|---|---|
| `npm run dev` | Server and UI with hot reload, in the browser |
| `npm test` | Unit and API tests (no database needed) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type-check and build the UI |
| `npm run app:smoke` | Start the desktop app hidden with a throwaway data folder, check it works, exit |
| `npm run icons` | Regenerate the app icons from `assets/icon.svg` |
| `npm run dist` | Build the Windows installer into `release/` |

`npm audit` reports a moderate issue in `minimatch`, used only by electron-builder at build time to match its own configuration patterns. It isn't part of the installed app.

Built with Electron, React, Vite, Express and the official MongoDB Node.js driver.

## License

[MIT](LICENSE)
