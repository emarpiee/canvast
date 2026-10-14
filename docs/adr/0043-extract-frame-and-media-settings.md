# ADR 0043 — Extract Frame and the Media & Playback settings

- Status: accepted (Phase 6, slice 4)
- Related: ADR 0041, 0042, engineering plan §14.36 and §14.40

## Decision

- **Extract Frame** (button in the player of a video or GIF): the picture shown now is drawn to a canvas at the media's own pixel size and encoded as PNG (lossless; it is the decoded frame as the browser shows it, with no adjustments, and a video seek is only as exact as the browser makes it, so no frame accuracy is claimed). It is imported as a normal original (content-addressed, so extracting the same frame twice stores one copy) and placed as a plain image just right of the instance at its size, selected, as one undo step. The source is never changed.
- **Media & Playback settings:** a gear in the player opens the three step settings (video seconds, audio seconds, GIF frames). Values are validated by the settings definitions; a refused value puts the current one back. Changes apply from the next press and never move a paused position. This is the first piece of a settings screen; the full tabbed screen is still to come.

## Not built

Copy Image and Export Image for a frame (the extracted image can be copied and exported like any image once the library has export), choosing a composited versus original frame (there are no adjustments yet), a settings screen outside the player.
