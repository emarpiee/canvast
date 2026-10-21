# Icon registry (checked 2026-10-17)

One icon per function: two buttons that do different things never share an icon, and the icon says what the button does. Several buttons of the same function (every "close", every "delete") share one. The common verbs have one common icon each, checked by `tests/e2e/icon-audit.spec.ts` (it reads the source: by the first word of a button's name, Save → `save`, Import → `arrow-down-to-line`, Download → `download`, Upload → `upload`, Delete → `trash-2`, Remove → `x`, Update → `refresh-cw`, Play → `play`; and `save`, `arrow-down-to-line` and `refresh-cw` belong to those alone). A new button of one of these verbs takes its icon; a different verb takes a different one. Add a row here when you add an icon. Collected from the running app (canvas, panels, menus, Assets view and viewer); icons used only in states not opened then (media player, text editor, settings) are in `src/ui/icons.ts`.

| Icon (lucide) | Function(s) |
| --- | --- |
| `save` | Save: Save as a style, Save to library (the export dialog, the Actions bar, the context menu), Save from the text, Save the adjustments (nothing else carries it) |
| `arrow-down-to-line` | Import: every import button and menu row, the Import tool of the rail, Import a folder, Import styles (nothing else carries it) |
| `refresh-cw` | Update: Update from the picked picture, from the Pattern panel, to the current view, the bookmark pictures, the initial state (nothing else carries it) |
| `expand` | Scale contents with the sheet (the sheet's size field) |
| `chart-spline` | Simplify the picked paths: fewer nodes, the same shape (Actions bar) |
| `pencil-ruler` | Turn the picked pen strokes into editable paths (Actions bar) |
| `sticky-note` | Note tool (a text on a card) |
| `stamp` | Outline stroke: make the line a shape (Actions bar) |
| `feather` | Taper: make the line a shape thin at both ends (Actions bar) |
| `venetian-mask` | Clipping mask: the top shape cuts what else is picked (Actions bar) |
| `circle-dashed` | Mask by opacity (Actions bar) |
| `contrast` | Mask by brightness (Actions bar) |
| `scan-eye` | Pick the mask of the picked things (Actions bar) |
| `circle-slash` | Invert the mask (Actions bar) |
| `circle-minus` | Release the mask (Actions bar) |
| `sun` | Paint the mask in white: the Pen shows (Actions bar) |
| `moon` | Paint the mask in black: the Pen hides (Actions bar) |
| `slice` | Divide the picked shapes into the regions they overlap in (Actions bar) |
| `puzzle` | Shape builder (Actions bar) |
| `network` | Vector network: join the picked paths (Actions bar) |
| `unplug` | Release the network (Actions bar) |
| `route` | Set the picked text along the picked path (Actions bar) |
| `route-off` | Take a text off its path (Actions bar) |
| `case-sensitive` | Font options of a text (kerning, features, axes) |
| `link-2` | Link of the selected words (text editor bar) |
| `rows-3` | Paragraph and box options of a text (paragraph space, first line, case, most lines, height) |
| `underline` | Underline the selected words (text editor bar) |
| `strikethrough` | Strike through the selected words (text editor bar) |
| `baseline` | Colour of the selected words (text editor bar) |
| `a-arrow-up` | Make the selected words bigger (text editor bar) |
| `a-arrow-down` | Make the selected words smaller (text editor bar) |
| `a-large-small` | The Text styles tab of the Styles panel |
| `captions` | Item names: always shown |
| `scan-text` | Item names: shown for the picked items |
| `captions-off` | Item names: hidden |
| `align-left` | Align text left |
| `align-center` | Align text in the centre |
| `align-right` | Align text right |
| `align-justify` | Justify text |
| `move-horizontal` | Text width follows its words (auto width) |
| `wrap-text` | Text wraps at a set width (fixed width) |
| `align-horizontal-distribute-center` | Horizontally |
| `align-horizontal-justify-center` | Centre |
| `align-horizontal-justify-end` | Right |
| `align-horizontal-justify-start` | Left |
| `align-vertical-distribute-center` | Vertically |
| `align-vertical-justify-center` | Middle |
| `align-vertical-justify-end` | Bottom |
| `align-vertical-justify-start` | Top |
| `arrow-down-a-z` | Sort the layers by name; By name, A to Z |
| `arrow-down-z-a` | By name, Z to A |
| `arrow-up-down` | Sorted: Newest first. Reverse the order |
| `bell` | Show a sample notice (developer tools) |
| `blocks` | Arrange and align |
| `swatchBook` | Styles panel |
| `wandSparkles` | Settings > Appearance: Adaptive theme colour (the hue follows the canvas background) |
| `galleryThumbnails` | Bookmarks panel: Update the pictures of the bookmarks |
| `slidersHorizontal` | Styles panel: Adjustments tab |
| `blend` | Styles panel: Gradients tab |
| `droplet` | Styles panel: Colours tab |
| `palette` | Styles panel: Palettes tab |
| `fileUp` | Styles panel: Import .ggr or .gpl files |
| `droplets` | Styles panel: Change colour (menu item) |
| `rainbow` | Styles panel: New palette from a colour (harmony) |
| `pipette` | Colour picker: pick a colour from the screen (the picker module draws its own copy, `src/colour-picker/picker.ts`) |
| `listChecks` | Under your finger menu (long press): Add to the pick |
| `pathMenu` | Actions bar: Path tools (simplify, outline stroke, taper, network, divide, shape builder, text to path) |
| `boolMenu` | Actions bar: Shapes (the boolean operations and their group) |
| `maskMenu` | Actions bar: Masks (make, pick, invert, release) |
| `paintNone` | Paint chooser: No fill or outline |
| `paintSolid` | Paint chooser: a colour |
| `paintLinear` | Paint chooser: a linear gradient |
| `paintRadial` | Paint chooser: a radial gradient |
| `paintAngular` | Paint chooser: an angular gradient |
| `paintImage` | Paint chooser: a picture as the fill (Image) |
| `paintObjects` | Paint chooser: objects repeated over the shape (Objects) |
| `markdown` | Copy Markdown (the text format bar, the Export menu) |
| `selectAll` | Context menu: Select everything |
| `paste` | Context menu: Paste |
| `exportMenu` | Actions bar: Export and copy out (Export…, Save to library, Copy Markdown) |
| `sheetMenu` | Actions bar: Sheets (put on a sheet, release, fit to contents) |
| `arrangeMenu` | Actions bar: Arrange in a grid (opens the menu of orders and spaces) |
| `alignMenu` | Actions bar: Align and distribute (opens the menu of the eight) |
| `paintBucket` | Navigation bar: Canvas background colour (hold to go back to the default) |
| `bookmark` | Bookmarks panel |
| `bookmark-plus` | Add bookmark |
| `bookmark-check` | Bookmark the picked things |
| `box-select` | Axis-aligned selection box |
| `bring-to-front` | Bring to front |
| `calendar-days` | By date added, newest first |
| `camera` | Screenshot (left tool rail, above Search) |
| `arrow-left` | Back to the library (top left of the library viewer) |
| `sun-moon` | Background of see-through pictures (library viewer, bottom right) |
| `chevrons-down` | Hide the controls (library viewer) |
| `chevrons-up` | Show the controls (library viewer) |
| `rotate-cw-square` | Apply rotation (Actions bar, beside Reset rotation, `rotate-ccw`) |
| `check` | Canvas 1empty; Done in the Pattern panel (as every other Done) |
| `chevron-down` | Folders; Smart folders; Tags; Canvas tags; Place on another canvas or a new one; Hide the controls |
| `chevron-left` | Previous |
| `chevron-right` | Next |
| `chevrons-down-up` | Collapse all groups |
| `chevrons-up-down` | In stacking order |
| `circle` | Ellipse shape |
| `circle-help` | How to combine search words |
| `copy` | Duplicate |
| `download` | Download original (library details and selection bar) |
| `ellipsis` | More actions for board Board 1; More actions for canvas Canvas 1 |
| `eraser` | Object eraser |
| `external-link` | Open in a new tab |
| `eye` | Show all hidden |
| `eye-off` | Hide the selection; Hide selection |
| `file-archive` | Export all files as ZIP; Export the files of canvas Canvas 1 as a ZIP |
| `file-output` | Export canvas Canvas 1; Export as archive |
| `file-type` | By type |
| `focus` | Fit the selection in view |
| `folder-plus` | New folder |
| `folder-x` | Unfiled1 |
| `frame` | Fit everything in view |
| `grid-3x3` | Canvas pattern: Grid |
| `group` | Group |
| `hand` | Hand (pan) |
| `hard-drive-download` | Export a backup (.canvast) |
| `hexagon` | Polygon shape |
| `highlighter` | Marker |
| `house` | Return to origin |
| `image-down` | Extract frame (media player) |
| `image-plus` | Fill in the missing bookmark pictures; New palette from the picked picture |
| `images` | Assets view; All assets1 |
| `infinity` | Canvas view |
| `info` | Information shown (one icon for every level; a number 0 to 3 in the corner says how much) |
| `lasso` | Lasso |
| `layers` | Layers panel |
| `layout-grid` | Thumbnails |
| `layout-list` | List |
| `leaf` | Zen mode |
| `library` | View in the library (selection bar) |
| `locate` | Show 1 instance(s) on Board 1 › Canvas 1 |
| `lock` | Lock thickness |
| `lock-keyhole` | Lock the selection: it is drawn, but cannot be pic; Lock selection |
| `lock-keyhole-open` | Unlock all |
| `magnet` | Snap to other objects |
| `map-pin` | Place on Board 1 › Canvas 1 |
| `maximize` | Full screen |
| `merge` | Flatten a boolean group into one path (Actions bar) |
| `split` | Release the shapes of a boolean group (Actions bar) |
| `minus` | Zoom out |
| `mouse-pointer-2` | Select |
| `mouse-pointer-ban` | Ignore the object that fills the view |
| `move-diagonal` | Thumbnail size |
| `panel-right` | Details panel |
| `pen-line` | Ink pen |
| `pen-tool` | Fine pen |
| `vector-polygon` | Make editable vector shapes from an SVG picture |
| `scan` | Sheet tool |
| `square-dashed` | Put the picked objects on a sheet |
| `square-dashed-x` | Release the sheet (keep what is inside) |
| `scissors-line-dashed` | Clip content of a sheet (Layers) |
| `crop` | Crop the picture |
| `fullscreen` | Show the whole picture (remove the crop) |
| `sliders-vertical` | Adjust the picture (the Properties bar), and the Adjust panel button of the panels bar: both open the Adjust panel |
| `shrink` | Fit the sheet to what is on it |
| `link` | Attach the picked objects to another object |
| `unlink` | Detach the picked objects |
| `arrow-up` | Move a board or canvas up in its list; Move a bookmark up |
| `arrow-down` | Move a board or canvas down in its list; Move a bookmark down |
| `scissors` | Eraser: cut parts out of strokes |
| `copy-check` | Similar images (the library) |
| `corner-up-left` | Previous view (camera history) |
| `corner-up-right` | Next view (camera history) |
| `dices` | Every randomizer: Random empty view (bottom-right controls), Randomize in the Pattern panel, the gradient editor, the options of a pattern or picture fill (the picker module draws its own copy of it) |
| `dice-5` | New seed: another arrangement with the same settings (Pattern panel) |
| `sparkles` | Generate the pattern (Pattern panel) |
| `mountain-snow` | Pattern panel (dock button) |
| `snowflake` | Pattern panel: keep this setting when randomizing (freeze) |
| `arrow-right-left` | Turn the sheet on its side (sheet bar) |
| `image-up` | Export… (Actions bar, command palette) |
| `clipboard-list` | Copy the adjustments of a picture |
| `clipboard-paste` | Paste adjustments |
| `clipboard` | Copy a picture to the clipboard as it looks |
| `copy-plus` | Make a new picture of it as it looks |
| `list-restart` | Reset the adjustments of a picture |
| `map-pinned` | Actions bar: Initial state (set, update, reset) |
| `map-pin-plus` | Set initial state |
| `map-pin-house` | Reset to initial state |
| `pencil` | Pen |
| `pencil-line` | Pencil |
| `pentagon` | Shape tool |
| `play` | Play (every media bar), Play the bookmarks as a tour, Slideshow |
| `plus` | Zoom in |
| `presentation` | Start the slideshow |
| `rectangle-horizontal` | Rectangle shape |
| `redo-2` | Redo |
| `replace` | Convert text to path (the selection bar) |
| `ruler` | By size, largest first |
| `scaling` | Pen size follows zoom |
| `search` | Search the canvas |
| `send-to-back` | Send to back |
| `settings` | Settings |
| `shapes` | Erase whole groups |
| `slash` | Line shape |
| `line-style` | Outline options (width, position, corners, ends, dashes) |
| `sparkle` | Star shape |
| `spline-pointer` | Path tool (curves) |
| `square-arrow-out-up-left` | Take the shapes out of the boolean group |
| `square-plus` | Add the shapes to the boolean group |
| `square-round-corner` | Lock corner radius (resizing keeps the radius) |
| `squares-exclude` | Exclude overlap |
| `squares-intersect` | Intersect |
| `squares-subtract` | Subtract |
| `squares-unite` | Union |
| `star` | Favourites0; Add to favourites |
| `tag` | Tags panel; Tag the selection |
| `text-cursor-input` | Rename the selected layer (double-click its name t; Rename canvas Canvas 1 |
| `trash-2` | Delete selection; Delete canvas Canvas 1; Delete from library |
| `type` | Text |
| `undo-2` | Undo |
| `vector-square` | A path or shape in the Layers list |
| `waves` | Stabilizer |
| `waypoints` | Edit nodes tool |
| `x` | Hide the Layers panel; Hide the Tags panel; Hide the Bookmarks panel; Close details; Close slide view |
| `square-pen` | Settings tab: Drawing and selection |
| `compass` | Settings tab: Navigation |
| `keyboard` | Settings tab: Shortcuts |
| `circle-play` | Settings tab: Media and playback |
| `monitor` | Settings tab: Appearance |
| `panels-top-left` | Settings tab: Panels |
| `gauge` | Settings tab: Performance |
| `hard-drive` | Settings tab: Storage |
| `shield` | Settings tab: Privacy |
| `users` | Settings tab: Collaboration |
| `badge-info` | Settings tab: About and diagnostics |
| `code` | Settings tab: Develop |
| `undo-dot` | Reset a setting to its default (every row of Settings) |
| (own inline icon in `src/colour-picker/picker.ts`, not lucide) | Pick a colour from the screen (the colour picker's eyedropper) |
