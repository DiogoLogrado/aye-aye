# Security

Aye-aye runs entirely on your machine. It talks to the databases you add, and to GitHub to check for updates.

| | |
|---|---|
| Passwords | Connection strings are stored only in the operating system's credential store (Windows Credential Manager, macOS Keychain, Secret Service on Linux). They're never written to a file, logged, or sent to the page, and error messages are redacted. |
| Network | The built-in server listens on `127.0.0.1` only. |
| Other websites | Every request needs a random token created at startup, and Host and Origin headers are checked, which blocks CSRF and DNS rebinding. Strict Content Security Policy. |
| Desktop window | Sandboxed: no Node.js access from the page, no navigation to other sites, no popups, and every permission is denied except clipboard writes. |
| App files | Electron's hardening fuses are on: the app only loads its own packaged, integrity-checked code, and can't be started as a plain Node.js runtime or with a debugger. |
| Queries | Parsed without `eval`. Server-side JavaScript operators are rejected. |
| Writes | Previewed, confirmed, backed up and undoable. Destructive operations such as dropping collections are not available at all. See [Editing data](user-guide.md#editing-data). |

## Updates

The installed app downloads updates from this repository's [GitHub Releases](../../../releases) over HTTPS. Each download is checked against the SHA-512 hash published with the release before it's installed. The installer isn't code-signed, so updates are trusted on the basis of the GitHub repository they come from.

## Light on shared databases

Aye-aye is meant to be safe to point at a database other applications depend on:

- Every read is stopped by the server after 15 seconds, and pages are capped at 200 documents.
- At most 5 connections, closed after 60 seconds idle.
- Nothing polls or refreshes on its own. Exact counts of a filter only run when you click **Count**.
- Field samples used for autocomplete are cached for 5 minutes.
- Connections identify themselves in `db.currentOp()` and the server logs as
  `Aye-aye (local MongoDB query tool) <user>@<computer>`.
