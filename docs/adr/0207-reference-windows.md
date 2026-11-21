# ADR 0207: Reference windows: a gallery or a board, floating over every view

- Status: **accepted** (2026-11-21)
- Related: ADR 0011 (the library), 0096 (layers), 0156 (panels), 0205 (every action a command)

## Context

The owner asked for a simple reference window, of two kinds: a gallery (a library folder, or every item) and a simple board that pictures
are dragged onto from the Library, the canvas or another app (a picture from another app is kept in the library), panned and zoomed but
not endless. It floats above everything, in any view (the Library, the canvas, PhotoCraft), and only shows: it changes no picture.

## Decision

- **A window** (`ui/reference-window.ts`) is a panel (`panelHtml`) fixed over the page at `--z-reference` (50): above the views, the edge
  bars and the panels, under menus, popovers and dialogs, so its own list and menus open over it. Moved by its header, resized by its
  corner (CSS `resize`), several at once. Opened by the button beside Settings (every view), `Shift+R` (keymap `reference.open`) or the
  command. The windows open on a device are opened again, where they were (`reference.windows`, a device setting).
- **What it shows** is one list in its header: *Gallery*, all pictures or a library folder (with the folders in it), newest first, its
  pictures loaded as they scroll into sight, one shown large with the arrows; *Boards*, each saved board, and *New board…*.
- **A board** is saved with the workspace (`reference.boards`, a workspace setting: a name and its pictures, each a library file's hash,
  its place and width; at most 100 boards of 1,000 pictures). Pictures come in dropped from the Library (its cards' drag data) or a
  gallery, dragged off the canvas (the canvas's move, let go over a board, puts them there and leaves them in place: `droppedOff`), or from
  another app (dropped or pasted files are imported into the library first). A picture is moved by dragging, resized by its corner, taken
  off with Delete; the board pans by dragging and zooms with the wheel, kept so that some of its pictures stay in sight; a double-click fits
  it. Ctrl+C copies the picture picked (or shown large) as a PNG, never a hidden one.
- **Hidden items** follow the canvas's rule: a hidden picture shows only while the hidden items are shown (hidden mode, open); otherwise a
  board shows a padlock in its place and a gallery leaves it out, and the windows are drawn again when that changes.
- **Commands**: `reference.open`, `reference.newBoard`, `reference.renameBoard`, `reference.deleteBoard` (confirm), `reference.add`,
  `reference.place`, `reference.remove`, `reference.fit`. Which source a window shows and its size and place are view state.
- **Controls, as the canvas's** (on a board): the wheel zooms (Ctrl: a touchpad's pinch), Shift+wheel pans, the middle button or Space
  with a drag pans, a drag on the empty board selects with a box, Shift or Ctrl adds; `+` `-` zoom, `0` or Home fits, the arrows move
  the selected pictures (or the view), Delete, Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D, Ctrl+Z and Ctrl+Shift+Z (the board's own history),
  Escape. A press takes the focus into the window, and its keys, pastes and copies stop there: they never reach the canvas or the Library.
- **What it shows** is chosen from a list drawn inside the window (boards, all pictures, the folders as a tree, a search), not a dropdown
  over the page.
- **Speed**: the window is opaque, without the panels' backdrop blur (over a canvas drawn every frame it was drawn again every frame); a
  board's pictures are moved in place, not built again at each change; the library is read once and again only when it changes; a gallery
  builds 200 pictures at a time; the windows' places are kept once they rest.

- **"Moodboard", not "board"** on screen (a board is the workspace's own level); the code and the stored setting keep `board`.
- **A moodboard's pictures**: shown flipped, turned a quarter at a time, grey or see-through (`reference.look`; Shift+H, Shift+V; the
  file is never changed), resized from any corner, brought forward or back (`reference.order`), arranged in a grid (`reference.arrange`),
  placed on the canvas (dragged out of the window onto it, or *Place on the canvas*), all from a right-click menu as on the canvas. Its
  undo history is kept on the device over a reload.
- **Managing moodboards**: each in the chooser has its own ⋯ (open in a new window, rename, duplicate, arrange, fit, save as a picture,
  delete), the same rows as the window's More menu; *Manage moodboards…* lists them all in the shared list dialog.
- **The window**: folded to its title (a double-click on it), see-through, letting clicks through (its title keeps them); the gallery
  sorted (newest, oldest, A to Z, Z to A), its pictures small, medium or large, a slideshow; a picture shown large is fitted in the
  window (no scrollbar, never a window that grows), zoomed and panned, its bar always at the bottom, dragged out by its name.
- **Floating over other apps** (the desktop app, `reference.float`): a snapshot of the window's pictures in a sandboxed window kept on top
  of every app, panned and zoomed; view only.

## Consequences

- A board holds library files only: a picture from outside is in the library once it is on a board.
- Its pictures are thumbnails while small, the file itself once wider than 600 pixels on screen.
- A floated window is a snapshot: it does not follow later changes to the moodboard.
