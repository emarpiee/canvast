# markdown-editor

A Markdown editor for the web with three modes: **live** (the text shown as it reads, its marks only where the cursor is), **source** (the Markdown as written) and **preview** (the page drawn). It is built on CodeMirror 6 and knows nothing of the app it was made in (canvast): the host fills in what it needs (pictures, links, tags, files, saving) through one interface, so it can be added, removed or replaced as one piece.

**Contents:** [What it has](#what-it-has) · [Use it](#use-it) · [The host](#the-host) · [Theming](#theming) · [What it reads](#what-it-reads) · [Limitations](#limitations) · [Files and tests](#files-and-tests)

## What it has

| | |
| --- | --- |
| Live mode | The text reads as a page. Once the editor has been focused, the lines the selection is on show their marks (headings, emphasis, code, quotes, lists, task boxes, pictures' source); links, wiki links and highlights show theirs only under the selection. Elsewhere pictures, embeds, task boxes, dividers, callouts (`> [!note]`) and code cards (language, Copy) are drawn |
| Tables | Drawn as tables in live mode, their cells edited in place (Tab, Shift+Tab, Enter, Escape), a row or a column added by a button; the cursor never lands in the pipes |
| Selection bar | Over selected words: Turn into (text, headings, lists, task list, quote, code block), bold, italic, strikethrough, highlight, code, link |
| Source mode | Every mark shown, the text styled as it reads (heading sizes, emphasis, links, code in the code font) |
| Preview mode | The page drawn (raw HTML cleaned of scripts, frames and event attributes); a click on a link follows it, a click on a task's box ticks it in the text |
| Exact text | What is saved is what was typed: nothing is read into another form and written back. A file's CR LF line ends are kept |
| Toolbar | The modes, the formats (bold, italic, strikethrough, highlight, code, link) and the blocks (headings, lists, tasks, quote, code block, table, divider), the host's Picture, Find and Save |
| Keys | Ctrl+B, Ctrl+I, Ctrl+Shift+X, Ctrl+Shift+H, Ctrl+\`, Ctrl+K, Ctrl+Enter (tick a task), Ctrl+Alt+1–3 and 0 (headings, text), Ctrl+E (preview and back), Ctrl+F, Ctrl+S, Tab and Shift+Tab (indent). ⌘ on a Mac |
| Lists | Enter continues a list, a quote or a task list; Backspace at its mark takes it off |
| Typed over a selection | A sign goes round the words (`*`, `_`, `~`, `` ` ``, `=`, brackets, quotes) and they stay selected, so a second `*` makes them bold |
| Lists as you type | `[[` offers links, `#` tags, `/` at a line's start blocks and the host's own rows (templates) |
| Paste | A page (HTML) becomes Markdown unless its plain text is Markdown already; a web address or `[[link]]` pasted over words makes them the link; files go to the host |
| Code | Fenced code is coloured by the host's tokenizer (`codeSpans`), in every mode; a block that names no language is coloured as a guess, its label saying so (never written into the note) |
| Math and diagrams | `$…$` and `$$…$$` drawn by the host's `renderMath`, ```` ```mermaid ```` blocks by its `renderDiagram`, their source shown where the cursor is |
| Link popover | The pointer resting on a `[[link]]` (or Ctrl+Shift+K) opens its note in a small editor to write in (the host's `linkTarget`), or offers to make it |
| Right-click menu | The link (open, copy), highlights in eight colours, cut, copy, paste, a callout (make, change, remove), select all, undo, redo (also the Menu key, Shift+F10) |
| Folding | Headings, list items with children, callouts (`> [!type]-` starts folded) |
| Vim | Vim keys, as an option (`vim: true`; `@replit/codemirror-vim`) |

## Use it

Copy this folder into your project with its `LICENSE`, and install CodeMirror and Lezer from npm (`@codemirror/state`, `view`, `commands`, `language`, `lang-markdown`, `search`, `autocomplete`, `@lezer/markdown`, `@lezer/highlight`, `@lezer/common`). It imports nothing else.

```ts
import { createMarkdownEditor } from "./markdown-editor";

const editor = createMarkdownEditor({
  parent: document.querySelector("#note")!,
  value: "# Hello\n\nSome **words**.",
  mode: "live",
  onChange: (text) => save(text),
});
// later: editor.value, editor.setMode("preview"), editor.run("bold"), editor.insert("…"), editor.destroy()
```

| Option | Default | Meaning |
| --- | --- | --- |
| `parent` | (needed) | The element it fills |
| `value` | `""` | The text to start with |
| `mode` | `"live"` | `"live"`, `"source"` or `"preview"` |
| `plain` | `false` | Plain text: no modes, no formats |
| `host` | none | What it asks of the page (below) |
| `labels`, `icons` | English, its own | Every word it shows; every toolbar icon (24 × 24 SVG) |
| `toolbar` | `true` | Show the toolbar |
| `wrapSelection` | `true` | Signs typed over a selection go round it |
| `injectStyles` | `true` | Add its stylesheet once; else include `EDITOR_CSS` yourself |
| `onChange`, `onMode` | none | The text changed; the person switched the mode |

Members: `el`, `view` (the CodeMirror view), `value`, `setValue(text, fresh?)`, `mode`, `setMode`, `run(name)`, `insert(markdown)`, `selection()`, `allSelected()`, `find()`, `undo()`, `redo()`, `refresh()`, `focus()`, `destroy()`. Also exported: `renderMarkdown(text, options)` (Markdown to HTML, no DOM needed), `htmlToMarkdown`, `pastedMarkdown`, `cleanHtml`, `COMMANDS`.

## The host

Every member is optional.

| Member | Asked for |
| --- | --- |
| `media(link, embed)` | A picture, video or sound for a link as written: `{ url, type }`, or null |
| `open(link)` | Ctrl+click on a link (`{ link, wiki, media }`), a click in preview mode |
| `links()`, `tags()` | The rows of `[[` and `#` |
| `files(files)` | Files pasted or dropped: the Markdown to write for them |
| `pasting(markdown)` | What is about to be pasted: what to paste instead (a host keeps a pasted note's front matter, say) |
| `choosePicture()` | The toolbar's Picture and `/Picture`: Markdown for a chosen picture |
| `slash()` | More rows of the `/` menu (`{ label, detail?, pick(editor) }`) |
| `codeSpans(text, language)` | Coloured stretches of code: `{ group, start, end }` |
| `save()` | Ctrl+S and Save |
| `rendered(page)` | Preview mode drew its page |

## Theming

Every colour, size and space is a `--me-*` custom property with its default at specificity 0 (`:where(.me)`), light, or dark with `data-me-theme="dark"` (or `"auto"`, the system's) on the editor or round it. Set them on `.me` or round it; code colours are `--me-tok-keyword`, `string`, `comment`, `number`, `function`, `tag`.

## What it reads

CommonMark with GitHub's tables, task lists, strikethrough and bare links, and what notes apps write: `[[Target]]`, `[[Target|shown]]`, `[[Target#Part]]`, embeds `![[file.png]]` (`![[file.png|200]]` a width), `#tags` (not `#1`, not inside a word) and `==highlights==`. One parser (`syntax.ts`) serves the editor and the renderer, so the preview shows what the editor marks.

## Limitations

| | |
| --- | --- |
| Footnotes | Written and kept as text; not drawn as such |
| Callouts in preview | Drawn as quotes |
| Tables | Cells hold inline Markdown on one line; the column alignment is kept, not set from the table |
| Raw HTML | Kept as written; drawn only in preview mode, cleaned |

## Behaviours

How the editor acts as it is used (typing, keys, clicks, pastes) is kept apart from how Markdown is read and drawn: one module per
behaviour in [`behaviors/`](behaviors/README.md), listed with what it does and where it comes from (`BEHAVIORS`). The `behaviors` option
turns any of them off by its id (`{ "auto-pair": false }`).

## Files and tests

`editor.ts` (the editor), `live.ts` (live mode), `commands.ts` (formats and blocks), `behaviors/` (how typing, keys, clicks and pastes act), `syntax.ts` (the parser), `render.ts` (Markdown to HTML), `html-to-markdown.ts` (pastes), `code.ts` (code colours), `style.ts`, `icons.ts`, `index.ts`. `npm run check:markdown-editor` fails when a file imports anything but its own folder, CodeMirror or Lezer. Tests: `tests/unit/markdown-editor.test.ts` (the renderer, typed signs) and, in canvast, `tests/e2e/notes.spec.ts`.
