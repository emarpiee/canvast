# ADR 0060: search the canvas

Status: accepted (owner request, 2026-10-16)

- **Keys:** `/` searches the open canvas by file name (pictures), layer name, group name or text; `#` searches pictures by the tags of their original; `@` searches the canvas's bookmarks. The first character in the box chooses the way and can be changed while typing. A dock button opens it too.
- **Results** (at most 50, front first; hidden items are left out) show an icon, the name and a note (the matching tags, the kind, "in a group"). Enter selects the highlighted item and brings it into view (the Settings > Navigation zoom choice applies; the groups it is in are entered so it can be picked); Shift+Enter selects every match; a bookmark result goes to that bookmark; Escape closes. The box is a combobox with a listbox of options.
- File names and tags are read from the library once per original each time the box opens; the list redraws when they arrive.
- The box swallows its own keys, so typing never reaches the canvas shortcuts.

**Amendment:** the key (or a first `/`, `#` or `@` typed in the box) only chooses the way and is not part of the text; the way is shown as three tabs (Name, Tag, Bookmark) that can also be clicked, Backspace in an empty box returns to Name, and the placeholder and empty message follow the way. One type size (13 px) is used throughout.
