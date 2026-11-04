# ADR 0182: files too big to read into the page

**Status:** accepted (2026-11-04).

## Context

Most of the library reads a file whole into the page: 256 MiB was the limit, and a file past it in the desktop app could only be a card that stayed readable, out of backups, and could not be imported through the app.

## Decision

In the desktop build no operation needs a whole file in memory.

- **Reading:** `DiskFile` stands in for a Blob (`size`, `slice`, `arrayBuffer`, `text`, `stream`) and reads through the path-checked `canvast:part` (64 MiB a call). It refuses to become text, so `new Blob([file])` fails instead of writing `[object Object]`, and `arrayBuffer` refuses more than 1 GiB. Storing a record keeps its empty blob, so a DiskFile never goes into storage.
- **Writing:** `canvast:stream` writes to a temporary file beside the target, syncs it, reads it back for its SHA-256, and only then moves it into place. A failure leaves nothing at the target. Temporary files are swept like `writeAtomic`'s.
- **Encrypting:** the version 2 hidden file was already made of 1 MiB chunks, each with its own tag and number, so `sealFileTo` and `openFileAt` make and read the same format a part at a time. No format change, and older apps and the outside tool read these files. A cut, reordered or changed chunk fails the read. A readable file is erased only after the sealed file has been opened back from the disk and its hash proven.
- **SHA-256:** WebCrypto takes one whole buffer, so the page has `Sha256` for what only it can read (decrypted chunks, a chosen backup file).
- **ZIP:** `writeZip` with a DiskFile entry answers a `joined` DiskFile with the same bytes, so the existing check of a backup runs unchanged before the file is written. `saveFile` writes it with a save dialog.

## Limits

The browser build keeps the limit: it has no way to write a file a part at a time to a chosen place, and its database holds what it imports. A big file plays nowhere in the app; it stays a card.

## Consequences

Each such operation needs room on the disk for a second copy until it is proven. A backup with a big file reads it three times: its checksum, the check, the write.
