# ADR 0134 — Importing a folder, and pictures from the clipboard

- Status: accepted (v0.18.1)

- **A folder** dropped on the window (read through the drop's file system entries, taken at once because they are gone when the handler ends) or chosen with the Assets view's Import folder button (`webkitdirectory`) brings in every file inside it, to 5,000 files and 16 levels, hidden files and folders (a name that starts with a dot) left out. Each file remembers the folders it came from (`src/app/directory.ts`), and once the import is done the files are put in library folders of the same names, nested the same way, made where missing and reused where they exist.
- **A picture on the system clipboard** (a screenshot) is pasted like a dropped file: it is placed on the canvas and kept in the library. This was already so; it now has a test (Chromium; Firefox ignores the data of a synthetic paste event).
- **A web address is not imported**: canvast makes no request (the test suite fails on any), so fetching a picture by its URL is not offered. Save the picture, or copy it, and drop or paste it.
