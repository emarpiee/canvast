# ADR 0109: Attach and Detach

## Status
Accepted (v0.17.0).

## Decision
`attachmentTargetId` (in the model since the start, always null) now names the object an object follows. **Attach** (the link button on the options bar of Select): pick objects, press it, click the object to follow; Esc cancels. The target and anything that already follows it (a loop) are left out. **Detach** (the broken-link button, shown when a picked object is attached) lets go: nothing moves.

Following is selection, not a transform: picking the target picks everything attached to it, at any depth (`descendantsOf` in `doc/containers.ts` walks sheet parents and attachments alike), so a move, turn, stretch, copy, duplicate or delete of the target carries them. Picking an attached object alone moves it alone. Copies follow the copied target (`clipboard.ts`); a target that is gone counts as none.

## Not done
A mark on the canvas or in Layers showing what follows what; attaching across canvases.

## Tests
`tests/e2e/sheets.spec.ts` (Attach: follow, pick the target picks followers, Detach), both browsers.
