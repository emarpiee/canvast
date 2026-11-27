# ADR 0209: canvast's own Markdown editor, a package; SunEditor and rich text notes removed

- Status: **accepted** (2026-11-28)
- Related: ADR 0098 (the colour picker, the same shape of package), 0156 (panels), 0198 (floating bars), 0205 (every action a command)

## Context

Notes were written in SunEditor, a rich text editor: a note's Markdown was read into HTML, edited as HTML and written back as Markdown,
with a hidden second editor to tell whether anything was lost, a third form for "rich text notes" (`.note.html`) when it was, and a long
list of fixes for what the round trip changed (spellings, escapes, picture addresses, tables). The owner asked for an editor of the app's
own that it can change as it likes, made as a package like the colour picker: easy to add, remove or replace.

## Decision

- **A package, `src/markdown-editor/`**, that imports only its own files and CodeMirror 6 and Lezer (bundled; MIT): `npm run
  check:markdown-editor` fails otherwise. It has its own README, licence (MIT), labels, icons and `--me-*` theme tokens; the app maps
  the tokens to its own (`.me` in `src/styles.css`) and passes its icons.
- **The text is the note.** The editor holds the Markdown as written and the file gets exactly that back: no conversion, no "keeps all"
  check, no question about formatting on save. A file's CR LF line ends are kept.
- **Three modes**: live (marks hidden away from the cursor, pictures, task boxes, dividers and tables drawn in place; marks show only
  while the editor has the focus, so a note opens as it reads), source (every mark, the code font) and preview (the page, its links
  followed and its tasks ticked by a click). Settings > Notes > *Notes open in* is the default; each note's toolbar switches (Ctrl+E:
  preview and back).
- **One parser** (`syntax.ts`: CommonMark, GitHub's extras, `[[links]]`, embeds, `#tags`, `==highlights==`) for the editor and the
  renderer (`render.ts`, Markdown to HTML without a DOM), which also draws note cards and previews.
- **The host interface** (`EditorHost`) is all the editor knows of the app: pictures, links, tags, files, pasting, the picture chooser,
  the `/` menu's extra rows, code colours, saving. `src/ui/note-editor.ts` fills it from the library; `NoteEditor`/`NoteHost` stay the
  seam with `note-session.ts`, so swapping the editor touches that one file.
- **SunEditor is removed**, and with it **rich text notes**: a `.note.html` file is a page of the library, not a note (it keeps its name
  and folder; a rename keeps `.note.html` whole, as before). Settings removed: the editor styles (library and canvas), Markdown
  shortcuts (typed marks are the text now) and "when a note's formatting does not fit its file".
- The editor's toolbar, buttons and lists are the package's own (it cannot use the app's components); they take the app's look through
  the tokens. Its buttons write the note (`// typing:`), the mode buttons only change what is shown.

## Consequences

- Saving is what was typed; the old canonical-markdown code (`readableMarkdown`, `obsidianMarkdown`, `keepSpelling`, `wikiToLinks`,
  `linksToWiki`, `note-markdown.ts`) is gone, and a note's links stay as written instead of temporary addresses.
- No fonts, colours, sizes or alignment in notes (Markdown has none); raw HTML in a note is kept and drawn, cleaned, in preview mode.
- The single file is smaller (about 460 KB) with CodeMirror than with SunEditor.
- README text and pictures for the new editor wait for the owner's go.
