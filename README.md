<h1 align="center"><img src="docs/brand/cover.webp" width="100%" alt="canvast: every point is a canvas. An offline-first endless canvas: one HTML file, no account, works offline."></h1>

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

The showcase is drawn by `scripts/showcase/build.mjs`, which drives the app like a person would: it pastes SVG, combines shapes, draws with the Pen, writes the labels and adds the bookmarks. The labels are set in **Space Grotesk** (SIL Open Font License 1.1, in `scripts/showcase/fonts/`), which the script imports into the Library and chooses in the Text tool, so the two font files travel inside `showcase.canvast` like any library file. On the bright scenes (the island, the tree, the cells, DNA and the proton) the text sits on a dark plate, and the script measures the contrast of every label against the pixels behind it (WCAG 2: 4.5 : 1 under 24 px, 3 : 1 from 24 px) and reports any below it; the last build had none (the tightest is 4.69 : 1). `scripts/showcase/dive.mjs` renders the animation, and `scripts/showcase/shots.mjs` takes the screenshots in the dark theme with the *Ultramarine* theme colour (Settings → Appearance).

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

Open `canvast.html` in a modern browser: double-click it, or use *File → Open*. No installation and no web server are needed. On Linux there is also a desktop app, whose workspace is a folder of ordinary files (see [The desktop app](#the-desktop-app-linux)). The newest build is always attached to the [latest release](https://github.com/emarpiee/canvast/releases/latest) (direct link: [`canvast.html`](https://github.com/emarpiee/canvast/releases/latest/download/canvast.html), with its SHA-256 beside it); each release's notes list its **Features** and its **Fixes** separately. To build the file from source, see [Building and testing](#building-and-testing).

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
- **Step through items** with `W` `A` `S` `D`: the nearest in view (when you are zoomed in on an item and nothing is near enough on the screen, the nearest of its size that way, however far), the nearest anywhere, by layer or by name A to Z (each either among the items in the window or among all of them; `W` and `A` go back, `S` and `D` on). On arriving, focus on the item or keep the zoom. `F` brings the selection into view; press it again to fit everything.
- **Jump anywhere:** click the zoom read-out and type a level. One jump can travel up to 2^50 levels.

![A tour of the bookmarks](docs/screenshots/tour.webp)

### Drawing

- **Pen** (`P`): four pens (fine, pencil, ink, marker) with pressure, tilt and a stabilizer. Size is 0.5–128 px. A stroke is made at the current scale, so a 3 px line drawn deep in a zoom is a 3 px line there, and it stays vector-sharp at every magnification. *Thickness lock* keeps strokes the same width on screen at any zoom.
- **Shapes** (`U`): rectangle, ellipse, line, polygon and star. Sides, points, ratio and per-corner radii stay editable after drawing.
- **Paths** (`B`) and **Edit nodes** (`N`): Bézier curves with handles, snapping, a lasso for several nodes, and node editing across several paths at once. *Simplify* fits a curve to a rough path; *Pen stroke to path* converts a stroke.
- **Fill and outline:** solid colour, linear, radial or angular gradient, a picture, or other objects of the canvas repeated over the shape (*Objects*, which follows those objects as you change them, during the drag and not only on release). A repeated fill can **vary each copy**: turn it (by up to ± an angle, or in whole steps), size it, move it in its cell, mirror some, leave some cells out, copy each object on its own (in turn or shuffled) or the whole arrangement, from a seed that gives the same copies every time (*New seed* for others). New shapes have no outline: set a width (or move the Outline width slider off its left end) to add one. Outlines have a position (inside, centre, outside), corners, ends, dashes, arrow heads and a sharp-corner limit; the outline can be a gradient too.
- **Combine shapes:** union, intersect, subtract and exclude stay editable until you flatten them; *Divide* and the *Shape builder* split overlapping shapes; *Fill gaps* fills every empty place the picked shapes close in (with the Shape tool's fill, under them), and *Fill a gap…* fills the ones you click, one by one; a place left open by a slit narrower than a few px (4 by default, in Settings) counts as closed, and its fill stops at the slit; *Outline stroke* turns a line into a shape; *Taper* gives a line a variable width; *Corner smoothing* rounds corners continuously.
- **Vector networks:** paths that meet at vertices, with the regions between them filled. Edges are split where they cross.
- **Initial state:** *Set*, *Update* and *Reset to initial state* remember a shape's geometry (and, by default, its fill and outline) so you can experiment and go back. *Apply rotation* makes a shape's current turn its new zero.
- **Eraser** (`E`): removes whole objects (optionally whole groups), or trims strokes in scissors mode.
- **Names on the canvas:** a sheet, picture, video or file card shows its name above its top-left corner; any other item shows its layer name while picked. Where the names of picked items would overlap (a group picked whole, a sheet and what is on it), only the outermost is written, as design tools write the name of a frame or group and not of every layer in it.
- **Pattern** (panel, mountain button; with several sheets or shapes picked, Generate makes one pattern on each): 39 generators of vector patterns, grouped as Waves, Blobs, Soft, Lines, Tiles and Fields and shown as a grid of small pictures (Ripple, Tides, Drift, Bubbles, Glow, Grain, Stripes, Halftone, Tiles, Contours, Cells, Flow, Marble, Maze and more). Each has the settings of its own (counts, sizes, angles, colours, solid or outline), and a background you can hide. Pick a sheet or a closed shape first (the result goes on the sheet; a shape becomes the clipping mask that holds it, its fill and outline kept for *Release*) or let it make a new sheet; *Generate* makes the result, every change after that replaces it live, and the whole session is one undo step until *Done*. *Randomize* picks random settings and a new seed (a snowflake on a setting keeps it); *New seed* keeps the settings and says when the seed changes nothing; the seed can be typed (or dragged) to make a result again. The seed works in every generator: the regular ones (Stripes, Tiles, Halftone and the like) have a *Looseness* setting, and at 0 they stay exact. The result is a group of ordinary editable shapes that remembers its settings: pick it later and the panel shows them, and changes replace it where it is. Resizing the sheet it is on makes it again to fill the new size (it stretches while you drag).
- **SVG:** paste SVG text to get editable paths (gradients, including a radial one sized by its own transform and an angular one written as a CSS conic gradient box, dashes, transforms, `<use>`, symbols and clip paths, which become clipping masks), or make a vector copy of an SVG picture. Export shapes as SVG, copy them as SVG text, or save them to the library as an SVG picture.

![Boolean shapes: the rocket is a Union, and the Shapes menu is open](docs/screenshots/shapes.webp)

![The Pattern panel: the Contours generator on a sheet, with its colours, settings and seed](docs/screenshots/pattern.webp)

### Colour and styles

- **Colour picker:** one picker for every colour. Choose OKHSL, OKHSV or OKLCH (CSS `oklch()`'s own lightness, chroma and hue); a ring and box, a plane with a hue bar, or sliders; text as hex or another format. It also has an eyedropper, recent colours and saved colours. A number changes by dragging its name left or right; with `Shift` it snaps to round steps worked out from its range (steps of 5 for 0–100, 10 for 0–255).
- **Gradients:** linear, radial and angular, with stops you drag on the canvas, a *Randomize* button and a gradient map for pictures.
- **Palettes:** *Palette from a colour* builds harmonies, and a palette can be taken from a picture. Palettes and gradients can be imported and exported as `.gpl`, `.ase`, `.aco` and `.ggr` files.
- **Styles panel:** saved colours, gradients, text styles, adjustment stacks and patterns (a generator with its settings and seed, saved from the Pattern panel with the *Save as a style* button and updated from it; pressing its card puts it back in the Pattern panel and makes it on what is picked, on each of several picked shapes). An object painted with a saved style is **linked** to it and follows when the style changes. A change by hand, or *Detach*, unlinks it. A colour, gradient or palette card is copied by a long press or a right click on it (a palette as CSS variables; a colour inside an opened palette as hex), or by *Copy hex* / *Copy as CSS* in its More menu (a long press does not apply it); CSS pasted (a colour in any notation, or a gradient) is saved as a new style when the pointer is over the panel or nothing is picked.

![The colour picker, opened from a fill: OKHSV as a ring and box, with the recent colours](docs/screenshots/colour-picker.webp)

### Text

- **Text** (`T`): click and type. A click makes a text as wide as its words; a drag makes a box of that width. Double-click to edit.
- **Formatting:** bold, italic, underline, strikethrough, links, colour and size of any range, headings, bulleted, numbered and nested lists. Text is stored as Markdown; **Copy Markdown** is one click away.
- **Look:** colour or gradient, outline, size, line height, letter spacing, alignment, auto or fixed width, paragraph spacing, indent, case, line limit, a set height, kerning, OpenType features and the axes of variable fonts.
- **Fonts:** import `.ttf`, `.otf`, `.woff` or `.woff2` into the library, including variable fonts. One text may use several fonts. Right-to-left and mixed-direction text are supported.
- **Text on a path**, and **Text to path** (`Ctrl+E`) to turn letters into editable outlines.
- **Notes** (`M`): a text on a coloured card.
- **No zoom limit:** zoom into a letter as far as you like; the font's real outlines are drawn.

![A text being edited, with its formatting bar and its look in the bar above](docs/screenshots/text.webp)

### Pictures, video, audio and other files

- **Pictures** are placed one source pixel to one screen pixel. Zooming in shows real pixels; nothing is invented and the original is never altered.
- **Adjustments** are non-destructive stacks you can reorder, hide and copy between pictures, video, GIFs, shapes, pen strokes and texts: exposure, contrast, highlights, shadows, temperature, tint, saturation, vibrance, red/green/blue, levels, curves, gradient map, blur, sharpen and grain.
- **Crop**, rounded corners and an outline work on pictures, video and GIFs. A picture can be masked by a shape, by opacity or by brightness, or by a brush mask painted with the Pen.
- **Drop shadow and inner shadow** are in the Adjust panel, for pictures, shapes, strokes and texts: opacity, across, down, blur, spread and a colour each. Turning a shadow on starts it soft and a little below. Each group of adjustments has a *Reset* button that takes that group off. The offset and blur are shares of the object's own size (an offset of 100 is a tenth of it), so they look the same at any zoom. A picture's own pixels are not touched; its shadow is drawn beside it. A video that is playing shows no shadow while it plays (its paused frame does).
- **Adjustments on shapes, strokes and text** are applied to how the object looks once drawn (fill, outline, gradient and texture together); a blur is a share of the object's own size, so it does not change with zoom (far inside an object it keeps a width of at most about 330 px). Exporting a selection leaves room for a blur or a drop shadow. An exported SVG carries them as a filter on the shape, with room round the drawing for a blur, and making the SVG into shapes again brings the adjustments back (a vector PDF is drawn as a picture instead); see Limitations.
- **Make a new picture** bakes the crop and adjustments into a new library item; **Copy as picture** puts the result on the clipboard. **Copy** and **Paste adjustments** move a whole stack between items. **Make vector copy** turns an SVG picture into editable shapes in its place, at its size, turn and layer (one undo step; the file stays in the library). **Show in library** opens the Library with the original picked.
- **Media player:** videos, audio and animated GIFs play on the canvas with a player right under the item. It has play and pause, a seek bar, step back and forward (seconds for video and audio, frames for GIFs), repeat, playback speed, volume, a waveform for audio, and a start and end to play only part of a file. The paused frame is saved. Playback continues when the item scrolls out of view.
- **Extract frame** turns the current frame of a video or GIF into a picture in the library (PNG, WebP or JPEG). Settings name it, file it in a folder and tag it, optionally placing it on the canvas.
- **File details:** EXIF, colour profile and codec information are shown. STL and OBJ 3D models and PDFs are kept as cards with a preview; any other file is kept as a card with its extension and can be downloaded again.
- **Import** by button (in the Library the Import button has a menu for files or for a whole folder), drag and drop, paste, or a whole folder. Files up to 256 MiB are accepted and decoded before being stored.

### Organizing

- **Layers panel:** group and nest, rename, hide, lock, re-stack, set opacity and blend mode, rotate. Select with `Ctrl` (toggle) and `Shift` (range).
- **Sheets and masks:** a *sheet* clips what it holds and has a ratio rather than a size; a *clipping mask* is a sheet of any shape. See [Shapes, sheets and masks](docs/reference/shapes-sheets-masks.md).
- **Snapping and arranging:** moving, resizing and turning things, dragging a node and dragging the handles of a gradient snap to others with guide lines (the magnet toggle turns it off). They line up with the sides and middles of boxes, and with the shapes themselves: a corner goes exactly onto another corner or the middle of a side (a ring marks it), a corner onto any side, including curves, and a straight side lies flush along a nearly parallel one (the side is drawn); turning brings a corner round to another or a side parallel to a nearby one. A group, and a boolean group, counts as one thing for Align, distribute and Arrange; its shapes are lined up with each other only when you pick them one by one (in Layers, or inside the group). Align, distribute, arrange in a grid (by name, date, size or type), copy, cut, paste, duplicate; `Alt`+drag copies.
- **Tags** on the selection, with a Tags panel listing every tag and its count. Renaming or deleting a tag applies to every canvas.
- **Reveal:** hold `Ctrl` and move over the canvas to see the outline of everything under the pointer; `Ctrl`+click picks exactly that thing, even deep inside a group, mask or sheet. Click on a revealed outline and you get the thing the outline belongs to, even when a filled shape covers it; click anywhere else and you get the top thing there (`Ctrl`+`Alt`+click goes down the stack). The names beside the pointer are a list: move onto a row (it stays put and its outline turns strong) and `Ctrl`+click picks that very thing, `Ctrl`+`Shift`+click adds it or takes it away; picked ones are ticked. A thing you have picked is moved by dragging from anywhere inside it, even when other things cover it; a click that does not move still picks what is on top (with `Ctrl`, what `Ctrl`+click picks). A sheet is ground, so dragging on a sheet you picked still draws a selection box (hold `Ctrl` to move it).
- **Sheets:** drawing a sheet (`C`) over objects puts the ones wholly inside it on the sheet (one undo step; ones it only crosses stay out); *Put the selection on a sheet*, *Fit to contents*, *Release*, ratio presets (`16:9`, `A4 portrait`, a number, or a size in px: `2000 x 1920` or `2000x1920px` becomes `25 : 24`) and *Turn on its side*. Each object on a sheet has pins (left, right, both, centre or scale, per axis) that decide what it does when the sheet is resized, and *Scale contents* resizes everything with it.
- **Masks:** a clipping mask of any shape, a mask by opacity or brightness, or a brush mask painted in black and white with the Pen. Masks can be inverted, picked on their own and released. A click on a mask picks it as one unit; a double click goes inside.
- **Hide and lock:** *Show all hidden* and *Unlock all* bring everything back.
- **Kind chips:** with a mixed selection, chips at the start of the Actions bar (All, Pictures, Media, Shapes, Strokes, Texts) narrow it to one kind.

![Layers panel, with Jupiter picked exactly by Ctrl+click and its fill in the Properties bar](docs/screenshots/layers.webp)

### The interface

- **Tool rail** on the left: Undo and Redo, the tools (with Import after Note), then Screenshot and Search. **Properties bar** at the top: the options of the tool or of what is picked. A picked pen stroke, or several picked things, show their colours there as chips; a chip changes that colour everywhere it is used. Pasting CSS text with shapes picked makes it their fill: a gradient (`linear-gradient(...)`, `radial-gradient(...)`, `conic-gradient(...)`) or a colour (hex, `rgb()`, `hsl()`, `oklch()` and the other CSS notations, or a colour name such as `rebeccapurple`). In the colour picker a long press (or right click) on a swatch or a saved gradient copies it (hex, or CSS for a gradient) without choosing it; copying the hex field includes the `#` and pasting one drops it. Copy and paste use the same CSS text: the Styles panel copies a colour as hex and a gradient as CSS. **Actions bar**: what can be done with the selection, grouped in menus (Align, Arrange, Shapes, Masks, Path tools, Sheets, Export, Initial state) that list only what applies. It sits at the bottom or follows the selection. A bar wider than the window shows a fade and an arrow at the end with more; the mouse wheel (with or without Shift) scrolls it sideways.
- **Panels** (Layers, Bookmarks, Tags, Styles, Adjust, Pattern) float or dock to either side, are resizable, and can minimize when inactive. *Reset the panel layout* puts them back.
- **Command palette** (`Ctrl/⌘+K`) runs any command by name, takes a value where one is needed (`@kind` narrows the list), and records and replays **macros**. **Context menus:** a right click (or the menu key, or a long press on a touch screen) opens a menu of what fits where you are, in groups. On the canvas: the commands that apply to what is under the pointer (on a picture, *Rename* renames its file in the library with the library's own dialog, and a layer that has a name of its own takes the new name), or to the empty canvas (a long touch lists what is under the finger first, then the same commands). In the library: on an item its details-panel actions plus *Copy*, *Copy file name* and *Paste*; on empty ground *Select everything*, *Paste*, the imports, *New folder*, *Slideshow* and the details panel. In Settings: on a setting its reset, on a shortcut its key actions. The viewer has none.
- **Zen mode** (`Z`, or the leaf button) fades the bars and panels until the pointer is over them.
- **Screenshot** (camera button) saves the selection, or the whole view, to the library. Settings choose the format, quality, name, folder and tags. They also choose whether to include the canvas pattern and the interface, a transparent background, and a copy on the clipboard.
- **Previous view** and **Next view** walk your camera history; the **dice** goes to a random empty place.
- **Camera travel** (Settings → Navigation) is how the view reaches a bookmark or a previous view: *Fly* moves the camera along one continuous path. When one place is within a view of the other (nested views, a bookmark you can see), it is one zoom in or out, at any depth, with no zoom out first. Farther apart, up to 20,000 levels of zoom away (another depth or frame), it zooms out until the two places are about a view apart, crosses over and zooms in, so the way is seen; *Glide near only* cuts to far ones; *Cut* always arrives at once. The time can grow with the distance (up to *Longest trip*) or stay fixed, the easing is smooth, linear or ease-out, and a key or a drag during the glide ends it. On a trip more than a view apart and over 20,000 levels away (it zooms out 24 levels and in) the canvas dips dark for a moment at the switch (*Fade at the switch*, on by default); the tour has its own travel speed. Animation set to None always cuts; with the system's reduced-motion request the view cuts too and says so once, unless *Follow the system's reduced motion* is turned off. *Travel time (base)* sets the length of a short trip.
- **Read-outs:** the bottom left shows the zoom, position and save state. *Information shown* switches between simple and technical (exact zoom as a power of two, frame rate, diagnostics). The bottom-right buttons cycle the canvas pattern (grid and others) and the item names (always, when picked, hidden).
- **Hint line** at the bottom says what the tool does and what each key does over a handle. **Notices** report results, often with a *View* button that opens what was made, and fade after a time that follows their words (a short one goes in a couple of seconds, a long one or an error stays to be read); they stack above the Actions bar, never over it. Anything that makes you wait (exporting, importing, opening a library, moving files, deleting everything) shows a notice with a bar and the stage it is at, which stays until the work ends and then says the result.

| | |
| --- | --- |
| ![Command palette](docs/screenshots/command-palette.webp) | ![The context menu of a picked picture, with Rename](docs/screenshots/context-menu.webp) |
| The command palette | The context menu of a picked picture: its commands in groups, with *Rename* for the file in the Library |

### The Library

Switch between **Canvas** and **Library** at the top left. The canvas keeps its view, selection and undo history while you are away.

- A gallery of every imported file with its size, type and usage ("4 uses · 3 canvases"), with search, filters by file type, sorting, list or grid layouts and adjustable thumbnails.
- A **viewer** with filmstrip, zoom, pan, slideshow and a details panel. The details show where an item is used, and **Show** takes you to it on the canvas at any depth. A button switches the background behind the picture, the controls can be hidden, and a double tap opens it on phones.
- **Folders** (an item lives in one folder, folders nest), **tags** (several per item, renamable), **favourites**, file types, **Similar images** (duplicates and near-duplicates found by their pixels) and **Hidden** items, which are kept out of every list until you open them (see [Hidden items and passwords](#hidden-items-and-passwords)).
- **Picking and the details panel:** a click picks an item; the details panel is opened and closed with its button (or `I`) and, while open, shows what is picked (several: their tags and folder together), so a click never moves the grid under the pointer. When the grid is laid out again (the panel toggled, the window or the thumbnails resized), the picked item stays where it is on the screen. `Ctrl+A` picks all shown; a plain click then picks one alone (`Ctrl`+click adds or removes; on a touch screen, a tap adds or removes). Picked items a search or filter hides are counted in the panel, with a button to keep only the shown. The *Details* fold (the file's own metadata) stays open or closed as you left it when you pick another item.
- **Drag items onto the sidebar:** onto a folder to move them into it, onto *Unfiled* to take them out of their folders, onto a tag to tag them, onto *Favourites* to mark them; a picked item carries the whole pick.
- **Undo in the library:** `Ctrl+Z` undoes the last change to tags, favourites, folders or names (`Ctrl+Shift+Z` or `Ctrl+Y` redoes), up to 50 steps; deleting from the library has its own safety (originals are kept while undo on a canvas can need them).
- **Tags and folders of several items at once:** with several picked, the details panel lists every tag any of them has, with how many have it (*2/4*); **×** takes a tag off all of them and **+** puts it on the rest. The tag field suggests the library's tags and takes several at once, separated by commas. Each folder shows how many of them it holds (a mixed pick has none ticked), and *New folder for these…* makes one and moves them into it. Changes to hundreds of items are one write, so they take a moment, not minutes.
- **Note and fields:** the details panel of one item has a **Note** box (plain text, not Markdown) and, under it, **Add a field**, which adds a row with a name you choose and its value (`link` and an address, `author`, `source`, `licence`…; names already used in the library are suggested). Each is stored when you leave it or press `Enter` in a field, **×** removes a field, and `Ctrl+Z` in the library undoes the change. The library search (All) finds words in the note and in the fields' names and values. Notes and fields travel in backups and in the library index; importing keeps an item's own note (the backup's fills an empty one) and adds the fields it does not have yet.
- **Rename** one item or many at once, with a preview: number them, replace text, add text or change the extension. Renaming one item edits only the name before the extension (it stays, so it cannot change by accident); *Change the extension too* opens the whole name.
- **Copy and paste** with the system clipboard: *Copy* (the menu, or `Ctrl`+`C` over the library) puts the picture, as a PNG, alone on the clipboard (a name beside it would be pasted instead of the picture by many programs); *Copy file name* puts the name as text; a file that is not a picture is copied as its name. *Paste* brings a picture from the clipboard in, named by the text beside it when there is one and it is a file name, else `image`.
- **Export** items as a `.canvast` archive, download originals, or export all files as a plain ZIP sorted by file type or by folder.
- **Safe deletion:** an item in use cannot be deleted from the library on its own; *Delete everywhere…* (after a confirmation that says how often and where it is used) removes its instances from every canvas first, a text using it as its font keeping its words in the default font. On the open canvas Undo brings them back; on the others they cannot be brought back. An original is erased only when nothing, including undo, can bring it back.
- **Missing originals** (for example after clearing site data, or a file taken out of the library folder) are flagged with their usage; importing the same file again restores every instance.
- **Library folder** (Chromium): in **Settings > Storage**, *Choose library folder…* keeps your files as plain files in a folder of your disk, named by their content and keeping their extension (`a07c9f….png`, so other programs can open them), instead of in the browser's storage, so the library is limited by your disk and not by the browser. *Move into folder* and *Move back to browser* move what is already there. The library index is kept up to date by itself a little after each change (a checkbox turns it off; **Save index** writes it at once). It is the hidden file `.canvast-index` beside the files: the whole workspace (boards, canvases, objects, names, tags, folders, notes and fields, styles, settings) without the files themselves. It is not a backup, and not a cache to delete: on another device it is your canvases (a backup, `.canvast`, is a different file and holds the files). On another device, choose the same folder: when it holds a library index you are offered to open it at once (**Open index** does the same later); the canvases are added and every file is matched by its name. Do this on a device that has no canvases of its own yet, or they are added a second time. After a restart the browser asks permission once more: press *Reconnect folder*. Do not move, rename or edit the files in that folder (canvast finds each one by its name); files kept before extensions were added get one with the *Add extensions* button on the card; backups (`.canvast`) hold their bytes as always.

| | |
| --- | --- |
| ![The Library](docs/screenshots/library.webp) | ![The viewer](docs/screenshots/viewer.webp) |
| The Library, filled by six screenshots of the showcase (shown by file type: the showcase also carries its two font files) | The viewer with its filmstrip and details |

### Hidden items and passwords

For a workspace that is shown in a public place, an item of the Library can be **hidden**, and the workspace or the Hidden list can be guarded by a **password**. Both are gates in front of the data, not encryption (see the end of this section).

| | |
| --- | --- |
| ![The details of a picked item, with the Hide button beside the star](docs/screenshots/library-hide.webp) | ![The Hidden list: the item that was hidden, in its own list](docs/screenshots/hidden-list.webp) |
| **Hide** is the eye button beside the star in the details panel (also in the bulk bar of several picked items, and in the library's context menu) | The **Hidden** list, open: the hidden item is only here, and the sidebar counts do not include it |

**Hiding.** A hidden item is left out of *All items*, every folder, tag and file type, the counts, searches, *Similar images*, and the pickers that list the Library (the picture of a texture fill, the fonts). Pictures already placed on a canvas still show there, with their names in the Layers panel. Hiding does not move, delete or change the file. In the Hidden list the same button shows the item again.

**Opening the Hidden list.** It is not in the sidebar. Type its **opening word** in the library's search box (`hidden:` by default; change it, or empty it to turn this off, in Settings > Privacy): the word clears itself, the password is asked if there is one, and the list opens as one more list in the sidebar. It closes when you choose another list or leave the Library. With *Keep the Hidden items open until the tab closes* on (Settings > Privacy), it stays open, without asking again, until the tab is closed or reloaded.

| | |
| --- | --- |
| ![Settings, Privacy: the opening word, keeping the list open, and the two passwords](docs/screenshots/privacy.webp) | ![The screen shown when the app opens on a workspace with a password](docs/screenshots/lock-screen.webp) |
| **Settings > Privacy**: the opening word, the keep-open option and the two passwords | The **lock screen**: with a workspace password set, nothing is read or drawn until it is given |

**Two passwords, set separately** in Settings > Privacy (each is typed twice; changing or removing one asks for the old one):

| Password | Asked | Guards |
| --- | --- | --- |
| **Workspace** | Every time the app opens or is reloaded, before anything of the workspace is read. Escape does not close the screen | The whole workspace |
| **Hidden items** | When the opening word is typed (unless the tab remembers it), and before an export that includes hidden items | The Hidden list and exporting its items |

**Exports and backups ask.**

![The question asked before an export that would carry a hidden item](docs/screenshots/export-hidden.webp)

| Export | What is asked | If you leave it out |
| --- | --- | --- |
| Any export with hidden items in it (backup, board, canvas, files as ZIP) | *Include them, with their files and names, or leave them out?* Including asks the Hidden password first | The file has no trace of them; pictures on a canvas that use them show as missing when it is imported |
| A workspace backup, when a password or a changed privacy setting exists | *Include the passwords and the privacy settings (the opening word, keeping the list open)?* Each password is asked first, unless it was typed a moment ago | A copy restored from it starts with no password and the default settings |
| The library index kept in the library folder | Nothing: it is written by itself, so it always leaves hidden items and passwords out | |

Whether an item is hidden is data of the item, so it travels in any export that includes it and the item comes back hidden. Importing a backup that carries a password sets it only on a device that has none, and the import dialog says so.

**What this is not.** The passwords are asked by the app; the files are stored as they are. They keep people at your screen out. They do not stop someone who can open this browser's storage, or who has an exported file that includes hidden items. Only a salted hash of each password is kept, in this browser and in no archive unless you include it. A forgotten password cannot be recovered: the only way back into a locked workspace is to clear this site's data in the browser, which deletes it, so keep a backup (a backup made without the password opens without one). In the browser, hidden files are not encrypted.

**In the desktop app, hidden items are encrypted.** There, hiding asks for a Hidden password first (and says that a lost password means lost files). A hidden item's file is encrypted (AES-GCM) into `.hidden/` in the workspace folder under a random name, read back to prove it, and the readable file is deleted, not moved to `.trash/`. Its name, tags, note and fields are kept only in an encrypted index (`.canvast/hidden.json`), and its thumbnail is never stored. The password, stretched with PBKDF2, wraps one random key, so changing the password re-wraps that key without re-encrypting any file. The password cannot be removed while any item is hidden. Once given (to open the Hidden list, or when hiding), the key stays in memory until the app closes or **Lock hidden items** (command palette). While locked, a hidden picture placed on a canvas shows a padlock, and another device on the same folder learns of hidden items only when the password is given there. Showing an item again decrypts it back to its place in `library/`.

### Exporting

**Copy to other apps.** `Ctrl/⌘+C` keeps the real objects for pasting back here and also puts on the system clipboard a PNG picture: of shapes as drawn (their SVG text is the separate command *Copy the selection as SVG*, in the right-click menu); of a picture as one PNG at full size, as it looks with its crop and adjustments; a GIF or video as the frame it shows; a shape with a picture or objects fill, or anything mixed, as a PNG of it as drawn (at most 1024 px on the long side). The picture goes alone, with no text beside it (an app that is offered both often takes the text), except for copied texts, which carry their words too. Every copy out of canvast (canvas, library, screenshot, Export) goes through one module. **Pasting back in canvast** brings the objects back as they were (links, masks, crop, adjustments, exact positions) as long as nothing else was copied in between. Shapes and texts are known by their text on the clipboard, so they come back even from another tab; a picture or GIF is known only while this window keeps the focus, and after switching to another window it comes back as a new picture (see Limitations). Anything copied in another app is imported as before: an SVG as shapes, an image as a picture. Pasting in another app takes what it accepts. Browsers cannot put files (audio, PDF) on the clipboard, so those stay in canvast. `Ctrl/⌘+X` puts the text only (the shape is gone before a picture could be drawn).

**What you export is what you see.** Colours, widths and shapes are the ones stored in the document: nothing is changed by the theme when drawing or exporting. A new shape starts with a fill and no outline (a line and an open path get one, or they would not show). The default ink, for the pen, those lines and a first outline, is near-black on a light canvas and a light ink on a dark one, chosen when the object is made and stored with it (*Change the old default ink to the canvas ink* in the command palette gives it to older drawings). Exports match the canvas in every format; the one thing SVG cannot say is an angular gradient: an SVG holds a picture of it (a PNG of up to 384 px a side, cut to the shape or the line) and, on the element, the real gradient: canvast reads it back, so *Make vector copy* or pasting the SVG gives the editable angular gradient again (other programs show the picture). The Export dialog and the SVG saves warn when a shape has one.

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
| Tools | `V` select · `P` pen · `L` lasso · `H` hand · `T` text · `M` note · `U` shape · `B` path · `N` nodes · `C` sheet · `E` eraser |
| Undo · redo | `Ctrl/⌘+Z` · `Ctrl/⌘+Shift+Z` or `Ctrl+Y` |
| Copy · cut · paste · duplicate | `Ctrl/⌘+C` · `X` · `V` · `D` |
| Select all · clear · cancel a gesture | `Ctrl/⌘+A` · `Esc` |
| Delete | `Delete` · `Backspace` |
| Group · ungroup | `Ctrl/⌘+G` · `Ctrl/⌘+Shift+G` |
| Put the selection on a sheet · flatten | `Ctrl+Alt+G` · `Ctrl/⌘+E` (text to paths, a boolean group to one path) |
| Bring to front · send to back | `Ctrl/⌘+]` · `Ctrl/⌘+[` |
| Bookmarks | `[` previous · `]` next · `Alt+1` … `Alt+9` go to bookmark 1 to 9 |
| Previous view · next view | `Alt+Shift+←` · `Alt+Shift+→` |
| Command palette | `Ctrl/⌘+K` (`@kind` narrows it; commands can take a value; macros record and replay) |
| Context menu | Right-click the canvas |
| Search | `Ctrl+F` (library: `Ctrl+Shift+F`); on the canvas `#` searches tags, `@` bookmarks, `/` is the command palette and `?` the shortcut list |
| Focus on selection · fit everything | `F` · `F` again |
| Step to next item | `W` `A` `S` `D` |
| Zen mode | `Z` (bars fade out until the pointer is over them) |
| Text editing | `Ctrl/⌘+B` · `Ctrl/⌘+I` · `Tab` nests a list item · `Esc` or `Ctrl/⌘+Enter` finishes |
| Resize | Drag a handle; `Shift` keeps proportions, `Alt` resizes about the middle, `Ctrl` turns snapping off |
| Copy by dragging | `Alt` as the drag starts |
| Layer selection | `Ctrl`+click toggles · `Shift`+click selects a range |
| Jump to a zoom level | Click the zoom read-out, type `3000`, `2^-500` or `10^900`, Enter |

**Touch:** two-finger drag pans and pinches zooms; a two-finger tap is undo and a three-finger tap is redo; a long press on Select lists what is under the finger; a resting finger while another drags acts as `Shift`, two as `Alt`. Number fields change by dragging their name.

---

## Your data: saving, backups, export

### Saving

Every change is saved automatically within a fraction of a second, together with the camera, in your browser's IndexedDB. Only the objects that changed are written, in one atomic transaction, and then read back to check. The indicator shows *Unsaved changes… → Saving… → Saved → Saved (verified)*; click it to open **Settings > Storage**: space used, whether the browser keeps the data, the library folder, how saving is going (and the role of this tab) and backups. Reloading restores the canvas and the view.

If storage cannot be opened, canvast keeps working in memory and says so.

### Several tabs

The first tab to open a workspace edits it. Other tabs are read-only, follow its changes live, and offer **Take over**. A stale tab can never overwrite newer data; its save is rejected and reported.

### Backups

- **Export a backup** (Settings > Storage) downloads one `.canvast` file holding every board, canvas, object and view, plus every original once, and your device settings (theme, shortcuts, panel layout). When you import it, only the settings this device has not set itself are restored; the ones you changed here are kept, and the import dialog says how many it will restore.
- A board, a canvas or a single library item can be exported on its own, with only the originals it uses.
- **Import archive…** (or drop a `.canvast` file on the page) verifies every checksum first, shows what it contains and any problems, and only then adds the boards and canvases in a single transaction. Nothing existing is replaced and originals you already have are not stored twice. Paintings and brush presets in a backup from an older version are left out, and the summary says so.
- A `.canvast` file is a standard, uncompressed ZIP you can open with any unzip tool. Do not re-compress it.
- Backups made in one browser import into another (tested between Chromium and Firefox).
- Incremental backups are available after the first full one.
- A backup asks what to do with hidden items and with the passwords and privacy settings (see [Hidden items and passwords](#hidden-items-and-passwords)); by default they stay out of it.

The browser does not say whether a download finished, so keep your backups somewhere safe.

### What can delete data

Deleting objects; deleting a canvas or board (confirmed, cannot be undone; pictures placed there stay in the library); *Delete from library*, which erases an unused original once undo can no longer need it; and **Delete all data** (Settings > Storage, *Start from scratch*), which asks first, offers a backup, an export of the files and the library index, makes you type `DELETE`, and then removes everything canvast keeps in this browser. It never deletes files from your disk: the files in a library folder stay where they are. Nothing else removes anything. Damaged objects found on load are skipped and reported, never silently changed.

### Where the data lives

IndexedDB database `canvast`, in the browser's storage for local files. Moving the HTML file to another folder keeps your data. Opening it in a different browser, profile or private window does not, and clearing site data deletes it. This is why regular backups matter. The browser's storage has a size limit, so canvast suits projects rather than very large collections of files; see [Limitations](#limitations). The desktop app keeps the workspace in a folder instead (below).

### The desktop app (Linux)

The same app, packaged for the desktop (`canvast-X.Y.Z-x86_64.AppImage` on the [latest release](https://github.com/emarpiee/canvast/releases/latest): make it executable and run it). Your workspace is a **folder of ordinary files** that you choose (File > Open workspace folder…), so any sync tool, backup tool or file manager can see it. It works offline and loads nothing from the network.

| In the folder | What it is |
| --- | --- |
| `<board>/` | A board, named after it (lowercase, `_` between words, `-` between parts; `-2` on a clash) |
| `<board>/<canvas>.cvst` | A canvas: one JSON file with its objects, frames and bookmarks |
| `library/<folder path>/`, `library/images/`… | The library's files, named after their names in the library: in the folders of their library folders, or by kind when in none |
| `.canvast/workspace.json`, `library.json` | Names, order, styles and passwords' kept forms; the library's names, tags, folders, notes and fields |
| `.canvast/devices/` | One file per device: its open canvas and cameras |
| `.hidden/`, `.canvast/hidden.json` | Hidden items, encrypted (see [Hidden items and passwords](#hidden-items-and-passwords)) |
| `.trash/` | What canvast deleted, when Settings > Storage says so (the default) |

**How it saves.** New library files are written as readable files under `library/<kind>/` (`Hand Study (Loomis).png` → `library/images/hand_study-loomis.png`, `-2` on a clash, the same file stored once); each board is a folder and each canvas a `<board>/<canvas>.cvst` file (same safe names), with `.canvast/workspace.json` (names, order, styles) and a file per device, written about 2 seconds after editing pauses and when the window closes. Every edit is first saved in the app's own storage (one per workspace folder and device), which the folder follows. At start-up the folder wins: a device with no copy yet opens the whole workspace from it, a canvas another device changed (through any sync tool) is read in, and when both changed the same canvas the folder's version is kept and this device's is added beside it as `<name> (conflict <date>)`. Library folders are real folders: an item filed in a library folder is under `library/<folder path>/` (each part a safe name; a library folder named like a kind folder shares it), filing or renaming an item moves its file, the library's undo moves it back, and a renamed or deleted library folder's emptied folder is removed. `.canvast/library.json` holds the library (names, tags, folders, notes, fields, which file is which item, one item per line), and a device with no copy yet takes the library from it. Hidden items are encrypted into `.hidden/` (see [Hidden items and passwords](#hidden-items-and-passwords)). A file canvast deletes from the folder (an original once undo no longer needs it, a deleted canvas or board) goes where Settings > Storage says: into `.trash/` in the workspace folder (the default, so it syncs and can be put back by hand), into the system trash, or away for good. canvast follows the folder while it runs (and catches up at start-up). A canvas file another device wrote (through any sync tool) is read in, and the open canvas is loaded again with its camera kept. If this device has edits of that canvas not yet in its file, both versions are kept, as at start-up, and a file is never written over another device's newer version. A canvas file or board folder renamed in a file manager renames the canvas or board, and a canvas file moved into another board's folder moves the canvas; their files then take their safe names. In `library/`, canvast notices what changed in a file manager: a file renamed or moved is found again by its content (the item takes its new folder and, when renamed, its new name), a new file is imported where it lies, into the library folder of the folder it is in (made when there is none), and a deleted file shows as missing. Files being written (temporary or partial downloads) are left alone. To bring a browser workspace in, export a full backup there and import it here: its boards, canvases and originals are written into the folder as folders and files


---

## Settings and accessibility

Open Settings with the gear button. Settings have a *device* scope and a *canvas* scope, can be searched, and reset individually (the undo-arrow icon at the end of a row) or together. Every group has an icon in the list on the left, and the groups are indented under their heading. Device settings travel in a workspace backup and in the library index (see Backups).

| Group | What it holds |
| --- | --- |
| Drawing and selection | Pen, colour picker model and layout, pen width and stabilizer, lasso filter, snapping, align to the selection box, grid spacing for Arrange, initial shape and paint, the distance Fill gaps closes openings by, eraser |
| Navigation | How `W` `A` `S` `D` choose the next item (nearest in view or anywhere, by layer or by name A to Z, in view or anywhere); focus on the item or keep the zoom; camera travel (style, time, longest trip, easing) and the wait at each tour stop |
| Shortcuts | Rebind any shortcut to a key or a chord; the full list is also on `?` |
| Media and playback | Viewer edges, slideshow time, starting volume, step sizes, extracted frames and edited pictures (format, quality, folder, name, tags), and the folder and tags of what is saved to the library from the canvas, one pair for each kind: pictures from Export… (*Exports*, `export`), patterns (*Patterns*, `pattern`) and shapes saved as SVG (*Shapes*, `shape`); screenshots have theirs in the Screenshot group |
| Screenshot | Format, quality, pattern, transparency, interface, clipboard, folder, name and tags |
| Appearance | Theme (system, light, dark), theme colour (or adaptive, from the canvas background), colourfulness, information shown, hints and tooltips, canvas pattern, Actions bar place, item names, density (comfortable, compact, dense), round or sharp corners, Zen mode |
| Panels | Minimize inactive panels, panels kept open |
| Performance | Adaptive quality, fixed quality level, memory for pictures, animation and its speed |
| Storage | Space used and whether the browser keeps the data; the library folder (choose it, move files in and out, the library index and its automatic saving); how saving is going; backups (export, changes only, files as ZIP, import); *Start from scratch* (delete all data, after a warning with a backup offered first) |
| Privacy | The word that opens the Hidden items, keeping them open until the tab closes, and the passwords of the workspace and of the Hidden items; what stays on your machine |
| About and diagnostics | Version and diagnostics |
| Develop | Developer tools (see below) |

- **Accessibility:** controls are keyboard reachable with visible focus; panels have title bars that work by keyboard; status changes are announced to screen readers; the system's reduced-motion preference is honoured and animation can be turned off; colour contrast is audited automatically.
- **Layouts** adapt to large, medium and phone-sized screens, with scroll cues on bars that scroll.

![Settings, Appearance](docs/screenshots/settings.webp)

---

## Limitations

canvast describes only what it does. These are the current limits.

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
| Varied fills | The copies of a varied texture repeat after a block of 16 to 31 cells |
| Pattern | A rotated sheet or shape is refused. A result is at most 600 shapes. Ungrouping a pattern, or moving one of its shapes out of its group, ends its link with the panel (the shapes stay as ordinary ones). Resizing the sheet makes the pattern again at the new size from its settings and seed, so a generator whose layout depends on the size (how many waves fit, say) can place its shapes differently |
| SVG import | Text, patterns and masks inside an SVG are not imported; a dropped SVG file is placed as a picture (make a vector copy to edit it) |
| Adjustments and shadows | Shadows are not shown on a video or GIF while it plays. Adjustments (and shadows) are written to an exported SVG only for shapes (not pen strokes or text), as an SVG filter that matches the canvas closely but not exactly (curves, levels and the gradient map are sampled; grain differs). A shape bigger than about 8 million pixels on screen is drawn unadjusted. Grain on a shape is fixed to the screen pixels, not to the shape |
| Boolean groups | Per-corner radii on a boolean result are not available |
| Fill gaps | Only places closed in on every side, or by slits narrower than the closing distance (on the screen, at the zoom you are at), are gaps; a wider opening leaves the place unfilled |
| Eraser | Trimming works on strokes, not on vector paths |
| Files | Imports are limited to 256 MiB per file |
| Clipboard | Ctrl+C keeps the real objects for pasting back only while nothing else was copied: a picture copied for other apps pastes back as the objects only if the window kept the focus and the app copied nothing else in between (otherwise it comes back as a new picture, and shapes as an SVG import or a picture). A copy of a single picture, GIF or video is one PNG (a GIF or video is its current frame); files such as audio and PDF cannot be put on the system clipboard by a web page; Cut puts text only |
| Video | H.265 video from phones shows as a card on Firefox for Android (it still plays from the player) |

**Scale and precision**

| Area | Limitation |
| --- | --- |
| Far trips | A trip to a bookmark that is more than a view apart and more than 20,000 levels of zoom away is not flown: it zooms out 24 levels from here and in to there, switching where both are tiny (with a brief dip to dark, unless turned off). A trip to a place within a view, however deep, is flown |
| Camera precision | After zooming out more than 4,096 levels beyond the deepest point and back in, the view returns to within 2^-96 px of the original rather than exactly |
| Very deep views | Magnification has no limit, but each level of depth enlarges the numbers involved, so extreme depths cost more CPU per frame |
| Dense scenes | With hundreds to thousands of objects visible at once, zooming shows a briefly scaled image of the last exact frame and snaps to the exact picture about 150 ms after you stop. Zooming out before the next level out has been prepared (it is made while the view rests, in a fraction of a second), the edge the scaled image does not reach is drawn exactly, so those frames are slower but the view is never cut off. A zoom that goes more than one level in one gesture pauses for one exact frame at each level it has nothing prepared for |
| Far zoom-out | Content too small to draw is shown as a soft mark in its own colour (pictures as grey). Marks cannot be selected; zoom in to edit |
| Very large documents | A board of one million objects needs about 940 MB of memory and about 6 s to build its index on load |
| Large libraries | The Library draws only the cards near the view, so scrolling stays smooth however deep you go (measured with 20,000 items: opening about 1 s, wheel scrolling at 60 frames a second at the top and at the end, no stall while typing a search). Search results are redrawn when typing pauses for a quarter of a second. A thumbnail missing from storage is made from its original, three at a time. Backups of many gigabytes have not been measured; an import holds about one 128 MiB batch of files in memory at a time, and each canvas is read whole |
| Frame rate | Measured on one desktop machine; no results exist for other device classes |

**Platform**

| Area | Limitation |
| --- | --- |
| Storage | Browsers cap local storage, and the cap grows once the browser agrees to keep the data (*Ask the browser to keep it*, Settings > Storage): Firefox allows at most 10 GiB (or 10% of the disk, if smaller) before that and up to half the disk after, Chromium about 10 GiB (a Chromium library folder is not counted). Settings > Storage shows the current figure. With a library folder, files in it are outside the browser's protection: files removed there show as missing, and each session needs one click to allow access again. When the browser's storage is full, an import is refused with a notice that points to the backup and to *Delete from library*; edits stay queued and the indicator shows the error. Export backups regularly |
| Origin | Data belongs to the browser profile. Another browser, profile or private window starts empty |
| Rendering | Canvas 2D only, on the main thread; no GPU or WebGL path, no workers |
| Browsers | Tested on Chromium and Firefox on one Linux machine. Safari has not been tested. Touch is tested by emulation |
| Collaboration | None. There is no network by design |
| Passwords | The workspace and Hidden passwords are gates, not encryption: the data is stored as it is, so they do not stop someone with access to the browser's storage or to an exported file that includes hidden items. They cannot be recovered. The workspace password is asked at every open and reload |
| The desktop app | Linux (x86-64 AppImage) only for now; watching the folder for outside changes is verified on Linux only. A `.cvst` copied in from another workspace is not taken in. With a very large library, each change made in `library/` outside the app makes canvast list the whole folder again. A canvas file is written about 2 seconds after editing pauses: until then the edit is safe in the app's own storage on this device, but another device does not see it yet |
| Hidden items in the desktop app | The files and index are encrypted, but: deleting the readable file does not overwrite the disk blocks it used; an item hidden while the key is locked stays a readable file until the password is given; the app's own cache on the device keeps hidden items' names and tags (not their pictures); a canvas file names the content hash of each picture placed on it; exported backups that include hidden items are not encrypted |

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
- **Raster tile cache** for committed objects keeps panning and drawing over dense scenes near 2–3 ms per frame, and a bounded **zoom preview** keeps zooming responsive (the levels one out and one in are prepared while the view rests, the outer one first; zooming out past what is prepared, the edge is drawn exactly).
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

The app reaches storage only through the interfaces in `src/storage/store.ts` (the workspace, backups, the library's entries and its originals); the browser's IndexedDB is one implementation of them (`src/storage/idb-storage.ts`), and `npm run check:storage` keeps IndexedDB out of the rest of the code. Hierarchy: Workspace → Boards → Canvases. The IndexedDB schema (version 12) has stores for workspaces, boards, canvases, objects (one record each), per-canvas views, frames, bookmarks, thumbnails, assets, the asset catalog and metadata. Assets are content-addressed by SHA-256 and stored once; objects on the canvas reference them. A multi-tab **writer lease** guarantees a stale tab cannot overwrite newer data. Originals are removed only by reference-checked garbage collection. With a library folder an original is a file named `<sha256>.<ext>` (written, read back and compared before the browser keeps a stub of it: an `assets` record with an empty blob and `ext: 1`), so every rule keyed by hash is unchanged.

A `.canvast` archive holds a versioned `manifest.json`, one JSON file per canvas and each original once under `assets/<sha256>`, with a CRC on every entry. It is an uncompressed ZIP (ZIP64 beyond 4 GiB or 65,535 files), always one file however big. Import is verified completely before anything is written. The originals are then written a batch at a time (up to 128 MiB each), so an import needs about that much memory whatever the size of the backup, and everything else (boards, canvases, library entries) in one transaction, so it shows all at once or not at all; originals written by an import that did not finish are erased at once, or when the app next opens.

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
  app/           bootstrap, editor state, actions, debug hook
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
| `npm test` | Typecheck, unit, quick end-to-end suite, token, storage, picker and pattern-generator checks (about an hour) |
| `npm run build:patterns` | Build the pattern generators alone into `dist-patterns/` (script, module, types, demo page); `npm run check:patterns` fails if they import from, or touch, anything outside their folder |
| `npm run desktop` | Build the app and run it in the desktop shell (Electron, see [The desktop app](#the-desktop-app-linux)) on a workspace folder: `--workspace=<path>` after `electron dist-desktop`, else the last one opened, else a folder dialog |
| `npm run package:desktop` | Package the desktop app as a Linux AppImage in `dist-package/` (with its SHA-256), from `dist-desktop/` and the pinned Electron, then start that AppImage on a fresh workspace folder and fail unless it writes it. Making it needs the network once (electron-builder's AppImage tools); the app it makes does not |
| `npm run test:full` | The full suite with long stress loops (about 1.5 hours) |
| `npm run test:snap -- <files or -g pattern>` | Run chosen end-to-end specs |
| `npm run test:status` | List test builds with their result and how far each is behind the source |
| `npm run bench` | Scale and tile-cache benchmarks |
| `npm run check:offline` | Fail if the built file references anything outside itself |
| `npm run check:tokens` | Fail on a hard-coded colour, size, space or radius in the CSS |
| `npm run check:storage` | Fail if code outside the storage implementation uses IndexedDB instead of the storage interfaces |
| `npm run check:repro` | Build twice in different folders, time zones and locales and compare the SHA-256 |

Every end-to-end run builds its own copy of the app into `test-builds/` and tests that copy, so `dist/` can be rebuilt while tests run. Tests open the built file from `file://`, drive it through a debug hook, run in Chromium (three configurations) and Firefox, and fail on any network request; the desktop shell has its own project, which runs the snapshot's Electron build on a fresh workspace folder. Test fixtures are generated in code; no binary fixtures are committed. Performance thresholds are fixed in advance and never loosened. On GitHub, a CI workflow (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request: typecheck, unit tests, the build, the offline, naming, token, storage, picker and pattern checks and the reproducible-build check, and a short Chromium end-to-end run of three specs (the whole quick suite, about an hour, is run by hand). It keeps the built file as a downloadable artifact of the run. Test logs with environments and timings are in [docs/testing/](docs/testing/); [docs/status.md](docs/status.md) is the status record.

### The showcase and the screenshots

```sh
npm run build
node scripts/showcase/build.mjs showcase.canvast            # draws the showcase in the app and exports it
node scripts/showcase/shots.mjs showcase.canvast shots/     # imports it in a fresh profile and takes the README pictures (PNG)
node scripts/showcase/shots-privacy.mjs showcase.canvast shots/  # the same for the context menu, hiding, passwords and the lock screen
node scripts/showcase/shots-more.mjs showcase.canvast shots/     # the same for the text, Pattern panel and colour picker pictures
node scripts/showcase/dive.mjs showcase.canvast frames/     # renders the dive, frame by frame (PNG and frames.txt)
```

The README pictures are those PNGs converted to WebP (`cwebp -q 80`) in `docs/screenshots/`. The dive is the frames scaled to 800 px and joined with `img2webp` (`frames.txt` holds each frame's duration); the journey sheet is the frames where the dive pauses, set in a grid with ImageMagick `montage`.

### The logo and its guidelines

```sh
npm run build
node scripts/brand/build.mjs brand.canvast shots/   # draws the brand board in the app and exports the canvas (PNG of each page in shots/)
node scripts/brand/icons.mjs icons/                 # the logo files: SVG masters, PNG 16–512 px, favicon.ico
node scripts/brand/preview.mjs preview/ 1,3         # a quick look at pages without the app
node scripts/brand/cover.mjs docs/brand/cover.webp  # the cover at the top of this README (cwebp -q 85)
```

The logo (a canvas open on its right side, and the dot you zoom into), its colours and its nine guideline pages are defined in `scripts/brand/pages.mjs`. The build draws them on one canvas as nine sheets with bookmarks: the glyph on the construction page is made with the Shape tool and *Subtract*, the crosses with the Path tool, the labels with the Text tool in Space Grotesk (from `scripts/showcase/fonts/`), and the cover's dot holds the mark again at 1/64, twenty times over (121 zoom levels). At 32 px and under the icons use a small-size master drawn on the 16 px grid. The scripts work on a copy of `dist/canvast.html` in the system's temp folder. In the app the full-colour logo is only the favicon (the small-size master, inline in `src/index.html`); everywhere else the app shows the one-colour mark in the theme's text colour, so it follows light, dark and the theme colour: over the lock screen and beside the name in Settings > About and diagnostics (`src/ui/brand.ts`, which holds the same geometry as `pages.mjs`). The cover at the top of this README (`docs/brand/cover.webp`, made by `cover.mjs`) shows the logo with a speck of itself inside its dot (1/64 of the tile) and a zoom cone from that speck to the mark at full size.

### Releasing

`npm run release` publishes `dist/canvast.html` and the desktop app's AppImage (`npm run package:desktop`, which must start before it is handed out), each with its SHA-256, as the latest GitHub release (tag `vX.Y.Z`, the version in `package.json`). Run it after the version is bumped, `CHANGELOG.md` has its `## X.Y.Z — Title (date)` section and everything is pushed: it builds and checks the file, packages the AppImage, creates or updates the release, marks it **Latest** and reads it back to confirm that it is the latest and serves the same file. `npm run release -- --dry-run` does everything but publish and prints the notes. The notes are split into **Features** and **Fixes** from the CHANGELOG: a bullet that starts with `**Fixed:**` is a fix, any other (`**Added:**`, `**Changed:**`, `**Removed:**`) is a feature.

### Reproducible build

The build is deterministic: the same source produces the same `canvast.html`, and `npm run build` prints its SHA-256. Dependencies are pinned to exact versions and line endings to LF.

---

## Security and privacy

- The page's Content Security Policy is `default-src 'none'` with `connect-src 'none'`: it cannot make network requests, even if code tried. Only inline script and style are allowed, images come from `blob:` and `data:`, and workers (if any) from `blob:`.
- canvast has no runtime dependencies and makes no network requests. The interface font is supplied from memory, so no font source is allowed either. `npm run check:offline` and the end-to-end suite both verify this on every build.
- Imports are limited to files of at most 256 MiB, and each is decoded before being stored. Files that fail to decode are rejected with a message.
- Archives are verified completely (structure, checksums and content hashes) before anything is written.
- Optional passwords for the workspace and for the Hidden items (see [Hidden items and passwords](#hidden-items-and-passwords)): only a salted PBKDF2 hash is kept, in this browser, and nothing is encrypted. The library index on disk and any export you decline to include them in carry neither hidden items nor passwords.
- No analytics, no telemetry, no account.

---

## Licences

canvast is released under the [MIT licence](LICENSE), copyright (c) 2026 emarpiee. The built file bundles the Lucide icons (ISC) and the Inter font (SIL Open Font License 1.1); their notices are embedded at the top of `canvast.html` and listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Development-only dependencies, which are not shipped: TypeScript, esbuild, Vitest and Playwright. The showcase archive `showcase.canvast` also carries the Space Grotesk font (SIL Open Font License 1.1, copyright 2020 The Space Grotesk Project Authors) as two library files; the licence text is in [scripts/showcase/fonts/OFL.txt](scripts/showcase/fonts/OFL.txt).

A history of changes is in [CHANGELOG.md](CHANGELOG.md).
