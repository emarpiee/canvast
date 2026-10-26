# ADR 0174 — One context menu for every view

- Status: accepted (v0.45.0)

A right click, the menu key and a long press on a touch screen are one thing, `bindContextMenu` (`src/ui/context-menu.ts`): a view brings only its items, as groups (`grouped` puts a line between them), and the module opens them at the point with the shared menu (`openMoreMenu`, `sep` on an item starts a group). A field keeps the browser's own menu.

| View | Items |
| --- | --- |
| Canvas | the registry's commands that apply (`canvasItems`): on a thing the Edit, Group, Arrange, Export and Delete groups, on empty ground Paste, Select everything, Show or Unlock all, Fit and Return. A long touch already lists what is under the finger (ADR 0151, the tools own it), so `canvasItems` follows that list. |
| Library | on an item the details panel's own buttons, read and pressed (so the menu and the panel cannot disagree), with Copy and Paste; on empty ground Select everything, Paste, Import files or a folder, New folder, Slideshow, Details panel. |
| Settings | on a row the row's reset buttons (setting reset, shortcut change, add, reset). |
| Viewer | none. |

**Copy** puts the picture alone, as PNG (the one type every program takes), on the system clipboard: with a name beside it many programs paste the text instead of the picture. **Copy file name** puts the name as text; what is not a picture is copied as its name. **Paste** reads the clipboard's picture and names it from the text beside it when that is a file name (the first line, up to 120 characters, cleaned), else `image`, with the extension of its type. Where the browser will not let the page read the clipboard, the notice says to press Ctrl+V.

**One clipboard writer** (`src/app/system-clipboard.ts`, `writeSystemClipboard`): the library's Copy, a copy on the canvas, a screenshot and the Export dialog's Copy all put a picture alone (PNG) on the system clipboard and fall back to text only when the picture cannot be written. A canvas copy of shapes used to carry its SVG text beside the picture, and a program that takes text pasted the SVG and not the picture; the SVG text is now the command *Copy the selection as SVG* (also in the canvas menu). Copied texts still carry their words with the picture.
