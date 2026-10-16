# ADR 0054 — The Assets view: one library, one viewer, several picks, a slideshow

- Status: accepted (owner feedback of 2026-10-16: decluttered; combine the properties and the slide view; keep the viewer when coming back from placing; Ctrl and Shift selection with checkboxes for touch; a slideshow)
- Related: ADR 0007 (assets view), 0011 (organization), 0052 and 0053 (visual system, notices)

## Decision

**The page.** A flat page under the view tabs. The library bar shares the tabs' row (search, count, filter, sort, thumbnail size, Import, Slideshow, Details). The sidebar (all, favourites, unfiled, folders, smart folders, tags) is compact: row actions appear on hover. Details sit on the right and can be hidden (`I`, or the Details button).

**The gallery.** Justified rows: every picture at its own proportions, no frames or letterbox bands; the size slider sets the row height. A card carries the picture only; name, size, usage and tags appear on hover, focus and selection; favourites and missing originals have a badge. Meta text no longer uses middle dots.

**The details panel.** First what you do (favourite, Place on canvas), then facts (pixels, type and size, usage), tags, folders, where it is used; the hash, exact type, stored size and date are under "Technical details"; Export and Delete are quiet actions at the bottom.

**The viewer** (your wireframe). The slide view and the inspector are one thing: a large preview (a small original is scaled up crisp, "100%" shows it at its own size), the details beside it, and a bar below with previous and next, "3 of 313", a filmstrip of the library in order, 100%, full screen, favourite, Place, details and hide-the-controls. Both the details and the controls can be hidden (`I`, `B`; a handle brings the controls back) and the choice is remembered on this device. It opens from a double-click or Enter on a card or from Open in the details, and stays open when the Assets view is left (placing an asset sends you to the canvas) and comes back as it was. Esc closes it (or leaves full screen). Video and audio originals play in it.

**Picking several.** A click picks one; Ctrl or Cmd adds or removes; Shift takes a range from the last pick (Ctrl+Shift adds the range); a checkbox on every card adds or removes without a keyboard (it shows on hover, once anything is picked, and always on a touch screen); Ctrl+A picks everything shown; Esc clears. With several picked the details panel becomes a bulk panel: favourite all, Place all (a grid, one undo step), add a tag to all, folders (checked when all are in it, mixed when some are), Slideshow of these, Export as archive, Delete the unused (assets in use are kept and counted).

**Slideshow.** From the library bar (all that is shown, or the picked ones) or the bulk panel, or the viewer's Slideshow button. It steps on after 2, 3, 5 (default), 10 or 20 seconds with a thin bar across the top showing the time left, wraps round, and plays a video or audio file to its end first. Space pauses and resumes, the arrows step and restart the time, Esc stops. It stops when the library is left. In a picked set the viewer and its filmstrip show only those assets.

**Also fixed:** the keyboard stays on the card (or checkbox) it was on when the cards are drawn again after a change.

## Not built

Drag to marquee-select, dragging assets onto the canvas, shuffle, per-slide durations, and a slideshow transition.
