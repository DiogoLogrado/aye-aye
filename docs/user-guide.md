# User guide

## Installing

Download `Aye-aye-Setup-<version>.exe` from the [Releases](../../../releases/latest) page and run it. It installs for your user only (no administrator rights needed), creates Desktop and Start menu shortcuts, and opens the app.

The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Choose **More info ▸ Run anyway**.

Uninstall from **Settings ▸ Apps**. Your saved connections and backups are kept.

## Updates

The app checks for a new version when it starts and every few hours while it's open. A new version downloads in the background, with its progress on the taskbar icon. Then the app shows what's new and offers to restart:

- **Restart now** installs it and reopens the app.
- **Later** installs it the next time you close the app.

If the app is minimized when the update is ready, its taskbar button flashes and the message appears when you open the window again.

After an update, the app shows what changed, once. The full history is in the [changelog](../CHANGELOG.md).

**Help ▸ Check for updates…** checks right away. Your connections, backups and settings are kept across updates.

## Connecting

Click **Connection** in the sidebar (or **File ▸ New connection…**, `Ctrl+Shift+N`), give the connection a name and paste a connection string. It's tested before it's saved.

Exported connection files often contain passwords in plain text. Delete them once the connection is added.

## Finding documents

Click a collection to open it in a tab, newest documents first.

- **Builder:** add a row per condition: field, operator, value. Choose *and* / *or* between rows. The query that will run is shown below, syntax-colored.
- **Raw:** the full shell command, for example
  `db.getCollection("users").find({ "address.city": "Paris" }).sort({ _id: -1 }).limit(20)`.
  `.sort()`, `.limit()`, `.skip()` and `.projection()` are supported, with paging. Switching from Builder to Raw carries the current query over.
- **Count:** the document count of a whole collection is an instant estimate. The exact count of a filtered query runs when you click **Count**.

## Editing data

- **Edit** a document as text, review a field-by-field diff, then save. Saving is refused if someone else changed the document after you loaded it.
- **Delete** a single document after a confirmation.
- **Add** a document, starting from `{}`. An `_id` is generated if you leave it out.
- **Write commands** in Raw mode (`insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`) show how many documents they'll affect before running. Commands that affect many documents ask you to type the collection name.

Every write backs up the affected documents first, and **Undo** restores them. Backups are kept in the data folder (**File ▸ Open backups folder**).

Never allowed: `drop`, `dropDatabase`, `renameCollection`, `deleteMany({})`, `$out` / `$merge`, server-side JavaScript (`$where`, `$function`, `$accumulator`) and arbitrary database commands.

## Menus and shortcuts

| Menu | |
|---|---|
| File | New connection (`Ctrl+Shift+N`), open the data or backups folder, exit |
| Edit | Undo, redo, cut, copy, paste, select all |
| View | Reload (`Ctrl+R`), zoom in / out / reset (`Ctrl +`, `Ctrl -`, `Ctrl 0`, numpad too), full screen (`F11`) |
| Help | Check for updates, version information |

Running the app a second time focuses the window that's already open. The window remembers its size and position.

## Troubleshooting

**"Server unreachable", but other tools connect fine.** Add `&directConnection=true` to the connection string (remove the connection and add it again). When you connect to one member of a replica set, the driver asks the server for the replica set's member list and switches to those hostnames. If the replica set was configured with internal names, such as a Docker container ID, your machine can't resolve them. `directConnection=true` makes the driver talk only to the host you gave it.

**Connection string parameters** you may see in strings exported from other tools:

| Parameter | Meaning |
|---|---|
| `authSource=admin` | The database the user is defined in. Required when the user lives in `admin`. |
| `authMechanism=SCRAM-SHA-1` | Forces the older authentication hash. Only needed for users without SCRAM-SHA-256 credentials. |
| `retryWrites=true`, `loadBalanced=false` | Driver defaults. |
| `serverSelectionTimeoutMS`, `connectTimeoutMS` | Overridden by Aye-aye's own 10-second timeouts. |

**An update doesn't arrive.** Use **Help ▸ Check for updates…** to see the reason. A firewall or proxy that blocks `github.com` also blocks updates. You can always install a newer version over the old one from the Releases page.
