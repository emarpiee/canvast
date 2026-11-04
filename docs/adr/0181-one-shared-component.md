# ADR 0181: one shared component per thing, held by an audit

## Decision

Each kind of component has one implementation: `ui/modal.ts` for modal dialogs, `ui/more-menu.ts` for menus, `ui/tree.ts` for trees, `ui/panel.ts` for panels, `ui/notices.ts` for notices. `npm run check:components` fails on markup that makes one elsewhere; places still their own are listed there with why, and the list may only shrink.

Every menu row has an icon, a name and a very short description. `MenuItem` requires `icon` and `hint`, so the compiler holds every row to it, and `tests/e2e/components.spec.ts` opens the real menus.

`ui/tree-chooser.ts` is the dialog for choosing in a hierarchy: tabs, a search, the shared tree or a row of chips, and Apply. Organize uses it for an item's folder and tags. An item is in one folder, so the folder tab chooses one; a tag such as `art/ink` is `ink` under `art`.

## Why

Copies of a menu or dialog drift apart in looks and behaviour, and a fix lands in only one of them. Two menus and eight dialogs had been written by hand this way.

## Known left

The non-modal popovers (`colour-popover`, `library-picker`, `search-help`, `canvas-search`, `command-palette`) each build their own floating box. Place on and the workspace list are choosers with a filter, not action menus.
