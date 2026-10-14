# ADR 0045 — Videos this browser cannot decode

- Status: accepted (Phase 6, owner request of 2026-10-15)
- Related: ADR 0041, engineering plan §14.36 (decode failures must not lose state)

## Decision

- **Import anyway.** When the browser cannot decode a video (a codec such as H.265 in Chrome on Linux), an MP4/MOV file is read without decoding (`assets/mp4-probe.ts`: size with the turn of the picture, length and codec from the `moov` boxes) and imported if that works. The original is stored like any other, so another browser, an archive or a system player can use it. Other containers still fail with the message that says why.
- **A card, not a picture.** The instance and its thumbnail show a card of the video's own proportions (`assets/card.ts`): a play mark, the file name, the codec and the size. It is made on demand wherever a picture is asked for and the file will not decode, so archives and other devices need nothing extra.
- **The player says so.** Selecting such an instance shows "Can't play in this browser" with every control disabled except Save original.
- **System player.** A web page cannot start another program. The player has a Save the original file button (a download with the original name); the browser or the file manager then opens it with the system's player. Nothing is claimed beyond that.
- **Paused picture fixes (Firefox).** A picture the player really showed when it paused or sought is kept as the canvas picture and now also redraws tiles that had already drawn a decode of the file; the file decode asks for a presented frame after the seek and runs in the page.

## Not built

Probing WebM/MKV/AVI without decoding, software decoding (ffmpeg.wasm), choosing the card colours.
