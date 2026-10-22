# canvast

**An offline-first endless canvas.** Pan in any direction and zoom in or out without ever reaching an edge or a zoom limit. Draw, write, place pictures, video and audio, and edit at whatever scale you reach. canvast is **one self-contained HTML file** that runs from your disk: no server, no account, no network connection.

- **Endless in every direction.** There is no minimum or maximum zoom and no border. A line drawn at one scale stays sharp at any other, and what you drew a thousand zoom levels ago is still there when you come back.
- **Yours, on your machine.** Everything is saved in your browser's own storage while you work. Nothing is uploaded, ever. Back up to a single `.canvast` file whenever you like.
- **Made for projects, with a Library for what they use.** Storyboards, mood boards, references, sketches: from a small board to a very large one. Pictures, video and files you place are kept in the Library, where you can tag, sort into folders, search and reuse them. canvast is not a warehouse for tens of thousands of files, because everything lives in your browser's storage, which has a size limit (see [Limitations](#limitations)).
- **One file.** Copy `canvast.html` anywhere (a folder, a USB stick) and open it.

![One continuous dive: from the observable universe, through the Solar System and Earth, into a leaf, its DNA and an atom](docs/screenshots/dive.webp)

*One continuous zoom in canvast, about 100 levels from the observable universe into a proton, followed by jumps to 1,000 and 1,000,000 levels down. Nothing is faked: every frame is the app drawing the showcase file below.*

### Try the showcase: powers of two

[`showcase.canvast`](showcase.canvast) is a journey through **one million and one thousand zoom levels** on a single canvas. Each scene is hidden inside a speck of the one above it, so you can get from one end to the other with nothing but the mouse wheel:

| Out (zoom out from home) | In (zoom into Earth) |
| --- | --- |
| The Solar System (home, level 0) | Earth, the Moon and a rocket (+5) |
| The heliosphere and the Voyager probes (−9) | An island with a reef and two boats (+12) |
| The Sun's neighbourhood, every star within 20 light years (−18) | A tree, seen from above (+19) |
| The Milky Way, with *You are here* (−27) | A leaf, its veins and pores (+25) |
| The Local Group: Andromeda, Triangulum, the Magellanic Clouds (−32) | Plant cells and their nuclei (+32) |
| The observable universe and its cosmic web (−40) | DNA (+40), a carbon atom (+47), its nucleus (+54) |
| Other universes, **1,000 levels up** | Inside a proton (+60), the Planck length (+116) |
| | Universes again at **+1,000**, and a last scene **one million levels down** |

To open it: click the save indicator at the bottom left, choose **Import archive…** and pick the file (or drop it on the page). Open the canvas *Powers of two*, then either scroll, or open **Bookmarks** and press **Play the bookmarks as a tour** (`→` and `←` step through its 19 stops).

![The journey, scene by scene](docs/screenshots/journey.webp)

| | |
| --- | --- |
| ![A heart one million zoom levels down](docs/screenshots/deep-zoom.webp) | ![Other universes, 1,000 zoom levels up](docs/screenshots/zoom-out.webp) |
| One million levels down: 10^301,030× magnified, still exact and editable | 1,000 levels up: our universe is the ringed bubble |

The showcase is drawn by `scripts/showcase/build.mjs`, which drives the app like a person would: it pastes SVG, combines shapes, draws with the Pen, writes the labels and adds the bookmarks. `scripts/showcase/dive.mjs` renders the animation, and `scripts/showcase/shots.mjs` takes the screenshots in the dark theme with the *Ultramarine* theme colour (Settings → Appearance).

![The Solar System, home of the showcase](docs/screenshots/hero.webp)

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
- **Bookmarks** save a place and a zoom, with a small picture of it. Rename, update, move up or down or delete them from their ⋯ menu, or drag a card to a new place in the list; the tour follows the list. The check-mark button saves a bookmark that brings the picked things into view (the camera stays where it is). `Alt+1`…`Alt+9` go to the first nine, `]` and `[` to the next and previous (all changeable in Shortcuts). A **tour** plays them in order: the bars fade, `→` and `←` step, `Esc` ends it; with *Tour: wait at each stop* set in Settings, it moves on by itself. Getting to a bookmark is a glide; a far one (another depth) zooms out from here and in to there (see *Camera travel* below).
- **Search** (`Ctrl+F`) finds objects by name, tag or bookmark. Combine words with space or `AND`, `OR`, `XOR`, `NOT`, parentheses and `"phrases"`. `/` searches names only, `#` tags only, `@` bookmarks only. Searches that found something are remembered, and a help card lists the syntax.
- **Step through items** with `W` `A` `S` `D` (nearest in view, nearest anywhere, or by layer; focus on the item or keep the zoom). `F` brings the selection into view; press it again to fit everything.
- **Jump anywhere:** click the zoom read-out and type a level. One jump can travel up to 2^50 levels.

![A tour of the bookmarks](docs/screenshots/tour.webp)

### Drawing

- **Pen** (`P`): four pens (fine, pencil, ink, marker) with pressure, tilt and a stabilizer. Size is 0.5–128 px. A stroke is made at the current scale, so a 3 px line drawn deep in a zoom is a 3 px line there, and it stays vector-sharp at every magnification. *Thickness lock* keeps strokes the same width on screen at any zoom.
- **Shapes** (`U`): rectangle, ellipse, line, polygon and star. Sides, points, ratio and per-corner radii stay editable after drawing.
- **Paths** (`B`) and **Edit nodes** (`N`): Bézier curves with handles, snapping, a lasso for several nodes, and node editing across several paths at once. *Simplify* fits a curve to a rough path; *Pen stroke to path* converts a stroke.
- **Fill and outline:** solid colour, linear, radial or angular gradient, a picture, or other objects of the canvas repeated over the shape (*Objects*). Outlines have a position (inside, centre, outside), corners, ends, dashes, arrow heads and a sharp-corner limit; the outline can be a gradient too.
- **Combine shapes:** union, intersect, subtract and exclude stay editable until you flatten them; *Divide* and the *Shape builder* split overlapping shapes; *Outline stroke* turns a line into a shape; *Taper* gives a line a variable width; *Corner smoothing* rounds corners continuously.
- **Vector networks:** paths that meet at vertices, with the regions between them filled. Edges are split where they cross.
- **Initial state:** *Set*, *Update* and *Reset to initial state* remember a shape's geometry (and, by default, its fill and outline) so you can experiment and go back. *Apply rotation* makes a shape's current turn its new zero.
- **Eraser** (`E`): removes whole objects (optionally whole groups), or trims strokes in scissors mode.
- **Eyedropper** (`I`): a click makes the colour under it the pen colour: one pixel, or the mean of a square of 3 to 101 px (*Sample size* in the Properties bar). On the canvas it reads the screen as drawn. The same tool is in the Paint view.
- **Names on the canvas:** a sheet, picture, video or file card shows its name above its top-left corner; any other item shows its layer name while picked. Where the names of picked items would overlap (a group picked whole, a sheet and what is on it), only the outermost is written, as design tools write the name of a frame or group and not of every layer in it.
- **Pattern** (panel, mountain button; with several sheets or shapes picked, Generate makes one pattern on each): 39 generators of vector patterns, grouped as Waves, Blobs, Soft, Lines, Tiles and Fields and shown as a grid of small pictures (Ripple, Tides, Drift, Bubbles, Glow, Grain, Stripes, Halftone, Tiles, Contours, Cells, Flow, Marble, Maze and more). Each has the settings of its own (counts, sizes, angles, colours, solid or outline), and a background you can hide. Pick a sheet or a closed shape first (the shape cuts the result to its outline) or let it make a new sheet; *Generate* makes the result, every change after that replaces it live, and the whole session is one undo step until *Done*. *Randomize* picks random settings and a new seed (a snowflake on a setting keeps it); *New seed* keeps the settings and says when the seed changes nothing; the seed can be typed (or dragged) to make a result again. The seed works in every generator: the regular ones (Stripes, Tiles, Halftone and the like) have a *Looseness* setting, and at 0 they stay exact. The result is a group of ordinary editable shapes that remembers its settings: pick it later and the panel shows them, and changes replace it where it is.
- **SVG:** paste SVG text to get editable paths (gradients, including a radial one sized by its own transform and an angular one written as a CSS conic gradient box, dashes, transforms, `<use>`, symbols and clip paths, which become clipping masks), or make a vector copy of an SVG picture. Export shapes as SVG, copy them as SVG text, or save them to the library as an SVG picture.

![Boolean shapes: the rocket is a Union, and the Shapes menu is open](docs/screenshots/shapes.webp)

### Colour and styles

- **Colour picker:** one picker for every colour. Choose OKHSL, OKHSV or OKHCL; a ring and box, a plane with a hue bar, or sliders; text as hex or another format. It also has an eyedropper, recent colours and saved colours. A number changes by dragging its name left or right; with `Shift` it snaps to round steps worked out from its range (steps of 5 for 0–100, 10 for 0–255).
- **Gradients:** linear, radial and angular, with stops you drag on the canvas, a *Randomize* button and a gradient map for pictures.
- **Palettes:** *Palette from a colour* builds harmonies, and a palette can be taken from a picture. Palettes and gradients can be imported and exported as `.gpl`, `.ase`, `.aco` and `.ggr` files.
- **Styles panel:** saved colours, gradients, text styles, adjustment stacks and patterns (a generator with its settings and seed, saved from the Pattern panel with the *Save as a style* button and updated from it; pressing its card puts it back in the Pattern panel and makes it on what is picked, on each of several picked shapes). An object painted with a saved style is **linked** to it and follows when the style changes. A change by hand, or *Detach*, unlinks it. A colour, gradient or palette card is copied by a long press or a right click on it (a palette as CSS variables; a colour inside an opened palette as hex), or by *Copy hex* / *Copy as CSS* in its More menu (a long press does not apply it); CSS pasted (a colour in any notation, or a gradient) is saved as a new style when the pointer is over the panel or nothing is picked.

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
- **Adjustments** are non-destructive stacks you can reorder, hide and copy between pictures, video, GIFs, shapes, pen strokes and texts: exposure, contrast, highlights, shadows, temperature, tint, saturation, vibrance, red/green/blue, levels, curves, gradient map, blur, sharpen and grain.
- **Crop**, rounded corners and an outline work on pictures, video and GIFs. A picture can be masked by a shape, by opacity or by brightness, or by a brush mask painted with the Pen.
- **Drop shadow and inner shadow** are in the Adjust panel, for pictures, shapes, strokes and texts: opacity, across, down, blur, spread and a colour each. Turning a shadow on starts it soft and a little below. Each group of adjustments has a *Reset* button that takes that group off. The offset and blur are shares of the object's own size (an offset of 100 is a tenth of it), so they look the same at any zoom. A picture's own pixels are not touched; its shadow is drawn beside it. A video that is playing shows no shadow while it plays (its paused frame does).
- **Adjustments on shapes, strokes and text** are applied to how the object looks once drawn (fill, outline, gradient and texture together); a blur is a share of the object's own size, so it does not change with zoom (far inside an object it keeps a width of at most about 330 px). Exporting a selection leaves room for a blur or a drop shadow. An exported SVG carries them as a filter on the shape, with room round the drawing for a blur, and making the SVG into shapes again brings the adjustments back (a vector PDF is drawn as a picture instead); see Limitations.
- **Make a new picture** bakes the crop and adjustments into a new library item; **Copy as picture** puts the result on the clipboard. **Copy** and **Paste adjustments** move a whole stack between items. An SVG picture can be turned into editable shapes with **Make vector copy**. **Show in library** opens the Library with the original picked.
- **Media player:** videos, audio and animated GIFs play on the canvas with a player right under the item. It has play and pause, a seek bar, step back and forward (seconds for video and audio, frames for GIFs), repeat, playback speed, volume, a waveform for audio, and a start and end to play only part of a file. The paused frame is saved. Playback continues when the item scrolls out of view.
- **Extract frame** turns the current frame of a video or GIF into a picture in the library (PNG, WebP or JPEG). Settings name it, file it in a folder and tag it, optionally placing it on the canvas.
- **File details:** EXIF, colour profile and codec information are shown. STL and OBJ 3D models and PDFs are kept as cards with a preview; any other file is kept as a card with its extension and can be downloaded again.
- **Import** by button, drag and drop, paste, or a whole folder. Files up to 256 MiB are accepted and decoded before being stored.

### Organizing

- **Layers panel:** group and nest, rename, hide, lock, re-stack, set opacity and blend mode, rotate. Select with `Ctrl` (toggle) and `Shift` (range).
- **Sheets and masks:** a *sheet* clips what it holds and has a ratio rather than a size; a *clipping mask* is a sheet of any shape. See [Shapes, sheets and masks](docs/reference/shapes-sheets-masks.md).
- **Snapping and arranging:** moving things, dragging a node and dragging the handles of a gradient snap to others with guide lines (the magnet toggle turns it off). A group, and a boolean group, counts as one thing for Align, distribute and Arrange; its shapes are lined up with each other only when you pick them one by one (in Layers, or inside the group). Align, distribute, arrange in a grid (by name, date, size or type), copy, cut, paste, duplicate; `Alt`+drag copies.
- **Tags** on the selection, with a Tags panel listing every tag and its count. Renaming or deleting a tag applies to every canvas.
- **Reveal:** hold `Ctrl` and move over the canvas to see the outline of everything under the pointer; `Ctrl`+click picks exactly that thing, even deep inside a group, mask or sheet. Click on a revealed outline and you get the thing the outline belongs to, even when a filled shape covers it; click anywhere else and you get the top thing there (`Ctrl`+`Alt`+click goes down the stack). A thing you have picked can then be moved by dragging its outline, even under a filled shape; a click that does not move still picks what is on top.
- **Sheets:** drawing a sheet (`C`) over objects puts the ones wholly inside it on the sheet (one undo step; ones it only crosses stay out); *Put the selection on a sheet*, *Fit to contents*, *Release*, ratio presets (`16:9`, `A4 portrait`, a number) and *Turn on its side*. Each object on a sheet has pins (left, right, both, centre or scale, per axis) that decide what it does when the sheet is resized, and *Scale contents* resizes everything with it.
- **Masks:** a clipping mask of any shape, a mask by opacity or brightness, or a brush mask painted in black and white with the Pen. Masks can be inverted, picked on their own and released. A click on a mask picks it as one unit; a double click goes inside.
- **Hide and lock:** *Show all hidden* and *Unlock all* bring everything back.
- **Kind chips:** with a mixed selection, chips at the start of the Actions bar (All, Pictures, Media, Shapes, Strokes, Texts) narrow it to one kind.

![Layers panel, with Jupiter picked exactly by Ctrl+click and its fill in the Properties bar](docs/screenshots/layers.webp)

### The interface

- **Tool rail** on the left: the tools, then Screenshot, Search, Import, Undo and Redo. **Properties bar** at the top: the options of the tool or of what is picked. A picked pen stroke, or several picked things, show their colours there as chips; a chip changes that colour everywhere it is used. Pasting CSS text with shapes picked makes it their fill: a gradient (`linear-gradient(...)`, `radial-gradient(...)`, `conic-gradient(...)`) or a colour (hex, `rgb()`, `hsl()`, `oklch()` and the other CSS notations, or a colour name such as `rebeccapurple`). In the colour picker a long press (or right click) on a swatch or a saved gradient copies it (hex, or CSS for a gradient) without choosing it; copying the hex field includes the `#` and pasting one drops it. Copy and paste use the same CSS text: the Styles panel copies a colour as hex and a gradient as CSS. **Actions bar**: what can be done with the selection, grouped in menus (Align, Arrange, Shapes, Masks, Path tools, Sheets, Export, Initial state) that list only what applies. It sits at the bottom or follows the selection. A bar wider than the window shows a fade and an arrow at the end with more; the mouse wheel (with or without Shift) scrolls it sideways.
- **Panels** (Layers, Bookmarks, Tags, Styles, Adjust, Pattern) float or dock to either side, are resizable, and can minimize when inactive. *Reset the panel layout* puts them back.
- **Command palette** (`Ctrl/⌘+K`) runs any command by name, takes a value where one is needed (`@kind` narrows the list), and records and replays **macros**. A right click on the canvas opens a menu of what fits.
- **Zen mode** (`Z`, or the leaf button) fades the bars and panels until the pointer is over them.
- **Screenshot** (camera button) saves the selection, or the whole view, to the library. Settings choose the format, quality, name, folder and tags. They also choose whether to include the canvas pattern and the interface, a transparent background, and a copy on the clipboard.
- **Previous view** and **Next view** walk your camera history; the **dice** goes to a random empty place.
- **Camera travel** (Settings → Navigation) is how the view reaches a bookmark or a previous view: *Fly* moves the camera along one continuous path. When one place is within a view of the other (nested views, a bookmark you can see), it is one zoom in or out, at any depth, with no zoom out first. Farther apart, up to 20,000 levels of zoom away (another depth or frame), it zooms out until the two places are about a view apart, crosses over and zooms in, so the way is seen; *Glide near only* cuts to far ones; *Cut* always arrives at once. The time can grow with the distance (up to *Longest trip*) or stay fixed, the easing is smooth, linear or ease-out, and a key or a drag during the glide ends it. On a trip more than a view apart and over 20,000 levels away (it zooms out 24 levels and in) the canvas dips dark for a moment at the switch (*Fade at the switch*, on by default); the tour has its own travel speed. Animation set to None always cuts; with the system's reduced-motion request the view cuts too and says so once, unless *Follow the system's reduced motion* is turned off. *Travel time (base)* sets the length of a short trip.
- **Read-outs:** the bottom left shows the zoom, position and save state. *Information shown* switches between simple and technical (exact zoom as a power of two, frame rate, diagnostics). The bottom-right buttons cycle the canvas pattern (grid and others) and the item names (always, when picked, hidden).
- **Hint line** at the bottom says what the tool does and what each key does over a handle. **Notices** report results, often with a *View* button that opens what was made; they stack above the Actions bar, never over it. Anything that makes you wait (exporting, importing, opening a library, moving files, deleting everything) shows a notice with a bar and the stage it is at, which stays until the work ends and then says the result.

![Command palette](docs/screenshots/command-palette.webp)

### The Library

Switch between **Canvas**, **Library** and **Paint** at the top left. The canvas keeps its view, selection and undo history while you are away.

- A gallery of every imported file with its size, type and usage ("4 uses · 3 canvases"), with search, filters by file type, sorting, list or grid layouts and adjustable thumbnails.
- A **viewer** with filmstrip, zoom, pan, slideshow and a details panel. The details show where an item is used, and **Show** takes you to it on the canvas at any depth. A button switches the background behind the picture, the controls can be hidden, and a double tap opens it on phones.
- **Folders** (an item lives in one folder, folders nest), **tags** (several per item, renamable), **favourites**, file types, and **Similar images** (duplicates and near-duplicates found by their pixels).
- **Rename** one item or many at once, with a preview: number them, replace text, add text or change the extension.
- **Export** items as a `.canvast` archive, download originals, or export all files as a plain ZIP sorted by file type or by folder.
- **Safe deletion:** an item in use cannot be deleted from the library. An original is erased only when nothing, including undo, can bring it back.
- **Missing originals** (for example after clearing site data, or a file taken out of the library folder) are flagged with their usage; importing the same file again restores every instance.
- **Library folder** (Chromium): in **Settings > Storage**, *Choose library folder…* keeps your files as plain files in a folder of your disk, named by their content and keeping their extension (`a07c9f….png`, so other programs can open them), instead of in the browser's storage, so the library is limited by your disk and not by the browser. *Move into folder* and *Move back to browser* move what is already there. The library index is kept up to date by itself a little after each change (a checkbox turns it off; **Save index** writes it at once). It is the hidden file `.canvast-index` beside the files: the whole workspace (boards, canvases, objects, names, tags, folders, styles, settings) without the files themselves. It is not a backup, and not a cache to delete: on another device it is your canvases (a backup, `.canvast`, is a different file and holds the files). On another device, choose the same folder: when it holds a library index you are offered to open it at once (**Open index** does the same later); the canvases are added and every file is matched by its name. Do this on a device that has no canvases of its own yet, or they are added a second time. After a restart the browser asks permission once more: press *Reconnect folder*. Do not move, rename or edit the files in that folder (canvast finds each one by its name); files kept before extensions were added get one with the *Add extensions* button on the card; backups (`.canvast`) hold their bytes as always.

| | |
| --- | --- |
| ![The Library](docs/screenshots/library.webp) | ![The viewer](docs/screenshots/viewer.webp) |
| The Library, filled by six screenshots of the showcase | The viewer with its filmstrip and details |

### Painting

**Paint** (at the top left, beside Library) is a view of its own for painting pixels, with its own rules: nothing in it zooms endlessly, and sizes are real units, not shapes. An open painting has the canvas's own bars: the same tool rail, Properties bar, Actions bar, dock and view controls, in the same places and with the same keys. A tool that is in both views is the same tool; the rail adds the **Brush** and the **Pencil** here (one button; its flyout picks which) and leaves out what only a canvas has (Sheet, Note, Import, Screenshot, Search).

- **Paintings.** The Paint view lists the workspace's paintings (open, rename, delete). An open painting's name and page size are beside the view tabs, where the canvas shows its board and canvas: the first button goes back to the list, the name opens the painting's menu (rename, page size, export, place on the canvas). **New painting** asks for a name and a page size: a preset (screen, 4K, square, A4 or Letter at 300 DPI, phone) or a width and height in px, in, cm or mm at a resolution (DPI); sizes are stored as whole pixels (100 × 50 mm at 300 DPI is 1181 × 591 px), up to 8192 px a side. The background is white, transparent or a colour.
- **Pages.** A painting has one or more pages, each with its own size, resolution, background and layers, in the strip at the bottom: click one to show it, **+** adds one after it (the same size), and its ⋯ menu renames, resizes (*Size and resolution…*: the pixels stay where they are; a larger page has empty room right and below), moves or deletes it.
- **Painting.** The **Brush** (`B`) and the **Eraser** (`E`) paint into the picked layer with pressure from a pen. Their options are in the Properties bar: the colour (the same colour as the canvas's Pen), size in page pixels, hardness, opacity (the most one stroke covers), flow (how much each dab adds, building up within the opacity), spacing, and whether the pen's pressure changes the size or the opacity. Each tool keeps its own values. `[` and `]` change the size; Alt-click picks a colour from the page; Shift-click draws a straight line from where the last stroke ended. On a vector layer the Eraser is the canvas's: it takes shapes away. The **Pencil** (`Shift+B`, or the Brush button's flyout) paints whole pixels with no smoothing, one pixel wide at first; with **Auto erase** in its options, a stroke that starts on a pixel of the paint colour erases instead. The **Eyedropper** (`I`) and Alt-click with a painting tool take the colour under the pointer as the paint colour, from the page as it looks (**All layers**, without the checkerboard) or from the picked layer alone (**Layer**), one page pixel or the mean of a square (*Sample size*).
- **Brushes.** The button at the start of a painting tool's options opens the **Brushes** panel: the library's brush presets in groups and folders, with a picture of each tip, as a list or as **Thumbnails** (the tips in a grid, with their sizes), and a box to find one by name. Pressing a preset gives it to the tool in use (its tip, dynamics and texture, and its size and tool settings when it keeps them); the button shows its tip. The library starts with 36 presets (General, Dry Media, Wet Media, Special Effects). **Save** keeps the tool's brush as a new preset in *Saved*; each preset's ⋯ menu renames or deletes it, and a group's ⋯ menu exports or deletes the group. **Import** takes Photoshop brush files (`.abr`, with their tips and settings, into a group named after the file) and canvast brush files (`.json`); the panel's ⋯ menu exports all the presets as either, and adds the built-in ones again. The presets belong to the whole library, like the saved styles, and travel with them in workspace backups (an import adds the ones the library does not have). The button at the end of the options opens **Brush settings**: the tool's brush, section by section, each section with its switch: Tip (size, hardness, spacing, angle, roundness, flip), Shape dynamics, Scattering, Texture, Dual brush, Colour dynamics, Transfer, Pose, Noise, Wet edges, Build-up and Smoothing; a jitter's *control* is pen pressure, tilt, wheel, rotation, fade or, for the angle, the stroke's direction, and once something controls it, its **curve** (folded under it) shapes the response: drag a point, click to add one, double-click to remove it. The Tip section also has the brush's **mode** (Normal, Multiply, Colour burn and the other blend modes) and **Choose a tip** (round, or any picture the presets use); Texture has **Choose a pattern** (noise, canvas, paper, dots, or a preset's picture). The **pin** in a section's heading keeps that section as it is when another preset is pressed. A change applies to the next stroke and is kept with the tool.
- **Layers** (a panel of the dock, on the right, top first; the dock's Layers button shows and hides it): **+** adds a layer above the picked one: a **paint layer**, a **vector layer**, a **fill layer** (the whole page in a colour, gradient or texture; its ⋯ menu changes the fill), an **adjustment layer** (exposure, colour, levels, curves and the rest of the canvas's Adjust panel, applied to everything below it; *Change the adjustment* opens its panel, whose numbers can be saved as a style), a **pattern** (one of the pattern generators over the page, as shapes; *New seed* in its ⋯ menu makes it again) or **a picture** imported from a file (kept in the library). The bin deletes the picked layer; each row has an eye, a lock, **clip to the layer below** (the layer shows only where the nearest layer under it that is not clipped has paint; several clipped layers in a row share that base) and **alpha lock** (the Brush only colours what already has paint, and the Eraser leaves it). Double-click a name to rename it; the ⋯ menu also moves the layer up or down, and **Rasterize** makes a vector, picture, pattern, fill or adjustment layer a paint layer of the same look, to paint on (the Brush, Pencil and Eraser paint only on paint layers). **Masks:** *Add a mask* in a layer's ⋯ menu (any kind of layer) gives it a **layer mask**, shown as a small picture in its row: while that picture is pressed, the painting tools paint the mask instead of the layer: dark paint hides that part of the layer, light paint or the Eraser shows it again. Press the layer's name to paint the layer again. The ⋯ menu turns the mask off and on, or deletes it; Rasterize draws a layer with its mask applied. Under the list: the picked layer's blend mode and opacity.
- **Vector layers.** A vector layer holds any number of shapes, paths, pen strokes, texts and pictures, edited with the canvas's own tools, bars, keys and gestures: **Select** (`V`: click to pick, drag what is picked, its handles resize and turn it, Shift and Alt as on the canvas, a box or Shift-click picks more), **Edit nodes** (`N`, or `Enter` on a picked shape), **Pen** (`P`, its kinds beside it), **Shape** (`U`: its kinds and *Path (curves)* beside it), **Lasso** (`L`) and **Text** (`T`: the canvas's text editor and its format bar). The Properties bar and the Actions bar work on what is picked as on the canvas (fill, outline, corners, align, boolean operations, masks, groups and the rest), and sizes are in screen pixels at the zoom, as on the canvas (the lock keeps a pen's width the same at any zoom). They draw into the picked vector layer; with a paint layer picked, the first thing drawn makes a new vector layer above it. The canvas's keys work on what is picked (`Delete`, `Ctrl/⌘+D`, `Ctrl/⌘+G`, `Ctrl/⌘+[` `]`, `Esc`, `Enter`), and every change is one step of the painting's undo. What is in a vector layer stays shapes, drawn exactly as on the canvas and sharp at any zoom, until it is rasterized.
- **Copy and paste.** With a vector tool, `Ctrl/⌘+C`, `X` and `V` copy, cut and paste shapes as on the canvas, into the picked vector layer (between the canvas and the Paint view too). With another tool, objects copied on the canvas come as a new vector layer, at the size they were seen at (fitted to the page), and a picture as a picture layer. Objects copied deep inside a zoom of the canvas cannot come to a page that way (copy them at the top level, or as a picture).
- **View.** The wheel zooms at the pointer (`Shift`+wheel pans sideways), the **Hand** (`H`, or `Space` held, or the middle button) drags the view, two fingers pan and pinch. The zoom goes from a sixteenth of the fitted page to 6400 %; pixels show as squares from 200 %. The view controls (bottom right) zoom out, zoom in and **fit** the page (`Ctrl+0`; `Ctrl+1` is 100 %). **Rotate and mirror the view** to draw at a comfortable angle or check a drawing: `4` and `6` turn it 15° left and right, `M` mirrors it (left and right swapped), `5` resets both; the angle button among the view controls shows the turn and opens the same choices. Only the view turns: the pixels, the layers and the export stay as they are, and every tool works on the turned view.
- **Undo** and **redo** (`Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` or `Ctrl+Y`) have a history of their own for the open painting: strokes, layers, pages and names.
- **To the canvas and out.** In the painting's menu, **Export the page as PNG** saves the page as a PNG of its size (what the view shows, without the checkerboard of a transparent page). **Place the page on the canvas** keeps the page as a picture in the library and puts it in the middle of the canvas view: from then on it is an ordinary picture there, and painting more does not change it.

### Exporting

**Copy to other apps.** `Ctrl/⌘+C` keeps the real objects for pasting back here and also puts on the system clipboard: shapes as SVG text plus a PNG picture; a picture as one PNG at full size, as it looks with its crop and adjustments; a GIF or video as the frame it shows; a shape with a picture or objects fill, or anything mixed, as a PNG of it as drawn (at most 1024 px on the long side). A picture goes alone, with no text, so an app that prefers text still gets the picture. **Pasting back in canvast** brings the objects back as they were (links, masks, crop, adjustments, exact positions) as long as nothing else was copied in between. Shapes and texts are known by their text on the clipboard, so they come back even from another tab; a picture or GIF is known only while this window keeps the focus, and after switching to another window it comes back as a new picture (see Limitations). Anything copied in another app is imported as before: an SVG as shapes, an image as a picture. Pasting in another app takes what it accepts; pasting in another app takes what it accepts. Browsers cannot put files (audio, PDF) on the clipboard, so those stay in canvast. `Ctrl/⌘+X` puts the text only (the shape is gone before a picture could be drawn).

**What you export is what you see.** Colours, widths and shapes are the ones stored in the document: nothing is changed by the theme when drawing or exporting. The default pen and outline colour is near-black on a light canvas and a light ink on a dark one, chosen when the shape is made and stored with it (*Change the old default ink to the canvas ink* in the command palette gives it to older drawings). Exports match the canvas in every format; the one thing SVG cannot say is an angular gradient: an SVG holds a picture of it (a PNG of up to 384 px a side, cut to the shape or the line) and, on the element, the real gradient: canvast reads it back, so *Make vector copy* or pasting the SVG gives the editable angular gradient again (other programs show the picture). The Export dialog and the SVG saves warn when a shape has one.

**Export…** works on a sheet, a picture or selected shapes. The size comes from the shape: type a width or height in px, in, cm or mm at 72–600 ppi, or choose a preset (A4, Full HD, a story, the picture's own pixels). Formats: PNG, WebP, JPEG, SVG and PDF (what is on a sheet that clips is cut to the sheet in every format, and the picture is framed by the part that shows), with a transparent, white or black background; download it, copy it or keep it in the library. PNG, JPEG and WebP carry their resolution. Several sheets export together as a ZIP or as one multi-page PDF whose pages you can reorder. Plain shapes export to PDF and SVG as true vectors, masks as SVG masks, and picture or pattern fills as embedded pictures clipped to the shape.

![Export dialog for the Earth, a clipping mask](docs/screenshots/export.webp)

---

## Keyboard and pointer reference

Every shortcut can be changed in **Settings → Shortcuts**: a single key or a chord, with several keys per command, and warnings when a key clashes with another command or the browser. Defaults:

| Action | Input |
| --- | --- |
| Zoom at pointer | Wheel · trackpad pinch · `Ctrl`+wheel |
| Zoom at centre | `+` / `−` (`Shift` = 4× step) |
| Pan | Middle-drag · `Space`+drag · Hand tool · two fingers · `Shift`+wheel · arrow keys |
| Return to origin | `0` · `Home` |
| Tools | `V` select · `P` pen · `L` lasso · `H` hand · `T` text · `M` note · `U` shape · `B` path · `N` nodes · `C` sheet · `I` eyedropper · `E` eraser |
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
| Paint view | `B` brush · `Shift+B` pencil · `I` eyedropper · `E` eraser · `V` select · `N` edit nodes · `P` pen · `U` shape (and path) · `L` lasso · `T` text (the canvas's tool keys, which can be changed in Settings; `B` is the Brush here and Path on the canvas) · `H` hand (`Space` held) · `[` `]` brush size · Alt-click picks a colour · Shift-click a straight line · `Ctrl/⌘+0` fit · `Ctrl/⌘+1` 100 % · `+` / `−` zoom · `4` / `6` turn the view · `M` mirror it · `5` reset · `Esc` drops the stroke being painted |

**Touch:** two-finger drag pans and pinches zooms; a two-finger tap is undo and a three-finger tap is redo; a long press on Select lists what is under the finger; a resting finger while another drags acts as `Shift`, two as `Alt`. Number fields change by dragging their name.

---

## Your data: saving, backups, export

### Saving

Every change is saved automatically within a fraction of a second, together with the camera, in your browser's IndexedDB. Only the objects that changed are written, in one atomic transaction, and then read back to check. The indicator shows *Unsaved changes… → Saving… → Saved → Saved (verified)*; click it to open **Settings > Storage**: space used, whether the browser keeps the data, the library folder, how saving is going (and the role of this tab) and backups. Reloading restores the canvas and the view.

If storage cannot be opened, canvast keeps working in memory and says so.

### Several tabs

The first tab to open a workspace edits it. Other tabs are read-only, follow its changes live, and offer **Take over**. A stale tab can never overwrite newer data; its save is rejected and reported.

### Backups

- **Export a backup** (Settings > Storage) downloads one `.canvast` file holding every board, canvas, object and view, every painting with its pages and layers, plus every original once, and your device settings (theme, shortcuts, panel layout). When you import it, only the settings this device has not set itself are restored; the ones you changed here are kept, and the import dialog says how many it will restore.
- A board, a canvas or a single library item can be exported on its own, with only the originals it uses.
- **Import archive…** (or drop a `.canvast` file on the page) verifies every checksum first, shows what it contains and any problems, and only then adds the boards, canvases and paintings in a single transaction. Nothing existing is replaced and originals you already have are not stored twice.
- A `.canvast` file is a standard, uncompressed ZIP you can open with any unzip tool. Do not re-compress it.
- Backups made in one browser import into another (tested between Chromium and Firefox).
- Incremental backups are available after the first full one.

The browser does not say whether a download finished, so keep your backups somewhere safe.

### What can delete data

Deleting objects; deleting a canvas or board (confirmed, cannot be undone; pictures placed there stay in the library); *Delete from library*, which erases an unused original once undo can no longer need it; and **Delete all data** (Settings > Storage, *Start from scratch*), which asks first, offers a backup, an export of the files and the library index, makes you type `DELETE`, and then removes everything canvast keeps in this browser. It never deletes files from your disk: the files in a library folder stay where they are. Nothing else removes anything. Damaged objects found on load are skipped and reported, never silently changed.

### Where the data lives

IndexedDB database `canvast`, in the browser's storage for local files. Moving the HTML file to another folder keeps your data. Opening it in a different browser, profile or private window does not, and clearing site data deletes it. This is why regular backups matter. The browser's storage has a size limit, so canvast suits projects rather than very large collections of files; see [Limitations](#limitations).

---

## Settings and accessibility

Open Settings with the gear button. Settings have a *device* scope and a *canvas* scope, can be searched, and reset individually (the undo-arrow icon at the end of a row) or together. Every group has an icon in the list on the left, and the groups are indented under their heading. Device settings travel in a workspace backup and in the library index (see Backups).

| Group | What it holds |
| --- | --- |
| Drawing and selection | Pen, colour picker model and layout, pen width and stabilizer, lasso filter, snapping, align to the selection box, grid spacing for Arrange, initial shape and paint, eraser |
| Navigation | How `W` `A` `S` `D` choose the next item; focus on the item or keep the zoom; camera travel (style, time, longest trip, easing) and the wait at each tour stop |
| Shortcuts | Rebind any shortcut to a key or a chord; the full list is also on `?` |
| Media and playback | Viewer edges, slideshow time, starting volume, step sizes, extracted frames and edited pictures (format, quality, folder, name, tags), and the folder and tags of what is saved to the library from the canvas, one pair for each kind: pictures from Export… (*Exports*, `export`), patterns (*Patterns*, `pattern`) and shapes saved as SVG (*Shapes*, `shape`); screenshots, extracted frames and edited pictures have their own in their own groups |
| Screenshot | Format, quality, pattern, transparency, interface, clipboard, folder, name and tags |
| Appearance | Theme (system, light, dark), theme colour (or adaptive, from the canvas background), colourfulness, information shown, hints and tooltips, canvas pattern, Actions bar place, item names, density (comfortable, compact, dense), round or sharp corners, Zen mode |
| Panels | Minimize inactive panels, panels kept open |
| Performance | Adaptive quality, fixed quality level, memory for pictures, animation and its speed |
| Storage | Space used and whether the browser keeps the data; the library folder (choose it, move files in and out, the library index and its automatic saving); how saving is going; backups (export, changes only, files as ZIP, import); *Start from scratch* (delete all data, after a warning with a backup offered first) |
| Privacy, Collaboration | What stays on your machine; collaboration (none) |
| About and diagnostics | Version and diagnostics |
| Develop | Developer tools (see below) |

- **Accessibility:** controls are keyboard reachable with visible focus; panels have title bars that work by keyboard; status changes are announced to screen readers; the system's reduced-motion preference is honoured and animation can be turned off; colour contrast is audited automatically.
- **Layouts** adapt to large, medium and phone-sized screens, with scroll cues on bars that scroll.

![Settings, Appearance](docs/screenshots/settings.webp)

---

## Limitations

canvast describes only what it does. These are the current limits.

- Shadows are not shown on a video or GIF while it plays. Adjustments (and shadows) are written to an exported SVG only for shapes (not pen strokes or text), as an SVG filter that matches the canvas closely but not exactly (curves, levels and the gradient map are sampled; grain differs). A shape bigger than about 8 million pixels on screen is drawn unadjusted. Grain on a shape is fixed to the screen pixels, not to the shape.
**Scale**

| Area | Limitation |
| --- | --- |
| Library size | The Library manages the files your projects use. It is not meant to hold a very large archive. Files are stored in the browser's storage for local files, whose size limit depends on the browser and on the free disk space, so a library that grows past it stops accepting new files, says so in plain words and loses nothing already stored. canvast asks the browser once to keep the data under storage pressure, and warns once when 80% of the browser's quota is used. In Chromium a *library folder* removes the limit (see Library); Firefox cannot offer one |
| What to do about it | Keep working files in canvast and long-term collections in your own folders. Use `.canvast` backups to move finished projects out, and *Delete from library* to free space |

**Content**

| Area | Limitation |
| --- | --- |
| PDF | A PDF is kept as a card with its page count; its pages are not rendered as pictures |
| 3D | Only STL and OBJ are read, and only as a preview card |
| Text | Complex scripts that need Indic shaping are not supported; OpenType positioning goes no further than kerning. Characters missing from the interface font fall back to a system font: their width then comes from the browser, so such text can wrap differently on another computer and pixelates at extreme depth |
| Vector networks | One fill for the whole network (no fill per region) |
| Angular gradient in SVG | SVG has no sweep gradient, so an SVG holds a picture of it (up to 384 px a side, about 300 KB), not vectors; the Export dialog, Save as SVG and Copy as SVG warn. A PDF of such a shape is made as a picture, and picture exports are exact |
| Pattern | A rotated sheet or shape is refused. A result is at most 600 shapes. Ungrouping a pattern, or moving one of its shapes out of its group, ends its link with the panel (the shapes stay as ordinary ones). Resizing the sheet scales the pattern as it does any content; it is not made again at the new size |
| SVG import | Text, patterns and masks inside an SVG are not imported; a dropped SVG file is placed as a picture (make a vector copy to edit it) |
| Boolean groups | Per-corner radii on a boolean result are not available |
| Eraser | Trimming works on strokes, not on vector paths |
| Files | Imports are limited to 256 MiB per file |
| Clipboard | Ctrl+C keeps the real objects for pasting back only while nothing else was copied: a picture copied for other apps pastes back as the objects only if the window kept the focus and the app copied nothing else in between (otherwise it comes back as a new picture, and shapes as an SVG import or a picture). A copy of a single picture, GIF or video is one PNG (a GIF or video is its current frame); files such as audio and PDF cannot be put on the system clipboard by a web page; Cut puts text only |
| Video | H.265 video from phones shows as a card on Firefox for Android (it still plays from the player) |

**Painting**

| Area | Limitation |
| --- | --- |
| Brushes | A tip or texture picture can be chosen only from the pictures the presets already use (import a brush file to bring new ones). A curve's point may be dragged below an earlier one, but the engine paints with the curve made rising (it never gives less for more pressure). An exported `.abr` keeps each tip and its spacing only (a canvast brush file keeps everything); a computed tip's name is not kept in it. A workspace backup carries every preset's tips in full each time, also in a backup of changes only |
| Tools | Brush, Pencil and Eraser only: no selections, fill bucket or gradient tool, no moving or transforming of a paint layer's pixels (Select moves what is on a vector layer), no smudge or retouch tools, no layer groups; a mask is painted with the painting tools only (no apply, invert or mask from a selection), in black or white (grey paint counts as one or the other) |
| Turned view | The touch long-press list of what is under a finger opens where the finger would be on an unturned view; the turned view draws a larger area (up to the stage's diagonal) |
| Vector layers | The canvas's panels (Adjust, Tags, Styles, Pattern, Bookmarks) and canvas-only tools (Sheet, Note, Import, Screenshot, Search, the camera history, the dice) are not in the Paint view; names above items are the canvas's only |
| Adjustment layers | Worked out on the CPU from the pixels below at the view's size each time the page is drawn, so a large page with several of them draws more slowly while zooming |
| Memory | Every layer of the page shown is held at its full size in memory (4 bytes a pixel: 8 MB per layer of a 1920 × 1080 page, 64 MB of a 4096 × 4096 one), and the brush engine holds the layer being painted once more |
| Speed | Measured headless on one machine: up to a 200 px brush paints in about 1 ms per frame; a fully soft 500 px brush takes up to about 10 ms, and ending a long stroke with it about 0.2 s |
| Pen | Pressure is read from the pen (Pointer Events); tilt and turn are passed to the engine but not used by these options. Not tested with a real tablet |
| Several tabs | A read-only tab shows paintings but does not follow another tab's changes to an open painting until it is opened again |
| Blend modes | The canvas's eleven (multiply, screen, overlay, darken, lighten, dodge, burn, hard and soft light, difference, exclusion) |
| Backups | Every backup, incremental ones too, holds all the paintings |
| On the canvas | A placed page is a copy: painting more does not update it |

**Scale and precision**

| Area | Limitation |
| --- | --- |
| Far trips | A trip to a bookmark that is more than a view apart and more than 20,000 levels of zoom away is not flown: it zooms out 24 levels from here and in to there, switching where both are tiny (with a brief dip to dark, unless turned off). A trip to a place within a view, however deep, is flown |
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
| Storage | Browsers cap local storage: Firefox gives a local file about 790 MiB, Chromium about 10 GiB (a Chromium library folder is not counted). With a library folder, files in it are outside the browser's protection: files removed there show as missing, and each session needs one click to allow access again. When the browser's storage is full, an import is refused with a notice that points to the backup and to *Delete from library*; edits stay queued and the indicator shows the error. Export backups regularly |
| Origin | Data belongs to the browser profile. Another browser, profile or private window starts empty |
| Rendering | Canvas 2D only, on the main thread; no GPU or WebGL path. The Paint view's brush engine runs in a worker, as WebAssembly |
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

Hierarchy: Workspace → Boards → Canvases. The IndexedDB schema (version 11) has stores for workspaces, boards, canvases, objects (one record each), per-canvas views, frames, bookmarks, thumbnails, assets, the asset catalog, metadata, and the Paint view's paintings, layers and tiles. Assets are content-addressed by SHA-256 and stored once; objects on the canvas reference them. A multi-tab **writer lease** guarantees a stale tab cannot overwrite newer data. Originals are removed only by reference-checked garbage collection. With a library folder an original is a file named `<sha256>.<ext>` (written, read back and compared before the browser keeps a stub of it: an `assets` record with an empty blob and `ext: 1`), so every rule keyed by hash is unchanged.

A `.canvast` archive holds a versioned `manifest.json`, one JSON file per canvas, each original once under `assets/<sha256>` and, in a workspace archive, `paintings.json` with each painting tile once under `paint-tiles/<sha256>` (checked by inflating and hashing it on import) and the brush presets in the manifest, their tip bitmaps beside the tiles (checked the same way), with a CRC on every entry. It is an uncompressed ZIP (ZIP64 beyond 4 GiB or 65,535 files). Import is verified completely before one transaction writes it.

### Painting

The Paint view keeps its own documents and never uses the canvas's coordinates. A page is a size in pixels; a layer is a record of its own (its page, its place in the stack, opacity, blend, hidden, locked, clipped, alpha lock) whose pixels are 256 px tiles, each named by the SHA-256 of its RGBA pixels and stored once, deflated (exact, unlike a PNG through a canvas, which shifts the colour of soft edges). Every edit, from any tool or panel, is a list of record replacements: applying it changes the records, draws again only the tiles that changed and stores the change (in one transaction, read back); undo applies the same list backwards, and since tiles are named by their pixels no pixel is copied for undo. A tile is erased only when no stored layer and no step of the open painting's history names it.

The brush engine is an open-source Rust engine (MIT; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) compiled to WebAssembly and inlined in the file, with the dab model of a professional painting program (tips, dynamics, opacity versus flow, lock transparency). It runs in a worker that holds only the layer being painted. While a stroke is painted the worker sends the stroke's coverage, 64 px at a time, and the view draws the layer with it; when the stroke ends the engine puts it on the layer once and the worker returns the changed tiles, hashed and deflated, as one undo step. Drawing a page (in the view and for an export, the same function) puts the background and the layers bottom to top with their opacity, blend and clipping; how each kind of layer looks is one entry of a registry typed over the kinds. A page pixel is a world unit of the canvas at zoom 0, so shape, text, picture, pattern and fill layers hold ordinary canvas objects (stored as the canvas stores them, checked by its reader) and are drawn by the canvas's own renderer through a camera made from the view's placement: fills, outlines, gradients, textures, fonts and pictures are the canvas's, not a copy. The picked vector layer is loaded into a document of the canvas (its store, index, view and editor state), and the canvas's own tools, text editor and overlays run on the Paint view's canvas with the view's camera; each finished edit replaces the layer's objects as one step of the painting's history, and an undo there loads the layer again. The canvas's bars (tool rail, Properties bar, dock, Actions bar, view controls) are mounted once and work on a switchable target: the canvas's document, editor, view, index and text editor, or, while the Paint view is shown, those of the picked vector layer; the bars stay where they are and the page is drawn under them. One list of rail tools and one keymap serve both views: each tool and each key command says which views it works in, and a key bound twice belongs to the command of the view it is pressed in. A layer mask is kept as tiles like a paint layer's, whose alpha is how much is hidden (a mask that hides nothing has no tiles); the engine paints it as it paints a layer, and drawing a layer takes the mask out of its look before its opacity and blend. To turn or mirror the view, the box the page is drawn in (the canvas, the cursor and the text editor) is turned by CSS inside the still stage, made large enough to cover it; the painting tools and the canvas's tools read the pointer through one function that undoes the turn and the mirror, so the camera and the stored coordinates never turn. The Eyedropper samples the page by drawing the square under it in page px with the same function that draws the page. An adjustment layer runs the canvas's adjustment maths on the page drawn below it. Brush presets are the engine's own brush JSON in one record of the database for the whole library; every bitmap in a brush (a sampled tip, a texture) is kept outside it, once, named by the SHA-256 of its samples beside the painted tiles, with a small preview in the preset, and the worker hands the engine each bitmap once, before the first stroke that needs it. The Brush settings panel is built from one schema of the engine's settings (paths in its brush JSON), the same that reads and writes the brush. Rasterize draws a layer's look once at 1:1 into tiles and replaces the layer in one undo step. Pictures, fonts and textures used by layers are kept by the library's GC.

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
  gen/           the pattern generators, a standalone module that imports nothing from the app: seeded random, geometry helpers, one pure function per pattern, an SVG writer
  colour-picker/ the colour picker, a standalone module that imports nothing from the app
  ui/            toolbars, panels, library, settings view, menus, player
  paint/         the Paint view's documents, history, storage, camera, drawing, tools, and the brush engine's worker
  app/           bootstrap, editor state, actions, debug hook
engine/          the brush engine's thin Rust wrapper (built to WebAssembly) and patches to its pinned source
scripts/         single-file build, offline check, naming and token checks
tests/           unit (Vitest) and end-to-end (Playwright)
docs/            reference notes, test logs, status
```

The colour picker can be built alone with `npm run build:picker`, and the pattern generators with `npm run build:patterns` (a script with the global `CanvastPatterns`, an ES module, TypeScript declarations and a demo page in `dist-patterns/`; see [src/gen/README.md](src/gen/README.md) for the API). Both are made to be published as packages of their own.

---

## Browser support

- Requires `BigInt`, Pointer Events, `ResizeObserver`, Canvas 2D and IndexedDB. Roughly Chromium 67+, Firefox 68+, Safari 14+.
- **Tested** in Chromium 156 (default, CPU-only, and devicePixelRatio 2 with touch) and Firefox 157 on Linux. **Not tested** in Safari.
- Firefox on `file://` supports everything canvast uses (IndexedDB, Web Locks, BroadcastChannel) with frame times close to Chromium's.

---

## Building and testing

Requires Node.js 26.4 (see `.nvmrc`) and npm, and for the Paint view's brush engine the Rust toolchain with the WebAssembly target (`rustup target add wasm32-unknown-unknown`). The first build fetches the engine's source at its pinned commit into `.engine-src/` (git, once) and applies `engine/patches/`; `npm run build` then compiles it with Cargo (about 50 s the first time, seconds after) and inlines it.

```sh
npm ci            # install pinned dev dependencies
npm run build     # → dist/canvast.html (minified, single file)
```

Open `dist/canvast.html` directly. Developer tools (frame times, camera internals, jump buttons, auto-zoom, the test hook) are in *Settings → Develop*, or add `#debug` to the address.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript check |
| `npm run test:unit` | Unit tests (seconds) |
| `npm test` | Typecheck, unit, quick end-to-end suite, token, picker and pattern-generator checks (about 16 min) |
| `npm run build:patterns` | Build the pattern generators alone into `dist-patterns/` (script, module, types, demo page); `npm run check:patterns` fails if they import from, or touch, anything outside their folder |
| `npm run test:full` | The full suite with long stress loops (about 50 min) |
| `npm run test:snap -- <files or -g pattern>` | Run chosen end-to-end specs |
| `npm run test:status` | List test builds with their result and how far each is behind the source |
| `npm run bench` | Scale and tile-cache benchmarks |
| `npm run check:offline` | Fail if the built file references anything outside itself |
| `npm run check:tokens` | Fail on a hard-coded colour, size, space or radius in the CSS |
| `npm run check:repro` | Build twice in different folders, time zones and locales and compare the SHA-256 |

Every end-to-end run builds its own copy of the app into `test-builds/` and tests that copy, so `dist/` can be rebuilt while tests run. Tests open the built file from `file://`, drive it through a debug hook, run in Chromium (three configurations) and Firefox, and fail on any network request. Test fixtures are generated in code; no binary fixtures are committed. Performance thresholds are fixed in advance and never loosened. Test logs with environments and timings are in [docs/testing/](docs/testing/); [docs/status.md](docs/status.md) is the status record.

### The showcase and the screenshots

```sh
npm run build
node scripts/showcase/build.mjs showcase.canvast            # draws the showcase in the app and exports it
node scripts/showcase/shots.mjs showcase.canvast shots/     # imports it in a fresh profile and takes the README pictures (PNG)
node scripts/showcase/dive.mjs showcase.canvast frames/     # renders the dive, frame by frame (PNG and frames.txt)
```

The README pictures are those PNGs converted to WebP (`cwebp -q 80`) in `docs/screenshots/`. The dive is the frames scaled to 800 px and joined with `img2webp` (`frames.txt` holds each frame's duration); the journey sheet is the frames where the dive pauses, set in a grid with ImageMagick `montage`.

### Reproducible build

The build is deterministic: the same source produces the same `canvast.html`, and `npm run build` prints its SHA-256. Dependencies are pinned to exact versions and line endings to LF.

---

## Security and privacy

- The page's Content Security Policy is `default-src 'none'` with no `connect-src`: it cannot make network requests, even if code tried. Only inline script and style are allowed, images come from `blob:` and `data:`, and workers from `blob:`. `'wasm-unsafe-eval'` lets the page compile the brush engine's WebAssembly, which is inside the file; it does not allow `eval`.
- canvast has no runtime dependencies and makes no network requests. The interface font is supplied from memory, so no font source is allowed either. `npm run check:offline` and the end-to-end suite both verify this on every build.
- Imports are limited to files of at most 256 MiB, and each is decoded before being stored. Files that fail to decode are rejected with a message.
- Archives are verified completely (structure, checksums and content hashes) before anything is written.
- No analytics, no telemetry, no account.

---

## Licences

canvast is released under the [MIT licence](LICENSE), copyright (c) 2026 emarpiee. The built file bundles the Lucide icons (ISC), the Inter font (SIL Open Font License 1.1) and the Paint view's brush engine (MIT); their notices are embedded at the top of `canvast.html` and listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Development-only dependencies, which are not shipped: TypeScript, esbuild, Vitest and Playwright.

A history of changes is in [CHANGELOG.md](CHANGELOG.md).
