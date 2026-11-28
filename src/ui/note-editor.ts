import { ICONS } from "./icons";
import { commands } from "../commands/registry";
import { showContextMenu } from "./context-menu";
import type { MenuItem } from "./more-menu";
import type { PopItem } from "../markdown-editor";
import { createMarkdownEditor, type EditorMode, type FollowedLink, type MarkdownEditor, type SlashItem } from "../markdown-editor";
import { CODE_LANGUAGES, codeSpans, dropCode, paintCode } from "../notes/code-colours";
import { renderMath } from "../notes/math";
import { noteKindOf } from "../notes/note-file";
import { WIKI, encodeLinkPart, libraryLink, linkTarget } from "../notes/note-file";
import type { NoteKind, PathTarget } from "../notes/note-file";
import { splitFrontmatter, type Prop } from "../notes/frontmatter";

// A note open in canvast's Markdown editor (src/markdown-editor/): this file fills in what the editor asks of its page from the library
// (pictures, links, tags, files, templates, saving). The note's text is what the editor holds, so what is saved is what was typed.

/** What a note's attachments can be: what the library chooser lists. */
export type AttachKind = "image" | "video" | "audio" | "file";

/** A library item as a note shows it. */
export interface NoteItem {
  hash: string;
  name: string;
  type: string;
}

/** What the notes editor needs from the library. */
export interface NoteHost {
  /** The whole note as a markdown file, properties and these words; null when it has none to carry. */
  whole(words: string, pasted: readonly Prop[]): string | null;
  /** Read the library's list again: what the note's links point at may have arrived since it opened. */
  reread(): Promise<void>;
  /** Read again what `whole` needs: the file and the item's properties. */
  refreshWhole(): Promise<void>;
  /** The folder of the note in the library (its links are relative to it). */
  dir: string[];
  /** The item a link in the note names (by its path in the library, or its hash), or null. */
  find(target: { hash: string } | PathTarget): Promise<NoteItem | null>;
  /** The item's file, to show it in the note. */
  blob(hash: string): Promise<Blob | null>;
  /** Where the item is in the library (its folders and file name), for a link to it. */
  pathOf(hash: string): Promise<string[]>;
  /** The library chooser, for this kind of item (it can import files too). */
  choose(kind: AttachKind | "any"): Promise<NoteItem | null>;
  /** Files dropped or pasted into the note: put in the library first. */
  importFiles(files: File[]): Promise<NoteItem[]>;
  /** What `[[` offers: the library's notes and files, by the name a link names them with (`key`), and the name shown (`name`). */
  linkables(): Promise<Array<{ key: string; name: string; hash: string }>>;
  /** The library's tags, for `#` (a tag written in a note is one of its item's tags). */
  tags(): Promise<string[]>;
  /** The item a `[[target]]` link names, or null. */
  findWiki(target: string): Promise<NoteItem | null>;
  /** Ctrl+click on a link in the note: open what it points at (a note, a file of the library). `link`: a path as written, or `canvast-wiki:` and the target. */
  open(link: string): void;
  /** A small picture of what a link points at (its library preview), for a look while the pointer rests on it. */
  peek(link: string): Promise<Blob | null>;
  /** The notes of the library tagged `template`: offered in the `/` menu after the built-in ones. */
  templates(): Promise<Array<{ name: string; kind: NoteKind; text: string; dir: string[] }>>;
  /** The editor's Save button (and Ctrl+S): whether it was saved. */
  save(): Promise<boolean>;
  /** Another note's words (without its properties) written as its new version: its new hash (the link popover's edits). */
  saveOther(hash: string, words: string): Promise<string | null>;
  /** A new note of this name in the library: its item, or null. */
  createNote(name: string): Promise<NoteItem | null>;
  /** A new note, named as Settings say, opened. */
  newNote(): void;
  /** Vim keys in notes (Settings). */
  vim: boolean;
  /** Play a video of the note (in `box`, under it) with the app's own player. */
  player?(video: HTMLVideoElement, box: HTMLElement, url: string): void;
}

export interface NoteEditor {
  /** Properties pasted into the note and not saved yet. */
  pastedProps(): readonly Prop[];
  /** Edited since it was opened or last saved. */
  readonly dirty: boolean;
  /** The note's words as its file keeps them (a markdown note's without its properties). */
  text(): string;
  /** Go to the first place `text` is written in the note (a footnote from the details' outline). */
  reveal(text: string): boolean;
  /** The editor's content now (given to `saved`, for what was saved). */
  current(): string;
  /** The note was saved (`as` this content, else as it is now): what was typed since stays a change. */
  saved(as?: string): void;
  /** Show the pictures that could not be found when the note opened, if they have arrived. Changes nothing in the note. */
  retryPictures(): Promise<void>;
  destroy(): void;
}

/** Templates every note has (the `/` menu); the library's notes tagged `template` come after them. */
const TEMPLATES = [
  { name: "Meeting notes", text: "## Meeting notes\n\n**Date:** {{date}}\n**Attendees:** \n\n### Notes\n\n- \n\n### Action items\n\n- [ ] \n" },
  { name: "To-do list", text: "## To do\n\n- [ ] \n- [ ] \n- [ ] \n" },
  { name: "Journal entry", text: "## Journal {{date}}\n\n*Written at {{time}}*\n\n### What happened\n\n\n\n### What I learned\n\n" },
  { name: "Reference sheet", text: "## Reference\n\n**Subject:** \n**Source:** \n\n### Observations\n\n- \n" },
];
/** A template's `{{date}}` (2026-11-03), `{{time}}` (14:05) and `{{title}}` (the note's name) filled in. */
function fillTemplate(text: string, title: string): string {
  const now = new Date();
  const two = (n: number): string => String(n).padStart(2, "0");
  return text.replace(/\{\{\s*(date|time|title)\s*\}\}/gi, (_m, k: string) =>
    k.toLowerCase() === "date" ? `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}` : k.toLowerCase() === "time" ? `${two(now.getHours())}:${two(now.getMinutes())}` : title,
  );
}

/** Diagrams in notes (```mermaid), drawn by Mermaid, loaded the first time one is shown; light or dark with the app. */
let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
let diagramCount = 0;
async function renderDiagram(code: string): Promise<string> {
  mermaidReady ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidReady;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.dataset["theme"] === "dark" || matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
  const { svg } = await mermaid.render(`me-diagram-${++diagramCount}`, code);
  return svg;
}

/**
 * The notes editor's lists of choices (its right-click menu, a table's actions, a code block's language, a callout's type) in the app's one
 * menu: each row has an icon and a short line, and runs a command (`note.<choice>`), which the registry lists while that menu is the last
 * one opened (so an outside caller can run what the menu offers).
 */
let shownChoices: readonly PopItem[] = [];
/** A highlight colour's dot for its menu row: the colour the notes editor gives it (its \`.me\` tokens are these app colours). */
const HIGHLIGHT_DOT = (c: "red" | "orange" | "yellow" | "green" | "blue" | "purple"): string => {
  const fill = { red: "var(--hud-danger)", orange: "color-mix(in oklch, var(--code-number) 60%, var(--hud-danger))", yellow: "var(--code-number)", green: "var(--hud-success)", blue: "var(--code-function)", purple: "var(--code-keyword)" }[c];
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="7" style="fill:${fill}"/></svg>`;
};
const CHOICE_LOOK: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/^openLink$/, ICONS.goToLink, "Go where it points"], [/^copyLink$/, ICONS.link, "Copy its address"],
  [/^highlight\.remove$/, ICONS.circleSlash, "Take the highlight off"], [/^highlight\.default$/, ICONS.highlighter, "Mark the words (==words==)"],
  ...(["red", "orange", "yellow", "green", "blue", "purple"] as const).map((c) => [new RegExp(`^highlight\\.${c}$`), HIGHLIGHT_DOT(c), "Mark the words in this colour"] as const),
  [/^cut$/, ICONS.scissors, "Take the selected words out"], [/^copy$/, ICONS.copy, "Copy the selected words"], [/^paste$/, ICONS.clipboardPaste, "Put in what was copied"],
  [/^toCallout$/, ICONS.speechBalloon, "Make the block a callout"], [/^calloutType$/, ICONS.speechBalloon, "Another kind of callout"], [/^removeCallout$/, ICONS.circleSlash, "Back to plain words"],
  [/^callout\./, ICONS.speechBalloon, "A callout of this kind"], [/^selectAll$/, ICONS.selectAll, "Every word of the note"], [/^undo$/, ICONS.undo, "Take back the last change"], [/^redo$/, ICONS.redo, "Put back what was taken back"],
  [/^table\.rowGroup$/, ICONS.listPlus, "Add, move, copy or delete this row"], [/^table\.colGroup$/, ICONS.columns3, "Add, move, copy or delete this column"],
  [/^table\.alignGroup$/, ICONS.textAlignLeft, "Where this column's words stand"], [/^table\.sortGroup$/, ICONS.arrowDownAZ, "The rows in order of this column"],
  [/^table\.turnGroup$/, ICONS.pilcrow, "The table as a list or lines of text"], [/^table\.delete$/, ICONS.trash, "Take the whole table out of the note"],
  [/^table\.row(Above|Below)$/, ICONS.listPlus, "A new row here"], [/^table\.col(Before|After)$/, ICONS.columns3, "A new column here"],
  [/^table\.row(Up|Down)$/, ICONS.arrowUpDown, "The row one place along"], [/^table\.col(Left|Right)$/, ICONS.arrowLeftRight, "The column one place along"],
  [/^table\.dupRow$/, ICONS.copyPlus, "A copy of the row under it"], [/^table\.dupCol$/, ICONS.copyPlus, "A copy of the column beside it"],
  [/^table\.alignLeft$/, ICONS.textAlignLeft, "Words to the left"], [/^table\.alignCenter$/, ICONS.textAlignCenter, "Words in the middle"], [/^table\.alignRight$/, ICONS.textAlignRight, "Words to the right"],
  [/^table\.sortUp$/, ICONS.arrowDownAZ, "Rows in order of this column"], [/^table\.sortDown$/, ICONS.arrowDownZA, "Rows in reverse order"],
  [/^table\.del(Row|Col)$/, ICONS.trash, "Take it out of the table"], [/^table\.copy$/, ICONS.clipboardCopy, "The table as Markdown text"], [/^table\.duplicate$/, ICONS.copyPlus, "A copy of the table under it"],
  [/^table\.toList$/, ICONS.list, "A line of the list per row"], [/^table\.toNumbered$/, ICONS.listOrdered, "A numbered line per row"], [/^table\.toTasks$/, ICONS.listChecks, "A task per row"], [/^table\.toLines$/, ICONS.pilcrow, "A line of text per row"],
  [/^language\.none$/, ICONS.fileCode, "No language: plain text"], [/^language\./, ICONS.fileCode, "Colour the code as this"],
];
const lookOf = (id: string): readonly [string, string] => {
  // (Turn into's blocks: each with its own toolbar icon)
  if (id.startsWith("turn.")) return [(NOTE_ICONS as Record<string, string>)[id.slice(5)] ?? ICONS.pilcrow, "The selected lines become this block"];
  const hit = CHOICE_LOOK.find(([re]) => re.test(id));
  return hit ? [hit[1], hit[2]] : [ICONS.fileCode, "Choose it"];
};
/** The notes editor last focused or opened (what the mode commands act on). */
let activeEditor: MarkdownEditor | null = null;
/** How the person's keys for the mode commands read (Settings > Shortcuts), set by the app: for the toolbar's tooltips. */
let keyNames: () => { liveOrPreview?: string; source?: string } = () => ({});
export const setNoteKeyNames = (fn: typeof keyNames): void => void (keyNames = fn);
/** Live editing or preview, one then the other; the source or back to live (the commands behind Ctrl+E and Ctrl+Shift+E). */
const switchMode = (to: "liveOrPreview" | "source"): void => {
  const ed = activeEditor;
  if (!ed) return;
  ed.setMode(to === "source" ? (ed.mode === "source" ? "live" : "source") : ed.mode === "preview" ? "live" : "preview");
};
const noNote = (): string | null => (activeEditor?.el.isConnected ? null : "Open a note first.");
commands.setProvider("note-editor", () => [
  ...shownChoices.map((c) => ({ id: `note.${c.id}`, title: c.label, group: "Note", hint: lookOf(c.id)[1], icon: lookOf(c.id)[0], risk: "edit" as const, why: () => (c.disabled ? "Not available here" : null), exec: () => void c.pick() })),
  { id: "notes.liveOrPreview", title: "Live editing or preview", group: "Note", hint: "The open note, one then the other", icon: ICONS.eye, risk: "read" as const, why: noNote, exec: () => void switchMode("liveOrPreview") },
  { id: "notes.source", title: "Source or live editing", group: "Note", hint: "The open note's Markdown as written, or back", icon: ICONS.fileCode, risk: "read" as const, why: noNote, exec: () => void switchMode("source") },
]);
/** The editor's menu host: its choices as the app's menu at a point. */
function openChoices(at: DOMRect, items: readonly PopItem[], label: string): void {
  // (every choice, its groups' too, is a command of its own)
  shownChoices = items.flatMap((c) => (c.sub ? [c, ...c.sub] : [c]));
  const row = (c: PopItem): MenuItem => {
    const [icon, hint] = lookOf(c.id);
    return { id: `note.${c.id}`, command: `note.${c.id}`, label: c.label, hint, icon, ...(c.sep ? { sep: true } : {}), ...(c.disabled ? { disabled: true } : {}), ...(c.on ? { checked: true } : {}), ...(c.danger ? { danger: true } : {}), ...(c.sub ? { sub: c.sub.map(row) } : {}), run: () => void commands.press(`note.${c.id}`) };
  };
  const rows: MenuItem[] = items.map(row);
  showContextMenu(at.left, at.bottom, rows, label);
}

/** The app's icons on the editor's toolbar (the same thing shows the same icon everywhere). */
const NOTE_ICONS = {
  live: ICONS.pencilLine, source: ICONS.fileCode, preview: ICONS.eye,
  bold: ICONS.bold, italic: ICONS.italic, strike: ICONS.strikethrough, highlight: ICONS.highlighter, link: ICONS.link,
  heading1: ICONS.heading1, heading2: ICONS.heading2, heading3: ICONS.heading3, bulletList: ICONS.list, orderedList: ICONS.listOrdered, taskList: ICONS.listChecks,
  table: ICONS.grid3x3, rule: ICONS.minus, picture: ICONS.image, find: ICONS.search, outline: ICONS.tableOfContents, save: ICONS.save, clearFormat: ICONS.eraser, callout: ICONS.speechBalloon,
};

/** Open a note in the notes editor inside `el`. Its links to library items show those items (pictures, videos, sounds); files added go into the library. */
export async function mountNoteEditor(el: HTMLElement, opts: { kind: Exclude<NoteKind, "rich">; text: string; mode: EditorMode; host: NoteHost; /** A sign typed over selected words goes round them (Settings). */ wrapSelection?: boolean; /** Code blocks in a language are coloured (Settings). */ codeColours?: boolean; /** The note's name (no extension), for {{title}}. */ title: string; /** The whole place it is shown in (else the library's viewer). */ root?: HTMLElement | null; /** Shown at the top of the note (its properties, from the details panel). */ top?: HTMLElement; /** Where its outline floats, and where the person puts it (kept: Settings). */ outline?: { side: "off" | "left" | "right"; set(side: "off" | "left" | "right"): void } }): Promise<NoteEditor> {
  const { host } = opts;
  const md = opts.kind === "md";
  /** Each library item shown, by its link as written: its temporary address (let go when the note closes). */
  const shown = new Map<string, Promise<{ url: string; type: string } | null>>();
  const itemOf = (link: string, embed: boolean): Promise<NoteItem | null> => {
    if (embed) return host.findWiki(link);
    const target = linkTarget(link, host.dir);
    return target ? host.find(target) : Promise.resolve(null);
  };
  const media = (link: string, embed: boolean): Promise<{ url: string; type: string } | null> => {
    const key = `${embed ? "w" : "p"}:${link}`;
    let got = shown.get(key);
    if (!got) {
      got = (async () => {
        const item = await itemOf(link, embed);
        const blob = item && (await host.blob(item.hash));
        return blob && item ? { url: URL.createObjectURL(blob), type: item.type || blob.type } : null;
      })().catch(() => null);
      shown.set(key, got);
      // (not found yet: asked again next time, as it may arrive)
      void got.then((r) => void (r || shown.delete(key)));
    }
    return got;
  };
  /** A link as the host opens it: a path as written, or a wiki target behind `canvast-wiki:`. */
  const hostLink = (f: FollowedLink): string => (f.wiki ? `${WIKI}${encodeLinkPart(f.link)}` : f.link);
  /** Markdown for a library item: a picture, video or sound shown, anything else linked; by its path from the root of the library. */
  const written = async (item: NoteItem): Promise<string> => {
    const path = libraryLink(await host.pathOf(item.hash));
    const name = item.name.replace(/[[\]]/g, "");
    return /^(image|video|audio)\//.test(item.type) ? `![${name}](${path})` : `[${name}](${path})`;
  };

  let dirty = false;
  /** Properties pasted with a note from another notes app, until the next save puts them in the file; with the words that came with them. */
  const pasted: Array<{ props: Prop[]; words: string[] }> = [];
  const bare = (s: string): string => s.replace(/\s+/g, "");

  const templateItems = async (): Promise<SlashItem[]> => {
    const own = await host.templates().catch(() => []);
    const list = [...TEMPLATES.map((t) => ({ name: t.name, text: t.text })), ...own.map((t) => ({ name: t.name, text: t.kind === "md" ? splitFrontmatter(t.text).body : t.text }))];
    return list.map((t) => ({ label: t.name, detail: "Template", pick: (ed) => ed.insert(fillTemplate(t.text, opts.title)) }));
  };

  /** The names `[[` links can reach (notes without `.md`, files whole, `canvas:` names), in lower case; read once the editor is open. */
  let known: Set<string> | null = null;
  void host.linkables().then((list) => {
    known = new Set(list.flatMap((l) => [l.key.toLowerCase(), l.name.toLowerCase()]));
    editor?.refresh();
  }, () => undefined);
  let editor!: MarkdownEditor;
  editor = createMarkdownEditor({
    parent: el,
    value: md ? splitFrontmatter(opts.text).body : opts.text,
    mode: opts.mode,
    ...(opts.outline ? { outline: opts.outline.side, onOutline: (s: "off" | "left" | "right") => opts.outline!.set(s) } : {}),
    plain: !md,
    vim: host.vim,
    keyNames: keyNames(),
    // (the keys the keymap sends a binding on as: the person's own keys for these are set in Settings > Shortcuts)
    modeKeys: { liveOrPreview: "Ctrl-Alt-Shift-F9", source: "Ctrl-Alt-Shift-F10" },
    ...(md && opts.top ? { top: opts.top } : {}),
    icons: NOTE_ICONS,
    wrapSelection: opts.wrapSelection ?? true,
    injectStyles: true,
    onChange: () => void (dirty = true),
    host: {
      media,
      ...(host.player ? { player: host.player.bind(host) } : {}),
      open: (f) => host.open(hostLink(f)),
      links: async () => (await host.linkables()).map((l) => ({ target: l.key, label: l.name, ...(l.key !== l.name ? { detail: l.key } : {}) })),
      // (a link to nothing is drawn muted; known once the library's names have been read)
      wikiExists: (target) => (known ? known.has(target.toLowerCase()) || known.has(target.toLowerCase().split("/").pop()!) : undefined),
      languages: CODE_LANGUAGES.filter((l) => !/^(js|ts|py|sh|shell|yml|md|cs|c\+\+)$/.test(l)),
      tags: () => host.tags(),
      files: async (files) => {
        const items = await host.importFiles(files);
        if (!items.length) return null;
        return (await Promise.all(items.map(written))).join(items.some((i) => /^(image|video|audio)\//.test(i.type)) ? "\n\n" : " ");
      },
      // A note pasted from another notes app with its properties: they go in with the note's own at the next save.
      pasting: (text) => {
        const { props, body } = splitFrontmatter(text);
        if (!props?.length) return text;
        pasted.push({ props, words: body.split(/\n+/).map(bare).filter(Boolean) });
        return body;
      },
      choosePicture: async () => {
        const item = await host.choose("image");
        return item ? written(item) : null;
      },
      slash: templateItems,
      ...(opts.codeColours !== false ? { codeSpans } : {}),
      save: () => void host.save(),
      renderMath,
      renderDiagram,
      // The link popover: a linked note to read and write in (its properties kept by the save), a picture shown, or what is missing.
      linkTarget: async (target) => {
        const item = await host.findWiki(target);
        if (!item) return { kind: "missing", title: target };
        if (noteKindOf(item.name)) {
          const blob = await host.blob(item.hash);
          if (!blob) return null;
          const file = await blob.text();
          let hash = item.hash;
          return { kind: "note", title: item.name.replace(/\.(md|markdown|txt)$/i, ""), text: noteKindOf(item.name) === "md" ? splitFrontmatter(file).body : file, save: async (words) => void (hash = (await host.saveOther(hash, words)) ?? hash) };
        }
        const shown = await media(target, true);
        return shown ? { kind: "media", title: item.name, ...shown } : { kind: "missing", title: item.name };
      },
      createNote: async (target) => !!(await host.createNote(target.split("/").pop()!)),
      newNote: () => host.newNote(),
      menu: openChoices,
      rendered: (page) => void (opts.codeColours !== false && paintCode(el, page)),
    },
  });
  editor.el.dataset["testid"] = "note-editor";
  activeEditor = editor;
  // view-state: (which note the mode commands act on: the one last worked in)
  editor.el.addEventListener("focusin", () => void (activeEditor = editor));

  // The keyboard's Save and Find while the person is at the note, wherever the focus went in it (a toolbar button): never on to the canvas or the library behind it.
  const root = opts.root ?? el.closest<HTMLElement>('[data-testid="slide-view"]') ?? el;
  let atNote = !opts.root;
  const pressed = (e: PointerEvent): void => {
    const t = e.target as Element | null;
    atNote = !!t && (root.contains(t) || !!t.closest(".lib-pick, .cm-tooltip"));
  };
  window.addEventListener("pointerdown", pressed, true);
  const keys = (e: KeyboardEvent): void => {
    // (the mode keys, as the keymap sends them on (settings/keymap.ts), with the focus elsewhere in the note, the preview's page: the same commands as in its words)
    // (at the note: pressed in it last, or the focus in it now, as after a mode key: no click needed)
    const here = atNote || (e.target instanceof Node && root.contains(e.target));
    // (one place for the mode keys, the focus in the words or not: the editor's own key table may never see a key the keymap sent on)
    if (here && root.isConnected && e.ctrlKey && e.altKey && e.shiftKey && (e.key === "F9" || e.key === "F10")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return void commands.press(e.key === "F10" ? "notes.source" : "notes.liveOrPreview");
    }
    if (!here || e.altKey || !(e.ctrlKey || e.metaKey) || !root.isConnected || root.hidden || document.querySelector("dialog[open]")) return;
    if (editor.view.hasFocus) return; // (the editor's own keys)
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || /^(TEXTAREA|SELECT|INPUT)$/.test(t.tagName));
    // Undo and Redo with the focus elsewhere in the note (its header, a toolbar button) are the note's, never the canvas's or the library's behind it.
    if (!typing && (e.code === "KeyZ" || (e.code === "KeyY" && !e.shiftKey))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "KeyZ" && !e.shiftKey) editor.undo();
      else editor.redo();
      return;
    }
    if (e.shiftKey) return;
    if (e.code === "KeyS") {
      e.preventDefault();
      e.stopImmediatePropagation();
      void host.save();
    } else if (e.code === "KeyF") {
      // (the note's own find, never the library's or the canvas's behind it; in preview the words to find in are live editing's)
      e.preventDefault();
      e.stopImmediatePropagation();
      if (editor.mode === "preview") editor.setMode("live");
      editor.find();
    }
  };
  window.addEventListener("keydown", keys, true);

  // Copying the whole note takes its properties along, as the markdown file it is: pasted at the top of a note elsewhere, they are properties there.
  // typing: (reading what the properties are now, for a copy of the whole note)
  el.addEventListener("focusin", () => void host.refreshWhole());
  const copyWhole = (e: ClipboardEvent): void => {
    if (!md || !e.clipboardData || !editor.allSelected()) return;
    const whole = host.whole(editor.value, self.pastedProps());
    if (whole === null) return;
    e.clipboardData.setData("text/plain", whole);
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener("copy", copyWhole, true);

  // The pointer resting on a link: a small card with the preview of what it points at (a note's page, a picture), like a tooltip.
  let peekTimer = 0;
  let peekCard: HTMLElement | null = null;
  const unpeek = (): void => {
    clearTimeout(peekTimer);
    peekCard?.remove();
    peekCard = null;
  };
  const peekOver = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest?.<HTMLElement>("[data-href], [data-wiki], .me-preview a[href]");
    if (!a || !el.contains(a)) return;
    unpeek();
    peekTimer = window.setTimeout(() => {
      const wiki = a.getAttribute("data-wiki");
      const link = wiki !== null ? `${WIKI}${encodeLinkPart(wiki)}` : (a.getAttribute("data-href") ?? a.getAttribute("href") ?? "");
      void host.peek(link).then((blob) => {
        if (!blob || !a.isConnected || !a.matches(":hover")) return;
        const url = URL.createObjectURL(blob);
        const r = a.getBoundingClientRect();
        peekCard = document.createElement("div");
        peekCard.className = "note-link-peek";
        peekCard.style.left = `${Math.round(r.left)}px`;
        peekCard.style.top = `${Math.round(r.bottom + 6)}px`;
        peekCard.innerHTML = `<img alt="" src="${url}">`;
        peekCard.querySelector("img")!.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
        document.body.append(peekCard);
      });
    }, 350);
  };
  el.addEventListener("mouseover", peekOver);
  el.addEventListener("mouseout", unpeek);

  let savedText = editor.value;
  let edits = 0;
  let editsAtCurrent = 0;
  // typing: (writing the note: it is saved as it is typed)
  el.addEventListener("input", () => void edits++, true);
  editor.view.dom.addEventListener("keydown", () => void edits++);

  const self: NoteEditor = {
    get dirty() {
      return dirty && editor.value !== savedText;
    },
    text: () => editor.value,
    reveal: (t) => editor.reveal(t),
    pastedProps() {
      // (undone or deleted, all of what came with them: they went too. Nothing but properties was pasted: nothing to tell by, they stay.)
      const now = bare(editor.value);
      return pasted.filter((p) => !p.words.length || p.words.some((w) => now.includes(w))).flatMap((p) => p.props);
    },
    current() {
      editsAtCurrent = edits;
      return editor.value;
    },
    saved(as) {
      pasted.length = 0;
      const now = editor.value;
      // (typed while it was being saved: still a change)
      const typed = as !== undefined && edits !== editsAtCurrent && as !== now;
      savedText = typed ? as : now;
      dirty = typed;
    },
    async retryPictures() {
      await host.reread();
      editor.refresh();
    },
    destroy() {
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("pointerdown", pressed, true);
      el.removeEventListener("mouseover", peekOver);
      el.removeEventListener("mouseout", unpeek);
      el.removeEventListener("copy", copyWhole, true);
      unpeek();
      dropCode(el);
      editor.destroy();
      for (const p of shown.values()) void p.then((r) => r && URL.revokeObjectURL(r.url));
    },
  };
  return self;
}
