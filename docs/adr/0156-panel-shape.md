# ADR 0156: one shape for every panel

Status: accepted (owner request, 2026-10-19)

Every floating panel (Layers, Bookmarks, Tags, Styles, Adjust) is built with `panelHtml` (`src/ui/panel.ts`) from the parts it has:

| Part | Class | Stays put while the body scrolls | Optional |
| --- | --- | --- | --- |
| Header: title, count, tools, and the button that hides the panel | `.panel-head` | yes | yes (a panel can be all content) |
| Strip under the header: a filter, tabs, a layer row | `.panel-sub` | yes | yes |
| Body | `.panel-body` | no, it scrolls | no |
| Footer: actions, the save row | `.panel-foot` | yes | yes |

A new panel passes its parts to `panelHtml` and adds no layout CSS of its own for them. A panel that has no header, strip or footer leaves it out; nothing is forced. The Adjust panel keeps its layer row in the strip and its save row in the footer, so the sliders scroll between them (`subHost` and `footHost` of `buildAdjustPanel`).
