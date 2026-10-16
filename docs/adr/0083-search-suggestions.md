# ADR 0083: Suggestions while typing a search

## Status
Accepted (v0.17.0)

## Decision
- Under both search boxes (the canvas search and the library search) chips suggest how to finish the word under the cursor (`src/search/suggest.ts`, `src/ui/search-suggest.ts`):
  - a word starting with `.` suggests the file types in the library (most files first);
  - a word starting with `#` suggests tags, those that start with it first;
  - a plain word suggests matching tags and file types;
  - a capital letter suggests the operator it starts (`O` suggests OR), and after a finished word the operators that can follow (AND, OR, XOR).
- A press on a chip, or **Tab** for the first one, puts it into the text (replacing only that word) and searches. The press does not take the focus from the box.
- The placeholders no longer repeat the tabs: the box says "Search" (Name, Tag, Bookmark in those ways).
- Where the tags come from: the library's tags and file types (library search); the canvas's items, the tags of their originals and the file types of their names (canvas search).

## Also (ADR 0070)
In-canvas tags say which canvas they are on: in the picture's details each "Tags used on canvases" chip has "on Board › Canvas" beside it, and a Canvas tags chip in the sidebar lists its canvases in the tooltip.
