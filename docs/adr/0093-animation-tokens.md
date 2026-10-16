# ADR 0093: Animation tokens and the Animation setting

## Status
Accepted (v0.17.0)

## Decision
Every duration and curve is a token in `:root` (`--dur-fast` 120 ms, `--dur-base` 200 ms, `--dur-slow` 320 ms, `--ease-out`, `--ease-in-out`), each duration multiplied by `--anim-speed`; sideways and vertical movement is multiplied by `--anim-move`. Rules use the tokens, never a literal time. Settings > Performance > Animation chooses System (follow the operating system's reduce-motion setting, as before), Full, Subtle (fades only, durations 0.6x) or None (every duration 0, the old "Reduce"); Animation speed (Slow 1.6x, Normal, Fast 0.6x) scales them. The old Motion row moved from Appearance to here under the new name; saved values keep working ("reduce" is None).
New: menus, popovers, panels, the bars and dialogs come in with a short fade and rise (`pop-in`, using `translate` so it never fights an element's own transform); the Assets, Settings and viewer views and each settings tab fade in; buttons, fields and tabs change colour, border and shadow smoothly; the Zen fade, the notice, the filmstrip and the chip use the tokens.
