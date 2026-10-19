# ADR 0050 — Accessibility checks and appearance options

- Status: accepted (Phase 7, slice 3)
- Related: ADR 0048 (Settings view)

## Decision

- **An automated audit** (`tests/e2e/a11y.spec.ts`) walks every view (Canvas with the Layers and Bookmarks panels open and an object drawn, Assets, each Settings tab) and fails on any visible control without an accessible name, and checks the page language, a main landmark and a live region. A second test checks that every control reached by Tab shows a focus outline and that Escape leaves the Settings view.
- **Reading and tab order follow the screen:** the header with the view tabs and workspace menu comes before the canvas in the markup (it is at the top of the page).
- **Tools never sit under the view tabs:** the toolbar starts where the header ends (`--nav-w`, measured with a ResizeObserver in `main.ts`) and is centred in what is left. Before, at a 1280 px wide window the Hand tool was hidden behind the workspace menu.
- **Appearance settings** (device scope, Settings > Appearance): **Motion** system, reduce or full (`prefers-reduced-motion` is honoured when the setting is System). Defaults leave no attribute on the root. *Interface size* (CSS `zoom`, 90 to 150 %) and *Contrast* (normal or high) were removed at the owner's request (2026-10-20); the colour-contrast audit in `a11y.spec.ts` still holds the default themes to 4.5:1.

## Not built

Screen-reader testing with a real reader (only the accessible names, roles and focus are checked automatically), a colour-contrast audit by computed ratios, keyboard-only operation of drawing, selection and the text editor on the canvas, and scaling of the media bar and text format bar.
