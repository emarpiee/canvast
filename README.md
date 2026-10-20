# canvast

**An offline-first endless canvas.** Pan in any direction and zoom in or out without ever reaching an edge or a zoom limit. Draw, write, place pictures, video and audio, and edit at whatever scale you reach. canvast is **one self-contained HTML file** that runs from your disk: no server, no account, no network connection.

- **Endless in every direction.** There is no minimum or maximum zoom and no border. A line drawn at one scale stays sharp at any other, and what you drew a thousand zoom levels ago is still there when you come back.
- **Yours, on your machine.** Everything is saved in your browser's own storage while you work. Nothing is uploaded, ever. Back up to a single `.canvast` file whenever you like.
- **One file.** Copy `canvast.html` anywhere (a folder, a USB stick) and open it.

## Contents

1. [Getting started](#getting-started)
2. [Using canvast](#using-canvast)
3. [Keyboard and pointer reference](#keyboard-and-pointer-reference)
4. [Your data: saving, backups, export](#your-data-saving-backups-export)
5. [Settings and accessibility](#settings-and-accessibility)
6. [Limitations](#limitations)
7. [How it works](#how-it-works)
8. [Browser support](#browser-support)
9. [Building and testing](#building-and-testing)
10. [Security and privacy](#security-and-privacy)
11. [Licences](#licences)

---

## Getting started

### Open it

Open `canvast.html` in a modern browser: double-click it, or use *File → Open*. No installation and no web server are needed. To build the file from source, see [Building and testing](#building-and-testing).

### Your first minutes

| To do this | Do this |
| --- | --- |
| Draw | Press `P` and drag |
| Add a shape | Press `U`, pick a shape, drag on the canvas |
| Write | Press `T`, click, type |
| Add a picture, video or audio | Drag the file onto the page, paste it, or use the Import button |
| Move around | Drag with the middle button, hold `Space` and drag, or use two fingers; scroll the wheel to zoom |
| Go back to the start | Press `0` or `Home` |
| Find any command | Press `Ctrl/⌘+K` |
| Undo | `Ctrl/⌘+Z` |

A small read-out shows the zoom level and position. Click it, type a level (`3000`, `2^-500`, `10^900`) and press Enter to jump there.

### Terms

| Term | Meaning |
| --- | --- |
| Canvas | One endless surface you draw on |
| Board | A group of canvases (a project, a topic) |
| Workspace | Everything you have: all boards, canvases and the library |
| Object | Anything placed on a canvas: a stroke, shape, path, text, picture, video, audio, GIF or file card |
| Library | The shared store of every imported file. Each file is stored once, and objects on any canvas are *instances* of it |
| Sheet | A shape that holds other objects and cuts them at its edge; the unit you export |
| Zoom level | `z` means 2^z screen pixels per world unit. Level 0 is the starting scale |

---

## Using canvast

### Navigating

- **Zoom** with the wheel, a trackpad pinch, `+` and `−`, or the on-screen buttons. The point under the pointer (or between your fingers) stays where it is.
- **Pan** with the middle button, `Space`+drag, the Hand tool (`H`), two fingers, `Shift`+wheel or the arrow keys.
- **Return** to the origin with `0`, `Home` or the house button. *Previous view* and *Next view* walk back and forth through where you have been; the dice button takes you to a random empty place.
- **Orientation aids:** a hierarchical grid, the axes and a live position read-out show where you are, even very deep.
- **Bookmarks** save a place and a zoom. A **tour** glides through them in order.
- **Search** (`Ctrl+F`) finds objects by name, tag or bookmark. Combine words with space or `AND`, `OR`, `XOR`, `NOT`, parentheses and `"phrases"`. `/` searches names only, `#` tags only, `@` bookmarks only.
- **Step through items** with `W` `A` `S` `D`; `F` brings the selection into view (press again to fit everything).

### Drawing

- **Pen** (`P`): four pens (fine, pencil, ink, marker) with pressure, tilt and a stabilizer. Size is 0.5–128 px. A stroke is made at the current scale, so a 3 px line drawn deep in a zoom is a 3 px line there, and it stays vector-sharp at every magnification. *Thickness lock* keeps strokes the same width on screen at any zoom.
- **Shapes** (`U`): rectangle, ellipse, line, polygon and star. Sides, points, ratio and per-corner radii stay editable after drawing.
- **Paths** (`B`) and **Edit nodes** (`N`): Bézier curves with handles, snapping, a lasso for several nodes, and node editing across several paths at once. *Simplify* fits a curve to a rough path; *Pen stroke to path* converts a stroke.
- **Fill and outline:** solid colour, linear, radial or angular gradient, a picture, or a pattern made of other objects. Outlines have a position (inside, centre, outside), corners, ends, dashes, arrow heads and a sharp-corner limit; the outline can be a gradient too.
- **Combine shapes:** union, intersect, subtract and exclude stay editable until you flatten them; *Divide* and the *Shape builder* split overlapping shapes; *Outline stroke* turns a line into a shape; *Taper* gives a line a variable width; *Corner smoothing* rounds corners continuously.
- **Vector networks:** paths that meet at vertices, with the regions between them filled.
- **Eraser** (`E`): removes whole objects, or trims strokes.
- **SVG:** paste SVG text to get editable paths, or make a vector copy of an SVG picture; export shapes as SVG.

### Text

- **Text** (`T`): click and type. A click makes a text as wide as its words; a drag makes a box of that width. Double-click to edit.
- **Formatting:** bold, italic, underline, strikethrough, links, colour and size of any range, headings, bulleted, numbered and nested lists. Text is stored as Markdown; **Copy Markdown** is one click away.
- **Look:** colour or gradient, outline, size, line height, letter spacing, alignment, auto or fixed width, paragraph spacing, indent, case, line limit, a set height, kerning, OpenType features and the axes of variable fonts.
- **Fonts:** import `.ttf`, `.otf`, `.woff` or `.woff2` into the library, including variable fonts. One text may use several fonts. Right-to-left and mixed-direction text are supported.
- **Text on a path**, and **Text to path** (`Ctrl+E`) to turn letters into editable outlines.
- **Notes** (`M`): a text on a coloured card.
- **No zoom limit:** zoom into a letter as far as you like; the font's real outlines are drawn.

### Pictures, video, audio and other files

- **Pictures** are placed one source pixel to one screen pixel. Zooming in shows real pixels; nothing is invented and the original is never altered.
- **Adjustments** are non-destructive stacks you can reorder, hide and copy between pictures, video and GIFs: exposure, contrast, highlights, shadows, temperature, tint, saturation, vibrance, red/green/blue, levels, curves, gradient map, blur, sharpen and grain.
- **Crop**, rounded corners and an outline work on pictures, video and GIFs. A picture can be masked by a shape, by opacity or by brightness, or by a brush mask painted with the Pen.
- **Video, audio and GIF** play on the canvas with a player: seek, step, repeat, speed and volume, a waveform for audio, a trimmed range, and **Extract frame** to turn the current frame into a picture. Playback continues when the item scrolls out of view.
- **File details:** EXIF, colour profile and codec information are shown. STL and OBJ 3D models and PDFs are kept as cards with a preview; any other file is kept as a card with its extension and can be downloaded again.
- **Import** by button, drag and drop, paste, or a whole folder. Files up to 256 MiB are accepted and decoded before being stored.

### Organizing

- **Layers panel:** group and nest, rename, hide, lock, re-stack, set opacity and blend mode, rotate. Select with `Ctrl` (toggle) and `Shift` (range).
- **Sheets and masks:** a *sheet* clips what it holds and has a ratio rather than a size; a *clipping mask* is a sheet of any shape. See [Shapes, sheets and masks](docs/reference/shapes-sheets-masks.md).
- **Snapping and arranging:** moving things snaps to others with guide lines. Align, distribute, arrange in a grid (by name, date, size or type), copy, cut, paste, duplicate; `Alt`+drag copies.
- **Tags** on the selection, with a Tags panel listing every tag and its count. Renaming or deleting a tag applies to every canvas.
- **Reveal:** hold `Ctrl` and move over the canvas to see the outline of everything under the pointer; `Ctrl`+click picks exactly that thing, even deep inside a group, mask or sheet.
- **Linked styles:** an object painted with a saved colour, gradient or adjustment follows it when it changes.

### The Library

Switch between **Canvas** and **Library** at the top left. The canvas keeps its view, selection and undo history while you are away.

- A gallery of every imported file with its size, type and usage ("4 uses · 3 canvases"), with search, filters by file type, sorting, list or grid layouts and adjustable thumbnails.
- A **viewer** with filmstrip, zoom, pan, slideshow and a details panel; the details show where an item is used, and **Show** takes you to it on the canvas at any depth.
- **Folders** (an item lives in one folder, folders nest), **tags** (several per item, renamable), **favourites**.
- **Safe deletion:** an item in use cannot be deleted from the library. An original is erased only when nothing, including undo, can bring it back.
- **Missing originals** (for example after clearing site data) are flagged with their usage; importing the same file again restores every instance.

### Exporting

**Export…** works on a sheet, a picture or selected shapes. The size comes from the shape: type a width or height in px, in, cm or mm at 72–600 ppi, or choose a preset (A4, Full HD, a story, the picture's own pixels). Formats: PNG, WebP, JPEG, SVG and PDF. Several sheets export together as a ZIP or as one multi-page PDF whose pages you can reorder. A **screenshot** button saves the current view to the library. Plain shapes export to PDF and SVG as true vectors, masks as SVG masks, and picture or pattern fills as embedded pictures clipped to the shape.

---

## Keyboard and pointer reference

Every shortcut can be changed in **Settings → Shortcuts**: a single key or a chord, with several keys per command, and warnings when a key clashes with another command or the browser. Defaults:

| Action | Input |
| --- | --- |
| Zoom at pointer | Wheel · trackpad pinch · `Ctrl`+wheel |
| Zoom at centre | `+` / `−` (`Shift` = 4× step) |
| Pan | Middle-drag · `Space`+drag · Hand tool · two fingers · `Shift`+wheel · arrow keys |
| Return to origin | `0` · `Home` |
| Tools | `V` select · `P` pen · `L` lasso · `H` hand · `T` text · `M` note · `U` shape · `B` path · `N` nodes · `C` sheet · `E` eraser |
| Undo · redo | `Ctrl/⌘+Z` · `Ctrl/⌘+Shift+Z` or `Ctrl+Y` |
| Copy · cut · paste · duplicate | `Ctrl/⌘+C` · `X` · `V` · `D` |
| Select all · clear · cancel a gesture | `Ctrl/⌘+A` · `Esc` |
| Delete | `Delete` · `Backspace` |
| Command palette | `Ctrl/⌘+K` (`@kind` narrows it; commands can take a value; macros record and replay) |
| Context menu | Right-click the canvas |
| Search | `Ctrl+F` (library: `Ctrl+Shift+F`) |
| Focus on selection · fit everything | `F` · `F` again |
| Step to next item | `W` `A` `S` `D` |
| Zen mode | `Z` (bars fade out until the pointer is over them) |
| Text editing | `Ctrl/⌘+B` · `Ctrl/⌘+I` · `Tab` nests a list item · `Esc` or `Ctrl/⌘+Enter` finishes |
| Resize | Drag a handle; `Shift` keeps proportions, `Alt` resizes about the middle, `Ctrl` turns snapping off |
| Copy by dragging | `Alt` as the drag starts |
| Layer selection | `Ctrl`+click toggles · `Shift`+click selects a range |
| Jump to a zoom level | Click the zoom read-out, type `3000`, `2^-500` or `10^900`, Enter |

**Touch:** two-finger drag pans and pinches zooms; a two-finger tap is undo and a three-finger tap is redo; a long press on Select lists what is under the finger; a resting finger while another drags acts as `Shift`, two as `Alt`. Number fields change by dragging the field itself.

---

## Your data: saving, backups, export

### Saving

Every change is saved automatically within a fraction of a second, together with the camera, in your browser's IndexedDB. Only the objects that changed are written, in one atomic transaction, and then read back to check. The indicator shows *Unsaved changes… → Saving… → Saved → Saved (verified)*; click it for the storage panel (role of this tab, space used, persistence permission and backup status). Reloading restores the canvas and the view.

If storage cannot be opened, canvast keeps working in memory and says so.

### Several tabs

The first tab to open a workspace edits it. Other tabs are read-only, follow its changes live, and offer **Take over**. A stale tab can never overwrite newer data; its save is rejected and reported.

### Backups

- **Export workspace backup** (storage panel) downloads one `.canvast` file holding every board, canvas, object and view, plus every original once.
- A board, a canvas or a single library item can be exported on its own, with only the originals it uses.
- **Import archive…** (or drop a `.canvast` file on the page) verifies every checksum first, shows what it contains and any problems, and only then adds the boards and canvases in a single transaction. Nothing existing is replaced and originals you already have are not stored twice.
- A `.canvast` file is a standard, uncompressed ZIP you can open with any unzip tool. Do not re-compress it.
- Backups made in one browser import into another (tested between Chromium and Firefox).
- Incremental backups are available after the first full one.

The browser does not say whether a download finished, so keep your backups somewhere safe.

### What can delete data

Deleting objects; deleting a canvas or board (confirmed, cannot be undone; pictures placed there stay in the library); and *Delete from library*, which erases an unused original once undo can no longer need it. Nothing else removes anything. Damaged objects found on load are skipped and reported, never silently changed.

### Where the data lives

IndexedDB database `canvast`, in the browser's storage for local files. Moving the HTML file to another folder keeps your data. Opening it in a different browser, profile or private window does not, and clearing site data deletes it. This is why regular backups matter.

---

## Settings and accessibility

Open Settings with the gear button. Settings have a *device* scope and a *canvas* scope, can be searched, and reset individually or together.

| Group | Examples |
| --- | --- |
| Appearance | Theme (system, light, dark), adaptive theme colour from the canvas background, density (comfortable, compact, dense), round or sharp corners, Actions bar at the bottom or following the selection |
| Shortcuts | Rebind any shortcut; the full list is also on `?` |
| Navigation | How `W` `A` `S` `D` choose the next item; focus on the item or keep the zoom |
| Drawing | Pen defaults, initial shape and paint for new shapes |
| Screenshot | Format, name, folder, tags and content |
| Motion | Reduced motion and animation |
| Develop | Developer tools (see below) |
| About | Version, diagnostics, storage |

- **Accessibility:** controls are keyboard reachable with visible focus; panels have title bars that work by keyboard; status changes are announced to screen readers; reduced-motion and contrast options are honoured; colour contrast is audited automatically.
- **Layouts** adapt to large, medium and phone-sized screens, with scroll cues on bars that scroll.

---

## Limitations

canvast describes only what it does. These are the current limits.

**Content**

| Area | Limitation |
| --- | --- |
| PDF | A PDF is kept as a card with its page count; its pages are not rendered as pictures |
| 3D | Only STL and OBJ are read, and only as a preview card |
| Text | Complex scripts that need Indic shaping are not supported; OpenType positioning goes no further than kerning. Characters missing from the interface font fall back to a system font: their width then comes from the browser, so such text can wrap differently on another computer and pixelates at extreme depth |
| Vector networks | One fill for the whole network (no fill per region) |
| SVG import | Text, patterns and masks inside an SVG are not imported; a dropped SVG file is placed as a picture (make a vector copy to edit it) |
| Boolean groups | Per-corner radii on a boolean result are not available |
| Eraser | Trimming works on strokes, not on vector paths |
| Files | Imports are limited to 256 MiB per file |
| Video | H.265 video from phones shows as a card on Firefox for Android (it still plays from the player) |

**Scale and precision**

| Area | Limitation |
| --- | --- |
| Camera precision | After zooming out more than 4,096 levels beyond the deepest point and back in, the view returns to within 2^-96 px of the original rather than exactly |
| Very deep views | Magnification has no limit, but each level of depth enlarges the numbers involved, so extreme depths cost more CPU per frame |
| Dense scenes | With thousands of strokes visible at once, zooming shows a briefly scaled image of the last exact frame and snaps to the exact picture about 150 ms after you stop |
| Far zoom-out | Content too small to draw is shown as a soft mark in its own colour (pictures as grey). Marks cannot be selected; zoom in to edit |
| Very large documents | A board of one million objects needs about 940 MB of memory and about 6 s to build its index on load |
| Large libraries | Libraries of many thousands of items, and backups of many gigabytes, have not been measured |
| Frame rate | Measured on one desktop machine; no results exist for other device classes |

**Platform**

| Area | Limitation |
| --- | --- |
| Storage | Browsers cap local storage: Firefox gives a local file about 790 MiB, Chromium about 10 GiB. Export backups regularly |
| Origin | Data belongs to the browser profile. Another browser, profile or private window starts empty |
| Rendering | Canvas 2D only, on the main thread; no GPU or WebGL path, no workers |
| Browsers | Tested on Chromium and Firefox on one Linux machine. Safari has not been tested. Touch is tested by emulation |
| Collaboration | None. There is no network by design |

**Left out on purpose:** ratings, saved searches, a minimap (there are no bounds to map).

---

## How it works

This part is for readers who want to know why canvast behaves as it does.

### Exact coordinates

Positions are not floating-point numbers. Each coordinate is a **dyadic number**: a `BigInt` mantissa times 2^exponent, so any position at any distance from the origin is stored exactly. The camera is a centre plus an integer-quantized log2 zoom, which makes zooming and panning exactly reversible. Plain doubles appear only when drawing, and only relative to the camera or to a cell, never as stored world positions.

When the view is very deep inside an object, drawing and picking switch to exact arithmetic for that object; sizes in the numbers grow with depth, but nothing is clamped. Nested coordinate frames keep the cost per frame flat however deep you go.

### Rendering

Rendering is CPU-first **Canvas 2D**.

- **Shared projection:** drawing and hit-testing use the same object-to-screen projection, so what you see is what you pick.
- **Spatial index:** a multi-scale index (levels × `BigInt` cells) with no world bounds returns the visible objects. Off-screen content costs almost nothing, even when it is 2^5000 away.
- **Level of detail:** content far below a pixel is skipped or summarized; identical opaque strokes are drawn in one call.
- **Raster tile cache** for committed objects keeps panning and drawing over dense scenes near 2–3 ms per frame, and a bounded **zoom preview** keeps zooming responsive.
- **Deep zoom into any kind of object:** every kind has a sampler so its colour never disappears when the view is inside it.
- **Text** uses the browser's glyphs normally and the font's exact outlines past about 2,000 px per letter.

Measured on a CPU-only configuration with about 500 visible objects: 1.7 ms per frame (p50) with 10 thousand objects in the document, 2.2 ms with 100 thousand, 7.7–9.6 ms with one million.

### Editing model

1. Input produces a transient preview, which is never stored.
2. On pointer-up the gesture becomes one validated transaction.
3. The document store applies it and reports the changed ids; the spatial index and undo history are updated, and the canvas redraws.
4. After a 150 ms debounce the changed objects are written in one atomic, revision-checked IndexedDB commit, then read back to verify it.

Every object is validated before it enters the document or is loaded: finite numbers, known kinds, well-formed ids and hashes.

### Storage

Hierarchy: Workspace → Boards → Canvases. The IndexedDB schema (version 9) has stores for workspaces, boards, canvases, objects (one record each), per-canvas views, frames, bookmarks, thumbnails, assets, the asset catalog and metadata. Assets are content-addressed by SHA-256 and stored once; objects on the canvas reference them. A multi-tab **writer lease** guarantees a stale tab cannot overwrite newer data. Originals are removed only by reference-checked garbage collection.

A `.canvast` archive holds a versioned `manifest.json`, one JSON file per canvas and each original once under `assets/<sha256>`, with a CRC on every entry. It is an uncompressed ZIP (ZIP64 beyond 4 GiB or 65,535 files). Import is verified completely before one transaction writes it.

### Source layout

```
src/
  core/          exact numbers (dyadic) and the camera
  doc/           objects, transactions, document store, undo/redo, groups, clipboard
  render/        projection, drawing, hit-testing, tile cache, density preview
  scene/         multi-scale spatial index
  text/          font reading, Markdown model, layout
  interaction/   navigation, tools, snapping, pens, item stepping
  assets/        content addressing, decoding, catalog, garbage collection
  storage/       IndexedDB, workspace repository, persistence, writer lease, ZIP, archives
  search/        boolean query parser and evaluator
  settings/      declared settings, scopes, rebindable shortcuts
  commands/      command registry, palette providers, macros
  colour-picker/ the colour picker, a standalone module that imports nothing from the app
  ui/            toolbars, panels, library, settings view, menus, player
  app/           bootstrap, editor state, actions, debug hook
scripts/         single-file build, offline check, naming and token checks
tests/           unit (Vitest) and end-to-end (Playwright)
docs/            reference notes, test logs, status
```

The colour picker can be built alone with `npm run build:picker`.

---

## Browser support

- Requires `BigInt`, Pointer Events, `ResizeObserver`, Canvas 2D and IndexedDB. Roughly Chromium 67+, Firefox 68+, Safari 14+.
- **Tested** in Chromium 156 (default, CPU-only, and devicePixelRatio 2 with touch) and Firefox 157 on Linux. **Not tested** in Safari.
- Firefox on `file://` supports everything canvast uses (IndexedDB, Web Locks, BroadcastChannel) with frame times close to Chromium's.

---

## Building and testing

Requires Node.js 26.4 (see `.nvmrc`) and npm.

```sh
npm ci            # install pinned dev dependencies
npm run build     # → dist/canvast.html (minified, single file)
```

Open `dist/canvast.html` directly. Developer tools (frame times, camera internals, jump buttons, auto-zoom, the test hook) are in *Settings → Develop*, or add `#debug` to the address.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript check |
| `npm run test:unit` | Unit tests (seconds) |
| `npm test` | Typecheck, unit, quick end-to-end suite, token and picker checks (about 16 min) |
| `npm run test:full` | The full suite with long stress loops (about 50 min) |
| `npm run test:snap -- <files or -g pattern>` | Run chosen end-to-end specs |
| `npm run test:status` | List test builds with their result and how far each is behind the source |
| `npm run bench` | Scale and tile-cache benchmarks |
| `npm run check:offline` | Fail if the built file references anything outside itself |
| `npm run check:tokens` | Fail on a hard-coded colour, size, space or radius in the CSS |
| `npm run check:repro` | Build twice in different folders, time zones and locales and compare the SHA-256 |

Every end-to-end run builds its own copy of the app into `test-builds/` and tests that copy, so `dist/` can be rebuilt while tests run. Tests open the built file from `file://`, drive it through a debug hook, run in Chromium (three configurations) and Firefox, and fail on any network request. Test fixtures are generated in code; no binary fixtures are committed. Performance thresholds are fixed in advance and never loosened. Test logs with environments and timings are in [docs/testing/](docs/testing/); [docs/status.md](docs/status.md) is the status record.

### Reproducible build

The build is deterministic: the same source produces the same `canvast.html`, and `npm run build` prints its SHA-256. Dependencies are pinned to exact versions and line endings to LF.

---

## Security and privacy

- The page's Content Security Policy is `default-src 'none'` with no `connect-src`: it cannot make network requests, even if code tried. Only inline script and style are allowed, images come from `blob:` and `data:`, and workers (if any) from `blob:`.
- canvast has no runtime dependencies and makes no network requests. The interface font is supplied from memory, so no font source is allowed either. `npm run check:offline` and the end-to-end suite both verify this on every build.
- Imports are limited to files of at most 256 MiB, and each is decoded before being stored. Files that fail to decode are rejected with a message.
- Archives are verified completely (structure, checksums and content hashes) before anything is written.
- No analytics, no telemetry, no account.

---

## Licences

canvast's own code has no published licence yet. The built file bundles the Lucide icons (ISC) and the Inter font (SIL Open Font License 1.1); their notices are embedded at the top of `canvast.html` and listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Development-only dependencies, which are not shipped: TypeScript, esbuild, Vitest and Playwright.

A history of changes is in [CHANGELOG.md](CHANGELOG.md).
