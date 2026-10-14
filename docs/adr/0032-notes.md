# ADR 0032 — Notes: Markdown cards edited in a panel

- Status: accepted (owner decision of 2026-10-14, after trying Markdown paste in the Text tool)
- Related: ADR 0013 (text objects), ADR 0021 (hide and lock), engineering plan Phase 5 (Markdown-backed editor, tags)

## Context

Pasting Markdown into the Text tool tried to make one editor do two jobs. The Text tool is a Figma-like canvas label (own editor, plain-text paste, a small Markdown subset). The owner also wants longer, structured notes (headings, lists, tables, code, links, `#tags`) that live on the canvas.

## Decision

**A note is a text object with `note: true`.** It moves, turns, groups, layers, snaps, hides, locks and exports like any text, and has the same exact-coordinate frames. Its Markdown is kept as written (no canonicalisation through the text subset; a text still is). On the canvas it is drawn as a card (neutral translucent fill and outline) behind the same text rendering; syntax the text renderer does not know (tables, for instance) shows as literal characters in the card.

**Edited in place with SunEditor** (MIT, v3.3.3, pinned). The Note tool (key N) opens an editor over the card at a click (the camera first zooms to a readable size, as for a text); double-click opens an existing note, and the card is hidden while its editor is over it. Done, Ctrl+Enter and Esc save; Cancel discards; an emptied note is deleted (one undo step), like a text. The toolbar is SunEditor's balloon toolbar (it appears over a selection). Plugins: headings and paragraph styles, bold, italic, strike, lists, quote, code block, rule, table, link. No images, fonts, colours or alignment: none of them exist in Markdown. Markdown goes in with `markdownToHtml` and comes out through `htmlToJson` and `jsonToMarkdown` (a trailing empty `> ` line the converter leaves after a quote is removed).

**Shipped inside the single file, run on demand.** The editor code (about 650 KiB) and its CSS (about 125 KiB) are two inert `<script type="text/plain">` blocks; the first time a note opens they are turned into a script and a style element (allowed by the existing CSP: `script-src 'unsafe-inline'`). Opening the canvas costs nothing extra beyond downloading the file, which grew from 733 KiB to 1556 KiB. `scripts/sun-entry.js` is the entry (it imports the package's `src` by relative path because its `exports` hides subpaths); the package is a dev dependency, bundled by `scripts/build.mjs`, with its licence in the file's notices.

## Not built yet

- **Tags:** `#tag` is plain text in the Markdown. Searching and listing by tag arrive with the Markdown-backed editor and search in Phase 5.
- **Pasted HTML sanitising:** SunEditor is given Markdown only and its output is read back as Markdown, so HTML never reaches the document; pasting rich text into the panel is flattened by that conversion. Not separately tested.
- A note's card does not show formatted tables or code blocks; open the note to see them.
