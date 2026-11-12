# ADR 0192: A PDF's page extracted as a picture

- Status: **accepted** (2026-11-13)
- Related: extracted frames (Settings > Saving to the library, `src/app/frames.ts`), the PDF view (`src/ui/pdf-view.ts`), Extract frame on a canvas (`extractFrame`, `src/app/actions.ts`)

## Decision

- **Extract this page** in the PDF view's bar makes the page in sight a picture in the library. A page is one more kind of extracted frame: the same settings name it (`{name}-{position}`, the position `p03`, padded to the digits of the last page so pages sort in order), give its format and quality, file it and tag it (`storeFrame`). One new setting, the page's resolution (`frame.pageDpi`: 150, 300 or 600 dots an inch, 300 at first), with the longer side at most 10 000 pixels.
- Where it goes after is one rule for frames and pages (`keepFrame`): opened from a card on a canvas, placed beside that card (`placePictureBeside`, shared with Extract frame on the canvas, as wide as the card, the picture's shape, one step of undo); in the library's viewer, on the open canvas only when *Place extracted frames on the canvas* is on.
- The page is drawn by the same function as a card's picture (`drawPage`), on white.

## Consequences

- No separate settings for pages: a page and a frame share their name pattern, format, folder and tags. A PDF's page is only a picture: its words are not carried into it.
