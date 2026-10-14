# ADR 0017 — Settings and their scopes

- Status: accepted (Phase 1, owner go-ahead 2026-10-14)
- Related: engineering plan §14.40 (Settings panel), §14.35 (backups include settings), ADR 0006 (storage), ADR 0008 (archives)

## Context

Phase 1 asks for "settings scopes". Until now the only persisted preference was the last view, kept in `localStorage` under its own key; pen colour, size, stabilizer and the select options reset on every reload. The plan separates **device/browser-local**, **workspace-shared**, **board-scoped** and **instance-specific** settings, requires validated defaults, safe reset, migration and an immediate-or-restart flag, and says private device data must never travel with an exported workspace.

## Decision

`src/settings/settings.ts` declares every setting once (`SETTINGS`): scope, default, validator and effect (`immediate` or `restart`). `SettingsStore` reads and writes them.

| Scope | Meaning | Storage | State |
| --- | --- | --- | --- |
| `device` | This browser only; never exported or shared | `localStorage`, one JSON blob (`canvast.settings`) | Built. Last view, pen colour and size, stabilizer on and strength, pen size follows zoom, ignore the object that fills the view, lasso filter. |
| `workspace` | Shared by the whole workspace; in its backups | IndexedDB (a `settings` store, schema 5) | Declared in the type, **no storage yet**: setting one throws. Built with its first real setting (Media and Playback defaults, Phase 6), together with archive format 3. |
| `board` | Overrides the workspace value for one board | Same store | Same. |
| instance | A property of one object (a video's pause position) | In the object itself | Not a setting; no work here. |

- **Validation:** stored values are untrusted. A value that fails its validator is ignored and the default is used; `set` rejects an invalid value and does not write an unchanged one.
- **Reset:** `reset(key)` removes the stored value.
- **Migration:** the old stand-alone `canvast.view` key is adopted once and removed on the next save.
- **Failure:** without storage (private mode, blocked) values live for the session; a failed write never throws into the app.
- **Not persisted on purpose:** the thickness lock, because its reference is a zoom depth tied to one canvas, not a preference.

## Why this much

The workspace and board scopes have no consumer yet. Building their storage, schema 5 and an archive format now would be code nobody uses and could not be tested against real behaviour. The scope model, the registry and the device store are real and wired; the other two scopes get their storage when the first setting needs it, and the type already refuses to store them silently in the wrong place.

## Consequences

- The Settings panel (Phase 7) is a view over `SETTINGS`; it adds no new storage.
- A new setting is one entry in `SETTINGS`; its scope decides where it lives and whether backups carry it.
