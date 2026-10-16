# ADR 0067: one HTML file; developer tools are a setting

Status: accepted (owner request, 2026-10-17)

`dist/canvast-debug.html` (unminified, inline source maps, `__CANVAST_DEBUG__` true) is gone: the build makes `dist/canvast.html` only, and `npm run build:debug` is removed. The developer tools (the dev panel with jump and auto-zoom buttons, the diagnostics under the frame-rate readout, the `window.__canvastDebug` test hook, adaptive quality pinned) are switched on by **Settings > Develop > Developer tools** (device setting `dev.tools`, applies after a reload, with a Reload now button) or, for one session, by `#debug` at the end of the address (what the tests use). The code was already in the production bundle; only its start-up gate changed.
