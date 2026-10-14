# ADR 0042 — Animated GIFs: frame-index decoder and player

- Status: accepted (Phase 6, slice 3)
- Related: ADR 0041 (media instances), engineering plan §14.36

## Decision

- **Own decoder** (`assets/gif.ts`): `<img>` cannot step or seek by frame and Firefox has no `ImageDecoder`, so the file is indexed once (size, delay, disposal, transparency, palette, data offset per frame) and a frame is LZW-decoded and composed on demand, honouring transparency, interlacing and disposal 0–3. Stepping forward costs one frame; going back recomposes from the start. A delay of 0 or 1/100 s is shown for 0.1 s, as browsers do. It is pure (bytes to RGBA) and unit-tested with a fixture encoder written in code (`tests/e2e/gif.ts`), including real LZW with growing code sizes; the encoder itself is checked against each browser's own GIF decoder in the E2E test.
- **Instances:** a GIF with more than one frame imports with `frames` and `duration` and is placed as an image instance with `media { kind: "gif", t: frame index, repeat }`; a still GIF stays a plain image (so do GIFs imported before this slice: re-importing the same bytes does not change an existing record). The paused picture is the frame at `t`, cached under `hash#frame`.
- **Player:** the same bar as video, with the position shown as `Frame n / N`, no mute, and steps from `media.step.gif` (1 frame). Playing paints frames into a canvas laid over the instance, each held for its delay; repeat wraps, otherwise it stops on the last frame. Writes happen as for video: on pause, step, seek, repeat and the end.

## Not built

Frame-accurate speed controls, a frame cache for random access in large GIFs (going back is O(frame)), Extract Frame, animated WebP and APNG.
