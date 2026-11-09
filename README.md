<img src="assets/icon-256.png" width="96" height="96" alt="Aye-aye logo">

# Aye-aye

A fast, local MongoDB browser with a visual query builder. Find documents without writing `$and`, `$or` or regular expressions by hand, and edit data knowing every change is previewed, backed up and can be undone.

## Features

- **Connection tree:** connections ▸ databases ▸ collections. One click opens a tab with the newest documents.
- **Favorites:** star the collections you use most to pin them at the top.
- **Query builder:** pick a field, an operator and a value, and combine rows with *and* / *or*. Field names autocomplete and values are typed for you (ObjectId, dates, numbers).
- **Raw mode:** write the full shell command, such as `db.getCollection("users").find({ name: /ada/i }).sort({ createdAt: -1 })`.
- **Document viewer:** colored, collapsible JSON with a copy button on every document.
- **Safe editing:** add, edit and delete documents, or run write commands like `updateMany`. Each write is previewed, confirmed, backed up and undoable.
- **Light on shared databases:** short query timeouts, capped pages, a small connection pool and nothing that polls in the background.
- **Private by design:** runs entirely on your machine. Connection strings stay in the operating system's credential store.
- **Automatic updates:** new versions download in the background and install on restart.

## Download

Get the Windows installer from the [latest release](../../releases/latest). It installs for your user only, with no administrator rights needed.

## Documentation

- [User guide](docs/user-guide.md): installing, updates, querying, editing, troubleshooting
- [Security](docs/security.md): how connections, data and the app itself are protected
- [Development](docs/development.md): running from source, building and releasing
- [About the name and logo](docs/about.md)

## License

[MIT](LICENSE)
