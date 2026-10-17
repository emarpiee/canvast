# ADR 0125 — Mentions removed; names above items

- Status: accepted (v0.18.0)
- Supersedes: ADR 0039 (mentions), ADR 0040 (backlinks), the relink part of ADR 0047
- Related: ADR 0108 (sheet names), ADR 0078 (any file is a card), ADR 0013 (text)

## Decision

- **Mentions are removed completely**, so the text tool starts clean and a separate note item can take them later. Gone: the `@` picker, the mention span, `[[item:id|label]]` in Markdown, the Layers panel's "Mentions" and "Mentioned in" lists and relink, the board-wide lookups, and the `refs` and `kind` indexes of the `objects` store. The database upgrade to v9 deletes both indexes and the derived `refs` field of stored texts. A text that held a mention now reads `[[item:id|label]]` as plain words.
- **Names above items are one list** (`src/render/item-label.ts`, formerly the sheet labels). The same list is drawn and picked. Sheets, pictures, videos, sounds and file cards (a picture by its file name, from the catalog) always carry one; any other item shows its layer name while it is picked (always showing them would crowd the canvas). An item inside a sheet shows it only while picked, as sheets always did. The file name comes from `AssetNames` (`src/app/asset-names.ts`), the one cache the Layers panel and the labels share.
- Every kind of file is already an item on the canvas (ADR 0078: a card with its extension chip); this only makes it named.

## Not done

A setting to hide the names; names for unnamed strokes, shapes and texts.
