# ADR 0180 — Watermarks: visible on a picture, invisible in a picture or a text

- Status: **accepted** (2026-11-01; the owner asked for both kinds, free placement, editable or permanent, and reading back in the app)

## Context

The owner wanted to mark pictures as theirs: a visible text or logo placed freely (not in fixed corners), with transparency; and an invisible mark in pictures and texts that the app can hide and read back.

## Decision

**Visible** (`src/doc/watermark.ts`):

- Kept on the picture (`ImageObject.watermark`), not as a separate object: it is always cut to the picture and moves, turns, copies and is deleted with it. A separate attached object would be picked with the picture and break the tools that need one picture alone (Crop).
- Place, size and turn are fractions of the picture's box, so a resize keeps it in place.
- A text is set in the bundled font. A picture watermark is kept as a PNG data URL of at most 512 px. A library file would be a second file one object uses, and the store's usage index counts one file per object, so the clean-up of unused files could erase it.
- It is drawn by a stand-in text or picture object that `scene-view.ts` puts right after the picture in the drawn list, carrying the picture's id and cut to its box. The text and picture renderers draw it (turned, at depth). The stand-ins are kept out of picking, outlines, names and Reveal.
- **Place on the picture** is a mode like Crop (`editor.watermarkId`) with its own handles: drag inside to move, a corner sizes it, the round handle turns it (`render/watermark-frame.ts`).
- **Make permanent**, Make a new picture, Copy as picture and Download draw an upright copy of the picture alone through the export renderer (`app/watermark-bake.ts`). Make permanent stores the result as a new library file shown in place of the picture; the original file is kept.

**Invisible in a picture** (`src/doc/invisible-mark.ts`, `src/doc/reed-solomon.ts`):

- One bit per 8 × 8 block of brightness: which of DCT coefficients (1,2) and (2,1) is larger, by at least a margin (Light 8, Normal 14, Strong 24). JPEG rounding, resizing and contrast scale both alike, so the comparison survives them.
- Lattice QIM was tried first. It read cleanly but failed after an 80% resize and back, because it breaks when the coefficients shrink.
- A frame holds a check word, the payload encrypted with AES-CTR (key from PBKDF2 of the password, or of an empty one), a CRC-32 and 16 Reed–Solomon bytes. Texts take frames of 16, 32 or 64 bytes, so a short text has a small tile and many copies; a logo is 32 × 32 bits.
- The frame's bits fill a tile of blocks repeated across the picture, or across the part chosen. Every copy votes.
- Reading looks for the 8-pixel grid where blocks a tile apart vote alike, tries every tile start (Reed–Solomon, then the CRC, accepts one), then decrypts. A frame found but not opened means "it needs its password".
- The app tries 9 scales and 4 quarter turns.
- The result is a new library picture beside the original (the owner's choice).

**Invisible in a text** (`src/doc/text-mark.ts`): the same encrypted payload, as zero-width characters (U+200B, U+200C, U+200D and U+2060, two bits each) after a sync run, spread after the spaces.

## Consequences

- Measured, a 640 × 480 picture at Normal is read after an 80% or 50% resize and back. It is also read after a JPEG save at 75% combined with an 80% resize and a 13 px crop (E2E). A 320 × 240 picture needs Strong for that.
- Not survived: free rotation, heavy downscaling with recompression, screenshots of a scaled view, deliberate removal. A text mark is lost to apps that strip zero-width characters.
- The no-password key is the same in every copy of the app, so such a mark proves nothing on its own.
