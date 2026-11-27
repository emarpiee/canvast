# Behaviours

How the editor acts as it is used (typing, keys, clicks, pastes), kept apart from how Markdown is read and drawn (`../syntax.ts`,
`../render.ts`, `../live.ts`). One module per behaviour; `index.ts` lists them (`BEHAVIORS`) and the editor's `behaviors` option turns any
off by its id.

| Module | What it does | Comes from | Test |
| --- | --- | --- | --- |
| `format-toggle.ts` | A format key inside a word formats the word, inside a span takes it off; elsewhere an empty pair, the cursor stepping out at its end | canvast's first editor; notes apps | notes.spec, selected words |
| `wrap-selection.ts` | A pair's sign typed over selected words goes round them (table cells too) | canvast's first editor | notes.spec, selected words; New note |
| `auto-pair.ts` | ( [ { close themselves, quotes in code | notes apps | |
| `list-enter.ts` | Enter adds the next item right below | notes apps | notes.spec, lists |
| `renumber-lists.ts` | Numbered lists keep counting | notes apps | notes.spec, lists |
| `move-lines.ts` | Alt+Up, Alt+Down move lines | notes apps | notes.spec, lists |
| `marker-hop.ts` | Alt+] and Alt+[ step over marks | notes apps | |
| `task-toggle.ts` | Ctrl+L makes and ticks a task; a box ticks on a click | notes apps | notes.spec, lists |
| `reflow.ts` | Alt+Q joins a wrapped paragraph | notes apps | |
| `link-follow.ts` | A click on a drawn link follows it, Ctrl+click anywhere | notes apps | notes.spec, [[links]] |
| `paste-rules.ts` | A link pasted over words makes them the link; pages to Markdown; pictures on lines of their own | canvast's first editor; notes apps | notes.spec, pasted notes |
