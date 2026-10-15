# ADR 0046 — Taking a video's picture, and the paused frame

- Status: accepted (Phase 6, owner testing of 2026-10-15)
- Related: ADR 0041, ADR 0045

## Decision

- **Paused frame (fixed).** Firefox presents no new picture after a seek for a `display:none` element, so reselecting a paused video opened on a stale frame. A player now loads in the page, transparent, and shows once the sought picture is presented. While playing, `currentTime` is the sound's clock and the frame on screen is later than it; a pause seeks to that time so the frame on screen is the one a later seek (reselect, reload) shows. Confirmed in Firefox on desktop by the owner.
- **Flat pictures.** A picture of a video is checked (`isFlat`, `video.ts`). If it is flat at the asked time and at three others, the browser draws nothing for that element (Firefox on Android). A different flat colour at another time counts as a live picture (solid-colour videos).
- **Other ways to take a picture,** tried in order, the first that is not flat: drawing the element, `createImageBitmap(video)`, `VideoFrame(video)`, then for MP4/MOV a frame decoded from the file with WebCodecs (`assets/mp4-frames.ts`: its own demuxer for H.264 and H.265 sample entries, edit list, B-frame order, track rotation). Import, the picture of a paused time, the paused poster and Extract Frame all use this chain (`pictureNow`).
- **Never a blank.** Once the element is known to draw nothing, a flat element picture is never stored as a poster. The instance keeps its card, and the card says why in a wrapped line (for example `no WebCodecs` or `WebCodecs cannot decode hvc1…`).

## Known limitation (open)

Firefox on Android, with the owner's phone videos (H.265): playback in the page works, but drawing the element into a canvas gives nothing and WebCodecs does not decode the file there. The instances show the card and Extract Frame gives nothing; playing from the player still works. Firefox on desktop (H.264 and H.265) and Chrome on Android are not affected. Not reproducible here (no device). Ideas for later: show the paused picture as a page overlay for such items (the player's own element, as `kambas-web` does), or a software decoder in a worker.

## Not built

A software decoder, a page overlay for every media instance, WebCodecs for WebM.
