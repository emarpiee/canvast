# ADR 0184: Sharing a workspace on the local network, read-only

- Status: **proposed** (2026-11-09), built on branch `lan-sharing`; merged into `main` only on the owner's go
- Related: ADR 0177 (workspace folder, storage boundary, hidden items), ADR 0006–0008 (storage, writer lease)

## Context

People on the same network (a studio, a class, a household) want to look at one person's workspace: its canvases, its library and, when allowed, its hidden items, without copying it. canvast had no network at all. The desktop app can accept connections; a browser page cannot. The first version is **read-only**.

## Decision

### Who is who

- **Host:** the desktop app. *Settings > Sharing* turns a small HTTPS server on (off by default, off again at every start). It listens on the local network on one port and answers reads only.
- **Browser guest:** opens `https://<host address>:<port>`. The host serves the app itself; it starts as a guest of that host.
- **Desktop guest:** *Switch workspace > Connect to a shared workspace…* (hosts found on the network, or an address). The same window, as a guest.

### How a guest reads (one storage, a third bridge)

The desktop app's storage reads and writes its workspace folder through the bridge (`DesktopBridge`, `src/storage/desktop-bridge.ts`). A guest gets a **remote bridge**: the same calls, answered by the host over HTTPS, and every write refused. The desktop storage opens on it in a **read-only mode** (nothing written to the folder, the writer lease `readonly`), so the canvases, the library, the viewers and the search work as on the host, from one code path.

- Files are read lazily: a folder listing comes from the library's index; a file's bytes only when asked, a range at a time (`part`), so a big video plays from the middle without the rest.
- The library's lists (scope, search, sort, counts) run **in the guest's page** with the same index the host's main process uses (`desktop/library-index.ts`, `src/assets/library-match.ts`), over the entries the host sends.

### Hidden items: end to end

- The host sends hidden items' files and `hidden.json` **as they are on disk: encrypted**. It never decrypts them for a guest and need not be unlocked.
- The guest types the Hidden password; its own page derives the key and opens the index and the files (the code that already opens desktop hidden items in the browser). Their details stay in the guest's page and never go back to the host.
- Hidden items are shared only when the host turns on *Share hidden items* as well (off by default). Without it, the host refuses every path under `.hidden/` and `hidden.json`.

### Security

- **HTTPS** with a certificate the host makes for itself (kept in the app's settings, not in the workspace). A browser warns once; a desktop guest pins its fingerprint, shown on both sides.
- **Pairing, then approval:** the guest enters the host's six-digit code; the host is asked *Allow <device>?*. An approved guest gets a token (kept by the guest; revoked by *Remove* in the host's list). No token, no answer, apart from the pairing page.
- **Read-only by construction:** the server has no write route. A bridge write on a guest throws.
- **Paths:** only paths inside the workspace, the rules of the main process's own (`..`, absolute paths and links leaving the folder refused).
- Limits: how many guests, how many requests at once each, and a size cap on one range.
- A visible *Sharing · N guests* indicator on the host, with **Stop**.

### Follow the host

A guest may turn on *Follow*: the host's page sends its camera and canvas (board, canvas, centre, zoom) when it changes, at most a few times a second (server-sent events), and the guest's view follows until the guest moves. The host's selection and pointer are not sent.

### Live updates

The host's folder watcher (`onChanged`) is forwarded to guests as the same event, so a guest catches up as on the host when a sync tool changes the folder.

### The single file stays offline

The downloaded `canvast.html` makes no request (`check:offline`). The page a host serves is the same app with a guest boot set by the server (its address, the pairing); the file opened from `file://` never connects anywhere.

## Order of work

1. This ADR, the README's Privacy and Limitations.
2. Host: the server, its certificate, pairing and approval, the read routes (bridge reads, library reads, ranges), the guest list, Stop, the indicator.
3. Browser guest: the remote bridge, the read-only storage mode, the in-page library index, hidden items end to end.
4. Desktop guest: connect, discovery (mDNS), pinning.
5. Live updates and Follow.
6. (Optional) A WebDAV view of the library for file managers.

## Consequences

- "No network" stays true of the single file and of the desktop app until its owner turns Sharing on.
- A guest's browser keeps what it saw in its own storage (a cache per host), like any site; the hidden items' details are kept only while the page is open.
- Thumbnails a guest's browser draws are in that browser's memory; nothing readable of a hidden item is written by the host.
