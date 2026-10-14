# ADR 0041 — Videos on the canvas and their players

- Status: accepted (Phase 6, slice 1)
- Related: ADR 0007 (assets), ADR 0027 and 0030 (decode budget and reduced copies), engineering plan §14.36

## Decision

- **A video is an image instance.** Video files import like images (content-addressed, stored once, thumbnail, archives, garbage collection by hash). The placed object is an `ImageObject` with `media: { kind, t, repeat }` (`kind` is video, gif or audio; only video is built). Selection, transforms, rotation, grouping, layers, snapping, arrange, copy and paste, hit tests and the density preview therefore work unchanged. A duplicate copies the paused position and starts paused.
- **The picture is a poster.** Its decoded form is the video's frame at the paused time `t`, cached under the key `hash#ms` (`rasterKey` in `doc/model.ts`) in the same decoded cache and budget as images, one decode slot, no reduced copy. The record carries the length (`duration`); a recording without one has it found by seeking past the end.
- **The player** (`ui/media-player.ts`) exists only for the one selected video: a native `<video>` laid over the instance (pointer-transparent, turned with the object, not laid out when absurdly large) and a control bar: step back, play/pause, step forward, scrubber, position and length, repeat, mute. Nothing autoplays; deselecting pauses.
- **Writes are bounded.** Playing writes nothing. Pause, a step while paused, releasing the scrubber, the repeat switch and reaching the end without repeat each write one undo step with the new `t`/`repeat`. Undo moves the player back.
- **Steps** are device settings `media.step.video` (3 s), `media.step.audio` (1 s) and `media.step.gif` (1 frame), validated with defaults; there is no Settings screen for them yet. A step stays in [0, length]; at an end a repeating instance wraps (the overshoot continues from the other end), otherwise it stops there (`doc/media.ts`).

## Not built yet

GIF (frame-index decoder) and audio instances, Extract Frame, volume level and speed, a Settings screen (Media & Playback), a keyboard shortcut for play, decoder budgets for several players (only one plays), persisted poster for lost originals, seeking exactness claims (browser seeks are approximate and the UI does not claim frame accuracy).
