/**
 * PhotoCraft's switches: what of it canvast shows, and how canvast stands in for what a page cannot do. `true` shows or turns on, `false`
 * hides or turns off. PhotoCraft itself is never changed: its menu items and tools are hidden through its own preferences (Edit > Menus,
 * Edit > Toolbar), written again each time it opens, so these always win. An id not listed keeps whatever PhotoCraft shows.
 *
 * Ids are PhotoCraft's own: menu items by command id (its `crates/ui-egui/src/menu_catalog.rs` and `menus/items.rs`), tools by name
 * (`TOOL_SECTIONS` in `crates/ui-egui/src/panels/toolbar.rs`). `npm run photocraft:check` fails when one is gone from a release, and
 * lists the new ones. A few items PhotoCraft never lets be hidden (Save, Save As, Exit, Edit > Menus, Edit > Keyboard Shortcuts, every
 * Preferences page): the check refuses `false` for them.
 */
export const PHOTOCRAFT_FEATURES = {
  /** Where canvast offers it. */
  entry: {
    /** Edit in PhotoCraft on the Actions bar, for the pictures selected on a canvas. */
    canvasPictures: true,
    /** Edit in PhotoCraft on a library item (its details panel and its menu). */
    libraryItems: true,
    /** A blank PhotoCraft from the command list (Ctrl+K). */
    newDocument: true,
  },
  /** canvast in place of what PhotoCraft's page would do in a browser. */
  bridge: {
    /** File > Open and Place take a file from the library (or this device, from the chooser) instead of the browser's file picker. */
    openFromLibrary: true,
    /** Save, Save As and Export come back to canvast (the library, the canvas) instead of downloading. */
    saveToLibrary: true,
    /** The fonts of the library are in PhotoCraft's font menus. */
    libraryFonts: true,
  },
  /** Its menu items. */
  menus: {
    // web links and the update check: canvast makes no network requests
    "help.website": false,
    "help.github": false,
    "help.discord": false,
    "help.reportIssue": false,
    "help.artcraftWebsite": false,
    "help.checkForUpdates": false,
    // recent files: their names would be kept in the browser's storage (the library is the list of files)
    "file.clearRecent": false,
    // what needs folders of files on a disk, which its page cannot have
    "file.automate.batch": false,
    "file.automate.createDroplet": false,
    "file.automate.contactSheetII": false,
    "file.scripts.imageProcessor": false,
    "file.scripts.scriptEventsManager": false,
    "file.scripts.browse": false,
    "file.export.layersToFiles": false,
    "file.export.layerCompsToFiles": false,
    "file.export.artboardsToFiles": false,
    "file.export.dataSetsAsFiles": false,
    "file.package": false,
    "file.import.wiaSupport": false,
    "plugin.install": false,
    // printing
    "file.print": false,
    "file.printOneCopy": false,
  } as Record<string, boolean>,
  /** Its tools, by name (Brush, Sponge, CloneStamp…). None hidden. */
  tools: {} as Record<string, boolean>,
} as const;

export type PhotoCraftFeatures = typeof PHOTOCRAFT_FEATURES;
