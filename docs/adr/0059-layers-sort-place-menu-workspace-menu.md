# ADR 0059: Layers panel sort and guides, "Place on…", workspace menu cards, tag chips

Status: accepted (owner requests, 2026-10-16)

1. **Sort** (Layers panel, name sort A to Z or Z to A). The proper term for ordering the stack by name is *Sort*; "Arrange" stays the grid and alignment command that moves items. Sorting changes only `z` (one undo step, `setStackOrder`): a group is ordered by its own name (automatic "Group" if unnamed), then the items inside it are sorted the same way, so a group stays together. A to Z puts A in front (top of the panel).
2. **Indentation guides:** every nesting level draws a vertical guide line; group rows are bold with a count chip and a tint; a row's tooltip shows its path (`Group › Group › item`); a newly made group opens, an item selected on the canvas opens its groups once per selection, and one button expands or collapses every group.
3. **Place on…:** every Place button is split: the main part places on the open canvas; the arrow opens a menu of every board with its canvases (what each holds, the open one checked), "New canvas in <board>" and "New board with a canvas". The target is opened first so the pictures land there (`Session.placeAssetsOn`); the notice names where.
4. **Workspace menu:** boards are cards, canvases hang under a guide line, "+ New canvas" is a quiet line under the board's canvases, "+ New board" is its own outlined button, the whole-workspace actions are a separate section.
5. **Tags as chips** on cards and in the list (`.tag-pill`); the sidebar's tag chips are tight (their More button floats over the count).
6. **Checkboxes** appear on every card only while several are being picked (Ctrl, Shift, a checkbox), not for one plain click.
