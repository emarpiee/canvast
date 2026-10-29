# ADR 0178 — Saved searches

- Status: **accepted** (2026-10-29, v0.50.42)
- Amends: [ADR 0071](0071-search-checkboxes-and-history.md) (recent searches); revisits [ADR 0082](0082-file-types-replace-smart-folders.md), which removed smart folders

## Context

ADR 0082 removed smart folders (saved searches shown as folders in the library's sidebar): they cluttered the sidebar, and recent searches covered most of their use. The owner asked for saved searches again on 2026-10-29, for the library and the canvas, with three questions: how to keep the library's apart from the canvas's, how not to clutter the interface, and what happens when a list reaches a hundred.

The search keywords added in v0.50.41 (`kind:`, `is:`, `date:`, `on:`, `duration>` and others) make a saved search worth more than before: one line now says what a smart folder's filters said.

## Decision

- **Where:** in the search box, not in the sidebar. A save button sits in the box beside Clear (the `save` icon, a toggle: pressed while the search typed is saved; pressing it again removes it). Nothing new appears anywhere else.
- **Two lists, apart by place:** the canvas search and the library search each have their own list. A box only ever shows its own, so nothing needs to tell them apart. A saved search is its text and its way (All, Name, Tag, Bookmark); its name is its text, so there is nothing to rename.
- **Many saved searches:** with the box empty, the eight used last are shown as chips under *Saved*, above *Recent*, with "N more: type to find them". While typing, the saved searches holding every typed word are offered (those starting with the first word first). A long list is found by typing, never scrolled. Using one moves it to the front. A list holds up to 200; the save button then says to remove one first.
- **Storage:** two device settings (`search.saved.library`, `search.saved.canvas`, JSON validated like every setting). Hidden from Settings, they travel in workspace backups and the library index with the other device settings. No storage interface changes (ADR 0177).
- A recent search that is also saved shows only under *Saved*.

## Consequences

- A saved search is kept per device (like the other device settings), not in the workspace folder. If a workspace-scoped setting backend is built, these two keys move to it.
- Sort order, the Show filter and the sidebar scope are not part of a saved search; the keywords (`is:unused`, `is:favourite`, `folder:`) say the same in the text.
