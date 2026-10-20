# ADR 0158: the keymap: every shortcut can be changed, to a key or a chord

- Status: accepted (2026-10-20, owner's request)
- Related: ADR 0049 (shortcuts), ADR 0058 and 0063 (the focus key)

## Decision

Every key that does something is a **command** of the keymap (`src/settings/keymap.ts`): the tools, the keys that step between items, Zen, focus and fit, zoom, pan, the views, the command palette and the searches, undo and redo, select all, duplicate, group, ungroup, order, flatten, delete. Settings > Shortcuts lists them all, each with its keys, and each can be changed (**Change**: replace, **Add**: another key beside it, **×**: take a key away, **Reset**). A binding is one key or a chord with Ctrl, Alt and Shift (`F`, `Alt+Q`, `Ctrl+Shift+F`); Ctrl stands for Cmd as everywhere in the app. **Reset every shortcut** puts all back.

The focus on the selection, and again to fit everything, is **F** (it was an Alt tap, then Ctrl+Space for a day: the owner's system took Ctrl+Space for its input method, which is the kind of thing the warnings below are for).

## How it works

The handlers are unchanged: each still listens for one fixed key per command (its `internal` combo). `installKeymap` puts a capture-phase layer in front of them, first on `window`: a key that is **bound to a command** is sent on as that command's internal key (a new `KeyboardEvent` on the same target; its key up follows its key down, so holding Space to pan works on any key); a key that was a command's own and has been **given up** is dropped. It does nothing while the person types in a field or edits a text (unless Ctrl or Alt is held), inside a dialog, in Settings, or while Settings is waiting for keys. Only the global commands (palette, searches) work in the Assets view.

The bindings are one device setting, `keys.custom` (JSON, only what differs from the defaults). The old per-tool letter settings (`key.pen`, ...) are moved over once and reset.

## Warnings (`judge`)

| Level | When | What happens |
| --- | --- | --- |
| Refused | Escape, Tab, a bare Enter; what the browser keeps (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab, Alt+F4, ...) | said why, nothing changes |
| Asked | a key another command has | "X is already the key for Y": use it here and take it from Y, or cancel |
| Asked | what the system or the browser may take or has a job for (Ctrl+Space, Alt+Space, Ctrl+S, Ctrl+R, F5, Alt+letter, Ctrl+Alt+letter, ...) | said why; use it anyway or cancel |
| Said | a key the text editor also uses while typing (Ctrl+I); a bare key (not while typing in a field) | said, applied |

## Not changed, and why

Copy, cut and paste are the browser's clipboard events, which a page cannot be given other keys for. Escape and Enter keep their jobs. The gestures that use a modifier with the pointer (Alt+drag copies, Ctrl+click picks deep, Shift keeps proportions, ...) are listed read-only under Settings > Shortcuts.

## Tests

`tests/unit/keymap.test.ts` (combos, events, the table, resolving, the move from the old settings, the warnings); `settings.spec.ts` "shortcuts" (changing a tool key, a chord with a warning, adding and removing a key, a refused key, Escape, the old keys no longer working, undo on a chord, reload, reset all); the focus on F in `editing.spec.ts`.
