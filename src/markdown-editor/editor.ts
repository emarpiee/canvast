// The Markdown editor: one CodeMirror view for live and source mode, a rendered page for preview mode, a toolbar, and the hooks a host fills in
// (pictures, links, tags, files, saving). It knows nothing of the app it is in.
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { codeColours, type CodeSpans } from "./code";
import { COMMANDS, toggleTask, wrapTyped, type FormatName } from "./commands";
import { pastedMarkdown } from "./html-to-markdown";
import { DEFAULT_ICONS, type IconName } from "./icons";
import { markdownLook } from "./highlight";
import { livePreview, refresh } from "./live";
import { selectionBar } from "./selection-bar";
import { renderMarkdown } from "./render";
import { EXTENSIONS } from "./syntax";
import { CM_THEME, injectStyles } from "./style";

export type EditorMode = "live" | "source" | "preview";

/** A link the person followed: as written in the text. */
export interface FollowedLink {
  /** The address (`cat.png`, `https://…`) or the wiki target (`Plan`, `Folder/Plan#Part`). */
  link: string;
  /** `[[…]]` (true) or a Markdown link or address (false). */
  wiki: boolean;
  /** A picture's or embed's link rather than a link's. */
  media: boolean;
}

/** One row of the `[[` list. */
export interface LinkChoice {
  /** What the link writes (`Plan`, `Folder/Plan`). */
  target: string;
  /** What the list shows; the target when absent. */
  label?: string;
  /** Smaller text beside it. */
  detail?: string;
}

/** A row of the `/` menu that the host adds (a template, a picture from its library). */
export interface SlashItem {
  label: string;
  detail?: string;
  /** Words the menu also finds it by. */
  keywords?: string;
  /** Chosen: what it does (it writes into the editor through `insert`). */
  pick(editor: MarkdownEditor): void | Promise<void>;
}

/** What the editor asks of the page it is in. Every member is optional. */
export interface EditorHost {
  /** A picture, video or sound for a link as written, or an embed's target: an address the page can show, and its type. */
  media?(link: string, embed: boolean): Promise<{ url: string; type: string } | null>;
  /** Ctrl+click (⌘ on a Mac) on a link in live or source mode, a click in preview mode. */
  open?(link: FollowedLink): void;
  /** The rows of `[[`. */
  links?(): Promise<readonly LinkChoice[]>;
  /** The tags `#` offers (without `#`). */
  tags?(): Promise<readonly string[]>;
  /** Files dropped or pasted: what to write for them (Markdown), or null to leave them. */
  files?(files: File[]): Promise<string | null>;
  /** Markdown about to be pasted (the plain text, or a page read as Markdown): what to paste instead. */
  pasting?(markdown: string): string;
  /** The toolbar's Picture button and `/picture`: Markdown for a chosen picture, or null. */
  choosePicture?(): Promise<string | null>;
  /** More rows of the `/` menu. */
  slash?(): Promise<readonly SlashItem[]>;
  /** Colours for code in a language. */
  codeSpans?: CodeSpans;
  /** Ctrl+S and the Save button. */
  save?(): void;
  /** Preview mode drew its page (to colour its code, say). */
  rendered?(page: HTMLElement): void;
}

export interface EditorLabels {
  live: string; source: string; preview: string; modes: string;
  bold: string; italic: string; strike: string; highlight: string; code: string; link: string;
  heading1: string; heading2: string; heading3: string; paragraph: string;
  bulletList: string; orderedList: string; taskList: string; toggleTask: string; quote: string; codeBlock: string; table: string; rule: string;
  picture: string; find: string; save: string; task: string; placeholder: string; toolbar: string; format: string; insert: string;
  turnInto: string; copyCode: string; copied: string; codeLanguage: string; addRow: string; addColumn: string;
}

export const DEFAULT_LABELS: EditorLabels = {
  live: "Live", source: "Source", preview: "Preview", modes: "View",
  bold: "Bold", italic: "Italic", strike: "Strikethrough", highlight: "Highlight", code: "Code", link: "Link",
  heading1: "Heading 1", heading2: "Heading 2", heading3: "Heading 3", paragraph: "Text",
  bulletList: "Bulleted list", orderedList: "Numbered list", taskList: "Task list", toggleTask: "Tick task", quote: "Quote", codeBlock: "Code block", table: "Table", rule: "Divider",
  picture: "Picture", find: "Find", save: "Save", task: "Done", placeholder: "Write, or press / for blocks", toolbar: "Formatting", format: "Format", insert: "Insert",
  turnInto: "Turn into", copyCode: "Copy code", copied: "Copied", codeLanguage: "Code language: click to change it", addRow: "Add a row", addColumn: "Add a column",
};

export interface EditorOptions {
  /** The element the editor fills. */
  parent: HTMLElement;
  /** The text to start with. */
  value?: string;
  /** Default `"live"`. */
  mode?: EditorMode;
  /** Plain text, not Markdown: no live or preview mode, no formatting. */
  plain?: boolean;
  host?: EditorHost;
  labels?: Partial<EditorLabels>;
  icons?: Partial<Record<IconName, string>>;
  /** Show the toolbar. Default true. */
  toolbar?: boolean;
  /** A sign typed over selected words goes round them (`*`, `` ` ``, brackets, quotes). Default true. */
  wrapSelection?: boolean;
  /** Add the stylesheet to the page (once). Default true; else include `EDITOR_CSS` yourself. */
  injectStyles?: boolean;
  /** The text changed (typed, pasted, undone, a box ticked). */
  onChange?(value: string): void;
  /** The person switched the mode. */
  onMode?(mode: EditorMode): void;
}

export interface MarkdownEditor {
  readonly el: HTMLElement;
  readonly view: EditorView;
  /** The text now. */
  readonly value: string;
  /** Replace the whole text (not an undo step when `fresh`: a file loaded again). Fires no `onChange`. */
  setValue(text: string, fresh?: boolean): void;
  readonly mode: EditorMode;
  setMode(mode: EditorMode): void;
  /** Run a format or insert command; whether it did something. */
  run(name: FormatName): boolean;
  /** Put Markdown in at the cursor (replacing the selection). */
  insert(markdown: string): void;
  /** The selected text, as written. */
  selection(): string;
  /** Whether all of the text is selected. */
  allSelected(): boolean;
  /** Open the find bar (not in preview mode). */
  find(): void;
  /** Undo or redo a step of the text (the keys do it in the text; this is for the host, when the focus is elsewhere in it). */
  undo(): boolean;
  redo(): boolean;
  /** Ask the host for its pictures again (one may have arrived). */
  refresh(): void;
  focus(): void;
  destroy(): void;
}

/** The commands of each toolbar group, in order. */
type ToolName = FormatName & IconName;
const FORMAT_TOOLS: ToolName[] = ["bold", "italic", "strike", "highlight", "code", "link"];
const BLOCK_TOOLS: ToolName[] = ["heading1", "heading2", "heading3", "bulletList", "orderedList", "taskList", "quote", "codeBlock", "table", "rule"];

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);

/** Make an editor in `opts.parent`. */
export function createMarkdownEditor(opts: EditorOptions): MarkdownEditor {
  if (opts.injectStyles !== false) injectStyles(opts.parent.ownerDocument);
  const host: EditorHost = opts.host ?? {};
  const labels: EditorLabels = { ...DEFAULT_LABELS, ...opts.labels };
  const icons = { ...DEFAULT_ICONS, ...opts.icons };
  const plain = !!opts.plain;
  let mode: EditorMode = plain ? "source" : (opts.mode ?? "live");
  let silent = false;

  const el = document.createElement("div");
  el.className = `me${plain ? " me-plain" : ""}`;
  const bar = document.createElement("div");
  bar.className = "me-toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", labels.toolbar);
  const body = document.createElement("div");
  body.className = "me-body";
  const preview = document.createElement("div");
  preview.className = "me-preview";
  preview.hidden = true;
  const page = document.createElement("div");
  page.className = "me-page";
  preview.append(page);
  if (opts.toolbar !== false) el.append(bar);
  el.append(body);
  opts.parent.append(el);

  const liveLayer = new Compartment();
  const liveExt = (): Extension => (mode === "live" ? livePreview({ ...(host.media ? { media: host.media.bind(host) } : {}), taskLabel: labels.task, copyLabel: labels.copyCode, copiedLabel: labels.copied, languageLabel: labels.codeLanguage, addRowLabel: labels.addRow, addColumnLabel: labels.addColumn }) : []);

  // `[[` → links, `#` → tags, `/` at a line's start or after a space → blocks.
  const complete = async (cx: CompletionContext): Promise<CompletionResult | null> => {
    const wiki = cx.matchBefore(/!?\[\[[^\[\]\n|]*$/);
    if (wiki && host.links) {
      const open = wiki.text.indexOf("[[") + 2;
      const list = await host.links();
      return {
        from: wiki.from + open,
        options: list.map((l): Completion => ({ label: l.target, displayLabel: l.label ?? l.target, ...(l.detail ? { detail: l.detail } : {}), apply: (view, _c, from, to) => {
          const close = view.state.sliceDoc(to, to + 2) === "]]" ? "" : "]]";
          view.dispatch({ changes: { from, to, insert: `${l.target}${close}` }, selection: { anchor: from + l.target.length + 2 } });
        } })),
        validFor: /^[^\[\]\n|]*$/,
      };
    }
    const tag = cx.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_\-/]*$/u);
    if (tag && host.tags && !inCode(cx)) {
      const at = tag.text.indexOf("#");
      const list = await host.tags();
      return { from: tag.from + at + 1, options: list.map((t) => ({ label: t.replace(/\s+/g, "-"), type: "keyword" })), validFor: /^[\p{L}\p{N}_\-/]*$/u };
    }
    const slash = cx.matchBefore(/(?:^|\s)\/[\w ]*$/);
    if (slash && !inCode(cx)) {
      const at = slash.text.indexOf("/");
      const own: Completion[] = BLOCK_TOOLS.map((name) => ({ label: labels[name], type: "text", apply: (view, _c, from, to) => {
        view.dispatch({ changes: { from: from - 1, to } });
        COMMANDS[name](view);
      } }));
      if (host.choosePicture) own.push({ label: labels.picture, type: "text", apply: (view, _c, from, to) => {
        view.dispatch({ changes: { from: from - 1, to } });
        void pickPicture();
      } });
      const extra = host.slash ? await host.slash() : [];
      for (const item of extra) own.push({ label: item.label, ...(item.detail ? { detail: item.detail } : {}), type: "text", apply: (view, _c, from, to) => {
        view.dispatch({ changes: { from: from - 1, to } });
        void item.pick(self);
      } });
      return { from: slash.from + at + 1, options: own, validFor: /^[\w ]*$/ };
    }
    return null;
  };
  const inCode = (cx: CompletionContext): boolean => {
    for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(cx.state).resolveInner(cx.pos, -1); n; n = n.parent) if (/Code/.test(n.name)) return true;
    return false;
  };

  const formatKeys = [
    { key: "Mod-b", run: COMMANDS.bold },
    { key: "Mod-i", run: COMMANDS.italic },
    { key: "Mod-Shift-x", run: COMMANDS.strike },
    { key: "Mod-Shift-h", run: COMMANDS.highlight },
    { key: "Mod-`", run: COMMANDS.code },
    { key: "Mod-k", run: COMMANDS.link },
    { key: "Mod-Enter", run: COMMANDS.toggleTask },
    { key: "Mod-Alt-1", run: COMMANDS.heading1 },
    { key: "Mod-Alt-2", run: COMMANDS.heading2 },
    { key: "Mod-Alt-3", run: COMMANDS.heading3 },
    { key: "Mod-Alt-0", run: COMMANDS.paragraph },
  ];
  const appKeys = keymap.of([
    { key: "Mod-s", preventDefault: true, run: () => (host.save?.(), true) },
    { key: "Mod-e", preventDefault: true, run: () => (plain ? false : (setModeBy(mode === "preview" ? "live" : "preview"), true)) },
  ]);

  const extensions: Extension[] = [
    history(),
    drawSelection(),
    EditorView.theme(CM_THEME),
    EditorView.lineWrapping,
    search({ top: true }),
    placeholderExt(labels.placeholder),
    EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
    appKeys,
    keymap.of([...(plain ? [] : formatKeys), ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !silent) opts.onChange?.(u.state.sliceDoc());
    }),
    EditorView.inputHandler.of((view, _from, _to, text) => {
      if (opts.wrapSelection === false) return false;
      const tr = wrapTyped(view.state, text);
      if (!tr || (plain && /[*_~`=]/.test(text))) return false;
      view.dispatch(tr);
      return true;
    }),
    EditorView.domEventHandlers({
      paste: (e, view) => onPaste(e, view),
      drop: (e, view) => onDrop(e, view),
      // Ctrl+click (⌘ on a Mac) on a link follows it; a plain click edits it.
      mousedown: (e) => {
        if (!(isMac ? e.metaKey : e.ctrlKey) || e.button !== 0) return false;
        const t = (e.target as HTMLElement).closest<HTMLElement>("[data-href], [data-wiki], [data-embed], [data-src]");
        if (!t || !host.open) return false;
        e.preventDefault();
        host.open(followed(t));
        return true;
      },
    }),
  ];
  if (!plain) {
    extensions.push(markdown({ base: markdownLanguage, extensions: EXTENSIONS, addKeymap: true }), markdownLook, selectionBar({ icons, labels: labels as unknown as Record<string, string> }), liveLayer.of(liveExt()), autocompletion({ override: [complete], icons: false, activateOnTyping: true }));
    if (host.codeSpans) extensions.push(codeColours(host.codeSpans));
  }

  // (a file's own line ends are kept: one written with CR LF throughout is saved so)
  const lineEnds = (text: string): Extension => (/\r\n/.test(text) && !/(^|[^\r])\n/.test(text) ? EditorState.lineSeparator.of("\r\n") : []);
  const stateOf = (text: string): EditorState => EditorState.create({ doc: text, extensions: [extensions, lineEnds(text)] });
  const view = new EditorView({ state: stateOf(opts.value ?? ""), parent: body });
  body.append(preview);

  const followed = (t: HTMLElement): FollowedLink => {
    if (t.hasAttribute("data-wiki")) return { link: t.getAttribute("data-wiki")!, wiki: true, media: false };
    if (t.hasAttribute("data-embed")) return { link: t.getAttribute("data-embed")!, wiki: true, media: true };
    if (t.hasAttribute("data-src")) return { link: t.getAttribute("data-src")!, wiki: false, media: true };
    return { link: t.getAttribute("data-href") ?? t.getAttribute("href") ?? "", wiki: false, media: false };
  };

  const onPaste = (e: ClipboardEvent, v: EditorView): boolean => {
    const data = e.clipboardData;
    if (!data) return false;
    const files = [...data.files];
    if (files.length && host.files) {
      e.preventDefault();
      void host.files(files).then((md) => md && insertBlock(v, md));
      return true;
    }
    if (plain) return false;
    const text = data.getData("text/plain");
    const html = data.getData("text/html");
    // (in a code block, words are words)
    if (inCodeAt(v, v.state.selection.main.head)) return false;
    // A web address or a [[link]] pasted over words on one line: those words become the link.
    const sel = v.state.selection.main;
    const words = v.state.sliceDoc(sel.from, sel.to);
    const address = text.trim();
    const wiki = /^\[\[([^[\]|\n]+)\]\]$/.exec(address);
    if (words.trim() && !words.includes("\n") && (wiki || /^(https?:\/\/|mailto:)\S+$/i.test(address))) {
      e.preventDefault();
      v.dispatch(v.state.replaceSelection(wiki ? `[[${wiki[1]}|${words}]]` : `[${words}](${address})`), { scrollIntoView: true, userEvent: "input.paste" });
      return true;
    }
    if (!html && !host.pasting) return false;
    let md = pastedMarkdown(text, html);
    if (host.pasting) md = host.pasting(md);
    e.preventDefault();
    v.dispatch(v.state.replaceSelection(md), { scrollIntoView: true, userEvent: "input.paste" });
    return true;
  };
  const inCodeAt = (v: EditorView, pos: number): boolean => {
    for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(v.state).resolveInner(pos, -1); n; n = n.parent) if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
    return false;
  };
  const onDrop = (e: DragEvent, v: EditorView): boolean => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length || !host.files) return false;
    e.preventDefault();
    const at = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
    v.dispatch({ selection: { anchor: at } });
    void host.files(files).then((md) => md && insertBlock(v, md));
    return true;
  };
  const insertAt = (v: EditorView, md: string): void => {
    v.dispatch(v.state.replaceSelection(md), { scrollIntoView: true, userEvent: "input.paste" });
  };
  /** Markdown on lines of its own at the cursor (a picture: never inside a heading or a sentence). */
  const insertBlock = (v: EditorView, md: string): void => {
    const r = v.state.selection.main;
    const line = v.state.doc.lineAt(r.from), endLine = v.state.doc.lineAt(r.to);
    const before = line.text.slice(0, r.from - line.from).trim() ? "\n\n" : "";
    const after = endLine.text.slice(r.to - endLine.from).trim() ? "\n\n" : "";
    v.dispatch({ changes: { from: r.from, to: r.to, insert: `${before}${md}${after}` }, selection: { anchor: r.from + before.length + md.length }, scrollIntoView: true, userEvent: "input.paste" });
  };
  const pickPicture = async (): Promise<void> => {
    const md = await host.choosePicture?.();
    if (md) insertBlock(view, md);
  };

  // Preview mode: the text drawn as a page. A click on a link follows it; a click on a task's box ticks it in the text.
  const drawPreview = (): void => {
    page.innerHTML = cleanHtml(renderMarkdown(view.state.sliceDoc(), { html: true, taskOffsets: true, taskLabel: labels.task, wikiHref: () => "#" }));
    for (const img of page.querySelectorAll<HTMLImageElement>("img")) {
      const embed = img.getAttribute("data-embed");
      const link = embed ?? img.getAttribute("src") ?? "";
      img.setAttribute(embed ? "data-embed" : "data-src", link);
      img.removeAttribute("src");
      void host.media?.(link, embed !== null).then((got) => {
        if (!got || !img.isConnected) return;
        const kind = got.type.split("/")[0];
        if (kind === "video" || kind === "audio") {
          const m = document.createElement(kind);
          m.controls = true;
          m.src = got.url;
          img.replaceWith(m);
        } else img.src = got.url;
      });
    }
    host.rendered?.(page);
  };
  // view-state: (preview mode's page: a click follows a link or ticks a task, which edits the text through the editor)
  preview.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const box = t.closest<HTMLInputElement>("input[data-task]");
    if (box) {
      e.preventDefault();
      toggleTask(view, Number(box.getAttribute("data-task")));
      drawPreview();
      return;
    }
    const a = t.closest<HTMLElement>("a[href], [data-wiki], img[data-embed], img[data-src]");
    if (!a) return;
    e.preventDefault();
    if (a.tagName === "A" && !a.hasAttribute("data-wiki")) host.open?.({ link: a.getAttribute("href") ?? "", wiki: false, media: false });
    else host.open?.(followed(a));
  });

  // The toolbar: the modes, then the formats and blocks, then the host's buttons.
  const btn = (name: string, icon: string, label: string, keys = ""): string =>
    `<button type="button" class="me-btn" data-me="${name}" aria-label="${esc(label)}" title="${esc(keys ? `${label} (${keys})` : label)}">${icon}</button>`;
  const mod = isMac ? "⌘" : "Ctrl+";
  const KEYS: Partial<Record<string, string>> = { bold: `${mod}B`, italic: `${mod}I`, strike: `${mod}Shift+X`, highlight: `${mod}Shift+H`, code: `${mod}\``, link: `${mod}K`, find: `${mod}F`, save: `${mod}S`, preview: `${mod}E` };
  const drawBar = (): void => {
    const groups: string[] = [];
    if (!plain) {
      groups.push(`<div class="me-group" role="group" aria-label="${esc(labels.modes)}">${(["live", "source", "preview"] as const).map((m) => btn(`mode:${m}`, icons[m], labels[m], KEYS[m])).join("")}</div>`);
      groups.push(`<div class="me-group" role="group" aria-label="${esc(labels.format)}">${FORMAT_TOOLS.map((n) => btn(n, icons[n], labels[n], KEYS[n])).join("")}</div>`);
      groups.push(`<div class="me-group" role="group" aria-label="${esc(labels.insert)}">${BLOCK_TOOLS.map((n) => btn(n, icons[n], labels[n])).join("")}${host.choosePicture ? btn("picture", icons.picture, labels.picture) : ""}</div>`);
    }
    groups.push(`<div class="me-group">${btn("find", icons.find, labels.find, KEYS["find"])}${host.save ? btn("save", icons.save, labels.save, KEYS["save"]) : ""}</div>`);
    bar.innerHTML = groups.join("");
    syncBar();
  };
  const syncBar = (): void => {
    for (const b of bar.querySelectorAll<HTMLButtonElement>("[data-me]")) {
      const name = b.dataset["me"]!;
      if (name.startsWith("mode:")) b.setAttribute("aria-pressed", String(name.slice(5) === mode));
      else if (name !== "save") b.disabled = mode === "preview";
    }
  };
  // typing: (the toolbar's buttons write the note's Markdown; the mode buttons only change how it is shown)
  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-me]");
    if (!b || b.disabled) return;
    const name = b.dataset["me"]!;
    if (name.startsWith("mode:")) return setModeBy(name.slice(5) as EditorMode);
    if (name === "save") return host.save?.();
    if (name === "find") return void openSearchPanel(view);
    if (name === "picture") return void pickPicture();
    COMMANDS[name as FormatName]?.(view);
    view.focus();
  });
  // (pressing a button keeps the focus, and the selection, in the text)
  // view-state: (only keeps the focus where it was)
  bar.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(".me-btn")) e.preventDefault();
  });

  const applyMode = (): void => {
    el.classList.toggle("me-source", mode === "source");
    el.classList.toggle("me-previewing", mode === "preview");
    view.dispatch({ effects: liveLayer.reconfigure(liveExt()) });
    const showPreview = mode === "preview";
    view.dom.hidden = showPreview;
    preview.hidden = !showPreview;
    if (showPreview) drawPreview();
    syncBar();
  };
  const setModeBy = (m: EditorMode): void => {
    if (m === mode || plain) return;
    mode = m;
    applyMode();
    opts.onMode?.(m);
    if (m !== "preview") view.focus();
  };

  // Ctrl+E from preview mode, where the text (and its keys) are hidden.
  // view-state: (switches how the note is shown)
  el.addEventListener("keydown", (e) => {
    if (mode !== "preview" || plain || e.altKey || e.shiftKey || !(isMac ? e.metaKey : e.ctrlKey) || e.key.toLowerCase() !== "e") return;
    e.preventDefault();
    e.stopPropagation();
    setModeBy("live");
  });
  preview.tabIndex = -1;

  drawBar();
  applyMode();

  const self: MarkdownEditor = {
    el,
    view,
    get value() {
      return view.state.sliceDoc(); // (with the file's own line ends)
    },
    setValue(text, fresh = false) {
      silent = true;
      try {
        if (fresh) {
          view.setState(stateOf(text));
          view.dispatch({ effects: liveLayer.reconfigure(liveExt()) });
        } else view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(Math.min(view.state.selection.main.head, text.length)) });
      } finally {
        silent = false;
      }
      if (mode === "preview") drawPreview();
    },
    get mode() {
      return mode;
    },
    setMode(m) {
      if (m === mode || plain) return;
      mode = m;
      applyMode();
    },
    run(name) {
      if (mode === "preview" || plain) return false;
      return COMMANDS[name](view);
    },
    insert(md) {
      insertAt(view, md);
    },
    selection() {
      return view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join("\n");
    },
    allSelected() {
      const r = view.state.selection.main;
      return view.state.doc.length > 0 && r.from === 0 && r.to === view.state.doc.length;
    },
    undo: () => undo(view),
    redo: () => redo(view),
    find() {
      if (mode === "preview") return;
      view.focus();
      openSearchPanel(view);
    },
    refresh() {
      view.dispatch({ effects: refresh.of(null) });
      if (mode === "preview") drawPreview();
    },
    focus() {
      if (mode === "preview") preview.focus();
      else view.focus();
    },
    destroy() {
      view.destroy();
      el.remove();
    },
  };
  return self;
}

/** Rendered HTML made safe to show: no scripts, frames, forms or event attributes, no script addresses. */
export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const n of doc.body.querySelectorAll("script, style, iframe, frame, object, embed, link, meta, base, form, textarea, select, button")) n.remove();
  for (const n of doc.body.querySelectorAll("*")) {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction|srcdoc)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) || a.name === "srcdoc") n.removeAttribute(a.name);
    }
    if (n.tagName === "INPUT" && (n as HTMLInputElement).type !== "checkbox") n.remove();
  }
  return doc.body.innerHTML;
}
