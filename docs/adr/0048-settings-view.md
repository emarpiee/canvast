# ADR 0048 — The Settings view

- Status: accepted (Phase 7, slice 1)
- Related: ADR 0017 (settings scopes), engineering plan §14.40 and Phase 7

## Decision

- **A third top-level view**, beside Canvas and Assets: a tab "Settings" in the view switch (`ui/view-switch.ts`), a page `ui/settings-view.ts`. Like the Assets view it makes the canvas inert and stops drawing while it is open. Canvas shortcuts do not act there (`interaction/shortcut-scope.ts`: only the Canvas view has them). The view itself is **not remembered**: a reload opens the Canvas or Assets view.
- **Tabs** (vertical tab list, arrow keys, Home and End): Drawing and selection, Media and playback, Performance, Appearance, Storage, Privacy. Storage shows what the browser says (used, available, protected from clearing) and that browser storage is not a backup; Privacy states the no-network rule.
- **Rows are the declared settings** (`SETTINGS_TABS`, a table that names the control for each key). Each row shows its label (the control's accessible name), help text (its description), the **scope** (This device / workspace / board) and a **Reset** that is disabled at the default. A value the setting refuses puts the control back to what is stored.
- **One store, both ways:** the toolbars write the editor and the editor writes the store (ADR 0017); a change made in the Settings view now writes the store and the store updates the editor (`main.ts`), so the toolbar shows it. Adaptive quality and the frame counter follow the store too.
- **Theme** is a new device setting `ui.theme` (system, light, dark), applied as `data-theme` on the root; CSS has the dark palette for both "system and dark" and "dark chosen". The canvas theme is read again and the tile cache cleared on change.
- **Layers panel fix found on the way:** a name starts to be edited after two presses on the same row within half a second; that timer is reset when a document loads, so a press on another canvas never counts.

## Not built

Workspace and board scopes (declared, no storage yet, so no rows), keyboard shortcut rebinding, a search over settings, high-contrast and reduced-motion options, and import or export of settings.
