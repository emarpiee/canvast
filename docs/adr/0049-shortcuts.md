# ADR 0049 — Shortcuts: a list and rebindable tool keys

- Status: accepted (Phase 7, slice 2)
- Related: ADR 0017 (settings), ADR 0048 (Settings view)

## Decision

- **One table** (`settings/shortcuts.ts`) names the six tools, their setting keys (`key.hand` ... `key.eraser`, device scope, one letter a to z) and the list of fixed shortcuts shown read-only. `interaction/tools.ts` no longer hard-codes letters: it asks `hooks.toolForKey(key)`.
- **Settings > Shortcuts** shows each tool's key with Change and Reset. Change waits for one key: a letter sets it, Escape cancels, anything else (a digit, a modifier combination) is refused with a reason, and a letter another tool already has is refused naming that tool (no silent swap). The result is announced in a status line.
- **Tool buttons** say their key in the tooltip and follow a change.
- **`?`** (not while typing) opens the list.
- Fixed shortcuts (Ctrl combinations, arrows, Escape, Space) stay fixed: a plain letter never clashes with them.

## Not built

Rebinding of Ctrl combinations and navigation keys, several keys for one tool, import or export of key maps.
