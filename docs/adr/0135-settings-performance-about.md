# ADR 0135 — Performance settings, About and diagnostics

- Status: accepted (v0.18.1)

- **Performance** gains **Quality when adaptive quality is off** (Full, Balanced, Fast: the canvas is held at that level; with adaptive quality on the governor moves it, as before) and **Memory for pictures** (the budget of decoded pictures: 128 MB to 1.5 GB, default 384 MB). Both are device settings that apply at once. The drawing backend is Canvas 2D: the browser decides about the graphics card; there is nothing to choose.
- **About and diagnostics** (a tab of its own): the version, what this browser can do (IndexedDB, several tabs, OffscreenCanvas, video decoding, Brotli, persistent storage, clipboard pictures, folder import), the errors of this session (`window` errors and rejected promises, the last 100, `src/app/diagnostics.ts`), the licences (`THIRD_PARTY_NOTICES.md`, taken into the page at build time), and **Save a diagnostic report**: a text file with the version, the browser, the capabilities, the settings that differ from their defaults and the errors. It holds no canvas content, and nothing is sent: the person sends the file.
- **Privacy** and **Collaboration** stay plain statements (nothing leaves the device; collaboration is off), as they are true of this version.
