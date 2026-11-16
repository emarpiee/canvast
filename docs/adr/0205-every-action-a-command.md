# ADR 0205 — Every action is a command

- Status: accepted (v0.60.14)
- Related: ADR 0129 (command registry), ADR 0117 (command palette), ADR 0158 (keymap)

## Problem

The registry of ADR 0129 fed the palette, the context menu and macros, but most actions of the app did not go through it: the Library,
the panels, the Actions bar's menus, the file views and the keys ran their code from their own click handlers. A command had no fixed id
(it was made from its title, so renaming a button broke a macro), took at most one text value, gave no result and could not say why it
could not run. An outside program (an MCP client) could not use the app, and a test could reach an action only by clicking it.

## Decision

**Every action of the app is a command, and every caller runs it by id**: buttons, menu rows, keys, bars, the palette, macros, tests and an
outside caller (the control channel and MCP, below).

| A command has (`src/commands/types.ts`) | |
| --- | --- |
| `id` | Fixed, `area.action` (`edit.undo`, `library.move`); the keymap's id when it has a key. Never made from the title, never reused. A renamed id stays as an alias (`registry.alias`) |
| `title`, `hint`, `group`, `icon` | What it is called and one short line of what it does (a menu row's) |
| `options` | Each named and typed (text, number, colour, choice, id, ids, json), required or not, with limits. A run is checked against them before it starts |
| Targets | The items it acts on are an option (`ids`); the selection is only the default |
| `exec` | The action. It never throws: a failure is `{ ok: false, error }`. A success may say what it `made` or `changed` |
| `why` | Why it cannot run now (`REASON`), or null. `needsWorkspace` in the list when the reason is that nothing is open |
| `risk` | `read`, `edit`, `confirm` (an outside caller's run asks the person first), `refused` (never for an outside caller) |
| `record`, `job` | Whether a macro records it (reads never), and whether it is long (progress, cancel) |

`commands` (`src/commands/registry.ts`) is the one registry. `execute(id, options, { caller })` runs a command and gives its result;
`press` is the same for a button or a key (done at once when the command is); `batch` runs several in order; `list` is what an outside
caller reads; an unknown id gets up to three close matches. A macro records whatever ran a command, and plays each step as a command of its
own, so a macro an outside caller runs cannot skip what asks the person.

**What is not a command**: what only changes what is shown (folding a section, a tab, typing in a search box, a hover), marked
`// view-state: <why>` in the code and `data-view-state` on the page; gestures held down (Space to pan); typing in a text editor.

## Enforced

| Check | Where | Fails when |
| --- | --- | --- |
| `npm run check:commands` | CI, every push and pull request | A click, change, input or submit listener that does not run a command and is not marked as view state; a menu row without `command:`; a command without a fixed id, a hint, a risk and `exec`; a file of `src/commands/` that imports the interface |
| `tests/unit/commands.test.ts` | CI | The registry breaks the contract (options, reasons, callers, batches, macros) |
| `tests/e2e/commands.spec.ts` | `Tests`, every run | A command that breaks the rule; a key without a command; a command that takes wrong options or throws; an outside caller running what only the person may; a control shown on the canvas, in the Library or in Settings that runs no command |

What was there before the rule is counted in `scripts/lib/commands-todo.json` (per file, and the live counts). The list only shrinks:
more than the count fails; fewer fails until the count is lowered; a file not on it may have none. When it is empty, the rule holds
everywhere and the list goes.

## Compared with PhotoCraft

PhotoCraft (ArtCraft) is command-first too: every action is an engine command with an id, run by its UI, its command line, its control
channel and MCP; a lexical check (`panel-commands`) with an allowlist that only shrinks, a fuzz test of every command with bad options, a
reason when a command cannot run, jobs with progress and cancel, and files only inside the folders granted to an agent. This ADR takes
those. It does not take its remote driving of the interface (pointer, keys, dialogs over the control channel): our tests have real input
(Playwright), and an outside caller works through commands, where the rule and the person's confirmation apply.

## Not yet

The commands of the canvas are in `src/app/canvas-commands.ts`, reached through `CanvasActions`; the other parts register theirs as they
move (the list says how many are left). The control channel and MCP come after every action is a command.
