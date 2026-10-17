# Vector tools: UX audit (2026-10-17)

The vector tools work; the owner's report is that they are *confusing*: where things are, what to do next, where to find something. This is an audit of the state at v0.17.0 from a designer's point of view (what a person who comes back after a week sees), what was changed in the first pass (ADR 0104) and what is still open.

## How the vector tools are laid out

| Where | What is there |
|---|---|
| Tool rail (left) | Hand, Select, **Edit nodes**, Pen, **Shape**, **Path**, Lasso, Text, Eraser (nine tools, three of them make or edit vectors) |
| Tool options (top, changes with the tool) | Shape kind and sides; **Fill** and **Outline** chips; outline width slider (Shape and Path only); pen-size slider (also on Select) |
| Selection bar (under the selection) | Duplicate, Group, Tag, … **Combine** (menu), **Convert text to path**, Arrange, order, lock, hide, delete |
| Keyboard | U, B, N, V; Enter/Esc/double-click to finish a path; Ctrl+E flatten; Alt-click a node |
| Layers panel | Boolean groups with the operation's icon; members shown inside |

## Findings

| # | Finding | Why it confuses | Status |
|---|---|---|---|
| 1 | **No hint of what to do.** Nothing says "drag", "click to place a corner", "Enter finishes", "double-click enters a boolean group". The rules lived in Settings > Shortcuts only. | A tool you have not used for a week looks like a blank bar. | ✅ fixed: a hint line under the tool options, per tool and state (`ui/tool-hint.ts`) |
| 2 | **Fill and Outline were two unlabelled dots.** | You could not tell which dot was which without hovering. | ✅ the chips are labelled |
| 3 | **Outline had only a width, and the width slider was missing on Select.** The only slider shown with a shape selected was "Pen size", which secretly set the shape's width. Corners (join) and ends (cap) existed in the data and had no control at all. | You cannot find a setting that is not there; a slider named for the pen changes a shape. | ✅ **Outline options** next to the chips: width, position (inside, centre, outside), corners, ends; on Select the pen-size slider is hidden unless a stroke is picked |
| 4 | **Stroke position** (inside, centre, outside) did not exist. | Cannot make a border that stays inside a box, or a keyline around a shape without eating it. | ✅ done (ADR 0104): drawn, picked and bounded; open lines are always centred |
| 5 | **Editing nodes is a separate tool and only a double-click or N gets there.** | Two modes you can be stuck in without a sign; no way to see how to get out. | ✅ Enter on a picked shape edits its nodes, Enter or Esc leaves; the hint says so |
| 6 | **Boolean groups look like ordinary shapes** and the way in (double-click) is invisible. | After combining, "where did my shapes go?" | ✅ hint says "Boolean group · double-click to edit the shapes inside · Combine changes the operation, flattens or releases"; and "Inside a boolean group … Esc goes back out" when entered |
| 7 | **Three buttons for turning one thing into another** live in different places: Combine (menu with Flatten and Release hidden in it), Convert text to path, Ctrl+E for two different things. | Flatten is hard to find; Ctrl+E means one thing for text and another for groups. | 🔜 open: a single "Object" menu or a Flatten button shown on a boolean group |
| 8 | **Shape and Path are separate tools, and the rail has Pen next to them.** Three ways of drawing, with icons that read alike at 20 px (pencil, pentagon, spline-pointer). | Which one makes a thing I can edit later? | 🔜 open: group Shape and Path under one "Vector" tool with a flyout, and say in the Pen tooltip that it draws strokes, not shapes |
| 9 | **Defaults for the next shape are invisible state.** Fill, outline, width and now corners and position stay from the last use, and are shown only in the options bar. | A new shape comes out in last week's colour. | ⚠️ partly: the bar shows them, the popover shows the rest; join, ends and position are not remembered across reloads yet |
| 10 | **Rounded rectangles, dashes, node snapping, alignment of nodes** are not there. | These are the next things a person looks for. | 🔜 later (plan-gaps) |

## What changed in the first pass

- A hint line under the tool options (Shape, Path, Edit nodes, Select with a shape or boolean group picked or entered).
- Fill and Outline are named; **Outline options** (width, position, corners, ends) for the picked shapes or for the next one.
- Stroke position inside, centre or outside: the whole width on the chosen side of the edge.
- Enter edits the nodes of a picked shape and finishes node editing.
- The pen-size slider is not shown on Select when only shapes (or pictures, text) are picked.

## Limits and what to look at next

- An outline wider than 2^14 px at the view (the exact-coverage stand-in) is drawn centred whatever its position; hit-testing there is exact for the centred line only.
- Inside and outside are drawn as a centred line twice as wide, kept where the shape is (or is not), through a scratch canvas the size of the view; many aligned outlines on screen at once cost a view-sized blit each. If that ever shows in the frame time, limit the blit to the object's box.
- Open items 7 and 8 are the next UX slice; 9 is a settings entry for remembering join, ends and position.
