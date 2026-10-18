# ADR 0129 — One command registry, the bars as commands, `@kind`

- Status: accepted (v0.18.0)
- Related: ADR 0117 (command palette), ADR 0128 (bars)

## Problem

The palette's list was built inline in `main.ts`, so a new button or setting was in the palette only if someone remembered to add it there (the Actions bar's "View in the library" was not found), and there was no place for a macro to add commands, run a command by name, or ask what commands exist.

## Decision

- **Commands are data** (`src/commands/types.ts`): `id`, `title`, `group` (the label shown), `kind` (the `@keyword`), `keys`, `words`, `enabled`, `run`.
- **One registry** (`src/commands/registry.ts`). Each part of the app adds a *provider* under its own name (`setProvider`): a function that makes its commands when asked, so what is possible now is read when the palette opens. `all()` fills ids and kinds and leaves out a title another source already gave (earlier sources win); `run(id)` runs a command by name if it can be done now; `kinds()` lists the kinds. Providers today: `app` (tools, edit, arrange, view, go to, workspace), `panels` (the panel dock), `settings`, `bars`.
- **The bars are commands, read from the page** (`src/commands/from-bars.ts`). A bar says what it is called (`data-cmd-group`: Tools, Properties, Colours, Actions, Dock, View controls, Navigate); every button, switch, field and menu in it that shows now becomes a command (a button is pressed, a field or menu is focused, "Edit text size"). Hidden and switched-off controls are not offered, which is exactly "what can be done now". A button added to a bar is in the palette with no further code; controls that are many and nameless (colour chips) say `data-no-command`. The short title is the label before its explanation, the key is read from the tooltip.
- **The settings are commands, read from the Settings view's rows** (`src/commands/settings-commands.ts`): a switch is toggled ("Toggle zen mode"), each choice of a menu is one command ("Theme: Dark", not offered when it is the one now), and every row can be opened in Settings. A new setting row is in the palette with it.
- **`@kind` narrows the palette** (`parseQuery`, `findCommands`): `@settings theme`, `@toolbar lock`, `@tool`; the start of a kind is enough (`@set`); the other words still apply. Typing `@` (or `@se`) lists the kinds there are, with how many commands each has; Enter completes one and goes on typing. The kind of a command is its own `kind`, else its group in lower case as one word.
- **Macros** (not built) fit without changing any of this: a macro is a provider (`setProvider("macros", …)`) whose commands run others with `registry.run(id)`; the ids of the commands are stable (`kind:title`, numbered when two share one) and `@macro` is a kind of its own.

## Added later (v0.18.1)

- **Recents:** with nothing typed, the commands used last (up to 8, on this device) come first.
- **Commands that take a value** (`takes: { prompt, run }`): the box asks for the value (a new name) after the command is chosen. `registry.run(id, arg)` passes it. Today: rename this canvas, rename this board, save the macro.
- **Macros** (`src/commands/macros.ts`): "Record a macro" starts a recording of the commands run through the registry (from the palette); "Save the macro" (it takes the name) stores it on this device in `localStorage`; `@macro` lists "Run <name>" and "Delete the macro <name>". A step that cannot be done at playback is skipped and the notice says how many ran. Buttons clicked directly are not recorded, only commands run from the palette.
- **Boards and canvases** are commands (`@canvas`), and the fixed shortcuts of Settings > Shortcuts are commands (`@shortcut`, `quiet`: found only when the kind is typed, so they do not crowd the plain search; choosing one opens the shortcut list).
