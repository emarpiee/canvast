# ADR 0180: one set of rules for file and folder names

## Context

Nine functions cleaned names, with small differences: a run of forbidden characters became one `-` or several, a name could end in a dot in the app and not on disk, numbering was `-2`, ` (2)`, `_2` or ` 2`. Each difference was a way for the app and the disk to disagree.

## Decision

`src/doc/file-names.ts` holds the rules: what is invalid, the two styles (`kept`, `clean`), an item's name, a note's name, numbering, the clash test, what a disk takes for one folder, and the words of warning. Components call it; `npm run check:name-rules` fails on the forbidden-character list anywhere else.

A rule applies to names being made. **A file on a disk is never renamed by a newer rule**: `keptFits` accepts what an earlier version wrote, so opening a folder moves nothing. `Repair library file names` applies today's rules, only when asked.

Risky characters that are valid are warned about, never refused. Two sibling folders with one disk name are refused in the interface; the catalog does not refuse them, so importing a folder or reading one from disk never fails on it.

## Consequences

Names in ZIPs and exports change slightly in unusual cases, for new exports only.
