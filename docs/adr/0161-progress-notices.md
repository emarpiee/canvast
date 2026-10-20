# ADR 0161: progress for everything that makes the person wait

- Status: accepted (2026-10-20, owner's request: importing and exporting gave no clear progress)
- Related: ADR 0053 (notices), ADR 0159 (library folder)

## Problem

The notice stack (ADR 0053) knew progress only from wording ("Importing 3 of 10", "Indexing 45%"). "Preparing the export…" matched nothing, so it was an ordinary notice and faded after 6 seconds while the export went on; the backup, the files ZIP, opening a library index, moving files and deleting everything showed nothing or an inline line that was easy to miss.

## Decision

One helper, `beginProgress(editor, channel, label)` (`src/app/progress.ts`), returns `{ update(fraction | null, detail?), done(result?, action?), fail(text) }`. It puts a **progress notice** in the stack: spinner, the label with the stage ("Exporting the backup: reading the library (12 of 30) 40%"), a bar (a bar that moves without a number when the length is not known: `update(null, "checking the archive")`). It **stays until the work says it ended** (`done` closes it and says the result as an ordinary notice; `fail` closes it and says what went wrong). A watchdog closes a notice that has not been updated for two minutes, so work that dies without saying so cannot leave a spinner for ever. Updates closer than 80 ms are dropped (a loop of thousands of files must not redraw the notice each time) except the end of a stage. Another notice arriving (a "Copied") no longer closes a running progress notice: it ends by its own channel.

Storage jobs report through one callback type, `ProgressFn(stage, done, total)` (`archive.ts`): building an archive (reading the library, reading the files of the library folder, writing the zip, checking it), reading one (checking the files by hash), the files ZIP, `writeZip` per entry. `ui/archive-ui.ts` turns it into the notice (`stages`).

## Where it is used

Export backup, changes only and the library index; the files ZIP; reading an archive and importing it (two notices: reading, then saving into the workspace); opening the library from the library folder; importing files (one notice for the batch with the file name); moving files into and out of the library folder and adding extensions; Start from scratch (and waiting for other tabs). The export dialog's picture keeps its inline "Making the picture…" (it is in the dialog the person is looking at).

## Not covered yet

The library's similar-images search and thumbnail making run in the background without a notice; opening a very large workspace shows "Indexing N%" (ADR 0053), which already works.

## Tests

`tests/unit/progress.test.ts` (starts without a number, fraction and stage, clamps and does not flood, ends once, fail), `tests/e2e/storage.spec.ts` (a progress notice outlasts the time a plain one lasts, shows bar and stage, ends with its result).
