# ADR 0072: W A S D step between items

## Status
Accepted (v0.17.0). Replaces the Ctrl+Arrow key of ADR 0058; the way items are picked is unchanged.

## Decision
- Stepping the selection to the next item up, left, down or right uses plain **W, A, S, D** (the arrow keys keep panning). The four keys are device settings (`key.navUp`, `key.navLeft`, `key.navDown`, `key.navRight`), changed in Settings > Shortcuts under "Step to the next item", with Reset, like the tool keys.
- One conflict check covers tools and steps together (`keyOwner`): a letter already used is refused with the name of what uses it.
- Ctrl+Arrow no longer steps. Shortcuts are ignored while typing, as for the tool keys.
- Settings > Navigation still sets how the next item is chosen (nearest in view, anywhere, by layer) and what the view does on arriving.

## Consequences
A tool key set to W, A, S or D earlier (by hand, before this change) loses to the step key until it is changed.
