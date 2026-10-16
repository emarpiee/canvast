# ADR 0094: Settings tabs in groups, and a search

## Status
Accepted (v0.17.0)

## Decision
The tabs are in four groups with small headings: Working (Drawing and selection, Navigation, Shortcuts), Media (Media and playback, Screenshot), Interface (Appearance, Performance) and App (Storage, Privacy, Collaboration, Develop). A search box beside "Back to canvas" (press `/` in Settings to start; Escape clears it, a second Escape leaves) filters every setting at once: all the words must be in a row's name, help, key, card title or tab name. While a search is on, every tab shows with only its matches, a badge on each tab in the list says how many it has (a click scrolls to it), and "Nothing in Settings matches" says when there are none. Shortcuts and the information tabs are searched by their text too.
