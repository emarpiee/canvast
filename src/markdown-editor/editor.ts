// The Markdown editor: one CodeMirror view for live and source mode, a rendered page for preview mode, a toolbar, and the hooks a host fills in
// (pictures, links, tags, files, saving). It knows nothing of the app it is in.
import { autocompletion, completionStatus, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { findBar } from "./search-panel";
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, drawSelection, highlightActiveLine, keymap, placeholder as placeholderExt, type DecorationSet } from "@codemirror/view";
import { codeColours, type CodeSpans } from "./code";
import { COMMANDS, type FormatName } from "./commands";
import { behaviorExtensions, hopMarker, pictureSelect, insertBlockMarkdown, linkFollow, pasteRules, reflowParagraph, toggleCheckbox, toggleTask, type BehaviorId } from "./behaviors";
import { foldAtCursor, folding, initialFolds } from "./fold";
import { HIGHLIGHTS, openContextMenu } from "./context-menu";
import { linkPopover, type LinkTarget } from "./link-popover";
import { closePopover, setMenuHost, type MenuHost } from "./popover";
import { vim } from "@replit/codemirror-vim";
import { DEFAULT_ICONS, type IconName } from "./icons";
import { markdownLook } from "./highlight";
import { livePreview, refresh, type CellEditor, type CellEvents, type LiveContext } from "./live";

/** The toolbar formats that act on words (so on a table cell's too). */
const INLINE_FORMATS = new Set(["bold", "italic", "strike", "highlight", "code", "link", "math"]);
/** What a table cell's lines can be (what a cell draws as blocks): Turn into offers these there. */
const CELL_BLOCKS: FormatName[] = ["paragraph", "bulletList", "orderedList", "taskList", "quote", "callout"];
/** A list's line in a cell. */
const CELL_LIST = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
import { selectionBar } from "./selection-bar";
import { renderMarkdown } from "./render";
import { cleanHtml } from "./clean";
export { cleanHtml };
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
  /** Play a video (in \`box\`) with the host's own player; without one the browser's controls show. */
  player?(video: HTMLVideoElement, box: HTMLElement, url: string): void;
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
  /** Whether a `[[target]]` reaches anything: one that does not is drawn muted, dashed. Undefined: not known. */
  wikiExists?(target: string): boolean | undefined;
  /** The languages a code block's label offers. */
  languages?: readonly string[];
  /** Math as HTML (`display`: a block of its own). Absent: math stays as written. */
  renderMath?(tex: string, display: boolean): string;
  /** A ```mermaid diagram as SVG. Absent: it stays code. */
  renderDiagram?(code: string): Promise<string>;
  /** What a `[[target]]` names, for the link popover: a note (to read and write in), a picture, or nothing. */
  linkTarget?(target: string): Promise<LinkTarget | null>;
  /** Make the note a link names (the popover's Create). Whether it was made. */
  createNote?(target: string): Promise<boolean>;
  /** `/Page`: a new note, opened. */
  newNote?(): void;
  /** The page's own menu: every list of choices (the right-click menu, a table's, a code block's language) opens there. */
  menu?: MenuHost;
}

export interface EditorLabels {
  live: string; source: string; preview: string; modes: string;
  bold: string; italic: string; strike: string; highlight: string; code: string; link: string;
  heading1: string; heading2: string; heading3: string; paragraph: string;
  bulletList: string; orderedList: string; taskList: string; toggleTask: string; quote: string; codeBlock: string; table: string; rule: string;
  picture: string; find: string; save: string; task: string; placeholder: string; toolbar: string; format: string; insert: string;
  turnInto: string; copyCode: string; copied: string; codeLanguage: string; addRow: string; addColumn: string;
  heading4: string; callout: string; mathBlock: string; math: string; image: string; plainText: string; resize: string; zoomPicture: string; editPicture: string; duplicatePicture: string; removePicture: string; zoomIn: string; zoomOut: string; fit: string; actualSize: string; tableActions: string; moveTable: string; missingEmbed: string; openEmbed: string; findField: string; replaceField: string; findNext: string; findPrevious: string; matchCase: string; regexp: string; wholeWord: string; showReplace: string; replaceOne: string; replaceAll: string; findCount: string; findNone: string;
  today: string; yesterday: string; tomorrow: string; now: string;
  rowAbove: string; rowBelow: string; colBefore: string; colAfter: string; rowUp: string; rowDown: string; colLeft: string; colRight: string;
  dupRow: string; dupCol: string; alignLeft: string; alignCenter: string; alignRight: string; sortUp: string; sortDown: string;
  delRow: string; delCol: string; copyTable: string; duplicateTable: string; tableToList: string; tableToNumbered: string; tableToTasks: string; tableToLines: string; calloutTypes: string;
  page: string; pickDate: string; dateLabel: string; insertDate: string;
  open: string; openNote: string; copyLink: string; highlightIn: string; removeHighlight: string; cut: string; copy: string; paste: string;
  toCallout: string; calloutType: string; removeCallout: string; selectAll: string; undo: string; redo: string; menu: string;
  create: string; missing: string; close: string; detected: string;
  default: string; yellow: string; orange: string; red: string; pink: string; purple: string; blue: string; green: string; gray: string; clearFormat: string;
}

export const DEFAULT_LABELS: EditorLabels = {
  live: "Live", source: "Source", preview: "Preview", modes: "View",
  bold: "Bold", italic: "Italic", strike: "Strikethrough", highlight: "Highlight", code: "Code", link: "Link",
  heading1: "Heading 1", heading2: "Heading 2", heading3: "Heading 3", paragraph: "Text",
  bulletList: "Bulleted list", orderedList: "Numbered list", taskList: "Task list", toggleTask: "Tick task", quote: "Quote", codeBlock: "Code block", table: "Table", rule: "Divider",
  picture: "Picture", find: "Find", save: "Save", task: "Done", placeholder: "Write, or press / for blocks", toolbar: "Formatting", format: "Format", insert: "Insert",
  turnInto: "Turn into", copyCode: "Copy code", copied: "Copied", codeLanguage: "Choose a language", addRow: "Add a row", addColumn: "Add a column",
  heading4: "Heading 4", callout: "Callout", mathBlock: "Math block", math: "Math", image: "Image", plainText: "text", resize: "Drag to resize", zoomPicture: "View full size", editPicture: "Edit its Markdown", duplicatePicture: "Duplicate", removePicture: "Remove from the note", zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit to view", actualSize: "Actual size", tableActions: "Table", moveTable: "Drag to move the table", missingEmbed: "“{name}” could not be found.", openEmbed: "Show the file", findField: "Find", replaceField: "Replace with", findNext: "Next (Enter)", findPrevious: "Previous (Shift+Enter)", matchCase: "Match case", regexp: "Regular expression", wholeWord: "Whole words", showReplace: "Replace", replaceOne: "Replace this one", replaceAll: "Replace all", findCount: "{n} of {m}", findNone: "No results",
  today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow", now: "Now",
  rowAbove: "Add row above", rowBelow: "Add row below", colBefore: "Add column before", colAfter: "Add column after", rowUp: "Move row up", rowDown: "Move row down",
  colLeft: "Move column left", colRight: "Move column right", dupRow: "Duplicate row", dupCol: "Duplicate column", alignLeft: "Align left", alignCenter: "Align center",
  alignRight: "Align right", sortUp: "Sort column (A → Z)", sortDown: "Sort column (Z → A)", delRow: "Delete row", delCol: "Delete column", copyTable: "Copy table as Markdown",
  duplicateTable: "Duplicate table", tableToList: "Turn into bulleted list", tableToNumbered: "Turn into numbered list", tableToTasks: "Turn into task list", tableToLines: "Turn into text", calloutTypes: "Callout type",
  page: "Page", pickDate: "Date…", dateLabel: "Pick any date", insertDate: "Insert",
  open: "Open link", openNote: "Open note", copyLink: "Copy link", highlightIn: "Highlight:", removeHighlight: "Remove highlight", cut: "Cut", copy: "Copy", paste: "Paste",
  toCallout: "Turn into callout…", calloutType: "Change callout type…", removeCallout: "Remove callout", selectAll: "Select all", undo: "Undo", redo: "Redo", menu: "Edit",
  create: "Create note", missing: "No note is named “{name}” yet.", close: "Close", detected: "detected",
  default: "Default", yellow: "Yellow", orange: "Orange", red: "Red", pink: "Pink", purple: "Purple", blue: "Blue", green: "Green", gray: "Gray", clearFormat: "Clear formatting",
};

/** The callout types `> [!` offers: its keyword, colour family and what it is for. */
const CALLOUTS: ReadonlyArray<readonly [string, string]> = [
  ["note", "General note or aside"], ["info", "Informational callout"], ["abstract", "Summary or TL;DR"], ["tip", "Helpful advice"], ["success", "Something that worked"],
  ["question", "A question or FAQ"], ["example", "An example"], ["warning", "Proceed with care"], ["danger", "Something that can go wrong"], ["bug", "A known bug"],
  ["failure", "Something that failed"], ["quote", "A quotation"],
];
/** The languages a code block offers when the host gives none. */
const LANGUAGES = ["bash", "c", "cpp", "csharp", "css", "go", "html", "java", "javascript", "json", "kotlin", "markdown", "php", "python", "ruby", "rust", "sql", "swift", "typescript", "xml", "yaml"];

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
  /** An element of the host's shown at the top of the note, above its first line, in every mode (a note's properties, as notes apps
   *  show them): it is the host's, the editor only places it. */
  top?: HTMLElement;
  /** The keys that switch modes (CodeMirror's names): live or preview (default Mod-e), the source or live (default Mod-Shift-e). */
  modeKeys?: { liveOrPreview?: string; source?: string };
  /** How the host's bindings of those keys read, for the toolbar's tooltips ("Ctrl+E"). */
  keyNames?: { liveOrPreview?: string; source?: string };
  /** Vim keys (normal, insert, visual modes). Default false. */
  vim?: boolean;
  /** Behaviours turned off by their id (behaviors/index.ts): every one is on unless set to false here. */
  behaviors?: Partial<Record<BehaviorId, boolean>>;
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
  /** Put the cursor just after the first place `text` is written, in view (a footnote's definition from an outline). */
  reveal(text: string): boolean;
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
  if (host.menu) setMenuHost(host.menu);
  const labels: EditorLabels = { ...DEFAULT_LABELS, ...opts.labels };
  const icons = { ...DEFAULT_ICONS, ...opts.icons };
  const plain = !!opts.plain;
  /** Whether a behaviour is on (all are, unless the options turn one off; Auto-surround also follows `wrapSelection`). */
  const on = (id: BehaviorId): boolean => opts.behaviors?.[id] !== false && (id !== "wrap-selection" || opts.wrapSelection !== false);
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
  preview.tabIndex = -1; // (focusable: in preview mode the note's keys are pressed there)
  const page = document.createElement("div");
  page.className = "me-page me-doc";
  preview.append(page);
  if (opts.toolbar !== false) el.append(bar);
  el.append(body);
  opts.parent.append(el);

  const liveLayer = new Compartment();
  const lightboxWords = { close: labels.close, zoomIn: labels.zoomIn, zoomOut: labels.zoomOut, fit: labels.fit, actualSize: labels.actualSize };
  /** What live mode draws with (the note's and its tables' cells alike). */
  const liveCtx: LiveContext = {
    ...(host.media ? { media: host.media.bind(host) } : {}),
    ...(host.wikiExists ? { exists: host.wikiExists.bind(host) } : {}),
    ...(host.renderMath ? { renderMath: host.renderMath.bind(host) } : {}),
    ...(host.player ? { player: host.player.bind(host) } : {}),
    wrapSelection: opts.wrapSelection !== false,
    cellEditor: (parent: HTMLElement, text: string, events: CellEvents) => cellEditor(parent, text, events),
    ...(host.renderDiagram ? { renderDiagram: host.renderDiagram.bind(host) } : {}),
    taskLabel: labels.task, copyLabel: labels.copyCode, copiedLabel: labels.copied, languageLabel: labels.codeLanguage, addRowLabel: labels.addRow, addColumnLabel: labels.addColumn,
    tableLabel: labels.tableActions, moveTableLabel: labels.moveTable, languages: host.languages ?? LANGUAGES, resizeLabel: labels.resize, missingLabel: labels.missingEmbed, ...(host.open ? { openMedia: (link: string, embed: boolean) => host.open!({ link, wiki: embed, media: true }) } : {}), pictureWords: { open: labels.openEmbed, duplicate: labels.duplicatePicture, remove: labels.removePicture }, zoomLabel: labels.zoomPicture, editPictureLabel: labels.editPicture, lightboxWords, plainLabel: labels.plainText, detectedLabel: labels.detected,
    tableWords: { rowAbove: labels.rowAbove, rowBelow: labels.rowBelow, colBefore: labels.colBefore, colAfter: labels.colAfter, rowUp: labels.rowUp, rowDown: labels.rowDown, colLeft: labels.colLeft, colRight: labels.colRight, dupRow: labels.dupRow, dupCol: labels.dupCol, alignLeft: labels.alignLeft, alignCenter: labels.alignCenter, alignRight: labels.alignRight, sortUp: labels.sortUp, sortDown: labels.sortDown, delRow: labels.delRow, delCol: labels.delCol, copy: labels.copyTable, duplicate: labels.duplicateTable, toList: labels.tableToList, toNumbered: labels.tableToNumbered, toTasks: labels.tableToTasks, toLines: labels.tableToLines },
  };
  const liveExt = (): Extension => (mode === "live" ? livePreview(liveCtx) : []);

  // `[[` → links, `#` → tags, `/` at a line's start or after a space → blocks.
  const complete = async (cx: CompletionContext): Promise<CompletionResult | null> => {
    const wiki = cx.matchBefore(/!?\[\[[^\[\]\n|]*$/);
    if (wiki && host.links) {
      const open = wiki.text.indexOf("[[") + 2;
      const list = await host.links();
      // (matched by what the name contains, as notes apps do: \`[[.png\` lists the pictures; names starting with it first, then the rest)
      const q = wiki.text.slice(open).toLowerCase();
      const hits = q ? list.filter((l) => l.target.toLowerCase().includes(q) || (l.label ?? "").toLowerCase().includes(q)) : list;
      const starts = (l: (typeof list)[number]): number => (l.target.toLowerCase().startsWith(q) || (l.label ?? "").toLowerCase().startsWith(q) ? 0 : 1);
      return {
        from: wiki.from + open,
        filter: false,
        options: [...hits].sort((x, y) => starts(x) - starts(y)).slice(0, 200).map((l): Completion => ({ label: l.target, displayLabel: l.label ?? l.target, ...(l.detail ? { detail: l.detail } : {}), apply: (view, _c, from, to) => {
          const close = view.state.sliceDoc(to, to + 2) === "]]" ? "" : "]]";
          view.dispatch({ changes: { from, to, insert: `${l.target}${close}` }, selection: { anchor: from + l.target.length + 2 } });
        } })),
      };
    }
    const tag = cx.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_\-/]*$/u);
    if (tag && host.tags && !inCode(cx)) {
      const at = tag.text.indexOf("#");
      const list = await host.tags();
      return { from: tag.from + at + 1, options: list.map((t) => ({ label: t.replace(/\s+/g, "-"), type: "keyword" })), validFor: /^[\p{L}\p{N}_\-/]*$/u };
    }
    // `> [!` in a quote: the callout types.
    const callout = cx.matchBefore(/^\s*>\s?\[!\w*$/);
    if (callout) {
      const at = callout.text.indexOf("[!") + 2;
      return {
        from: callout.from + at,
        options: CALLOUTS.map(([type, what]): Completion => ({ label: type, displayLabel: type.charAt(0).toUpperCase() + type.slice(1), detail: what, type: "keyword", apply: (view, _c, from, to) => {
          const close = view.state.sliceDoc(to, to + 1) === "]" ? 1 : 0;
          view.dispatch({ changes: { from, to: to + close, insert: `${type}] ` }, selection: { anchor: from + type.length + 2 } });
        } })),
        validFor: /^\w*$/,
      };
    }
    // `@`: today's date, yesterday's, tomorrow's, the time now.
    const date = cx.matchBefore(/(?:^|[\s([{}])@[^\s@]*$/);
    if (date && !inCode(cx)) {
      const at = date.text.lastIndexOf("@");
      const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const day = (n: number): Date => new Date(Date.now() + n * 86_400_000);
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const rows: Array<[string, string, string]> = [[labels.today, iso(day(0)), "today"], [labels.yesterday, iso(day(-1)), "yesterday"], [labels.tomorrow, iso(day(1)), "tomorrow"], [labels.now, time, "now time"], [labels.pickDate, labels.dateLabel, "date pick any"]];
      const query = date.text.slice(at + 1).toLowerCase();
      const options = rows.filter(([l, v, k]) => !query || `${l} ${v} ${k}`.toLowerCase().includes(query)).map(([l, v]): Completion => ({ label: l, detail: v, type: "text", apply: (view, _c, _from, to) => {
        const from = date.from + at;
        if (l === labels.pickDate) return void (view.dispatch({ changes: { from, to }, selection: { anchor: from } }), pickDate(view, from));
        view.dispatch({ changes: { from, to, insert: v }, selection: { anchor: from + v.length } });
      } }));
      if (options.length) return { from: date.from + at + 1, options, filter: false };
    }
    // `/` at a line's start or after a space: blocks, then the host's rows (templates, a picture of its library).
    const slash = cx.matchBefore(/(?:^|\s)\/[^\s]*$/);
    if (slash && !inCode(cx)) {
      const at = slash.text.indexOf("/");
      const start = slash.from + at;
      const block = (label: string, detail: string, insert: string, back = 0, keywords = "", boost = 0, pad = false): Completion => ({
        label: keywords ? `${label} ${keywords}` : label, displayLabel: label, detail, type: "text", ...(boost ? { boost } : {}),
        apply: (view, _c, _from, to) => {
          // (a table stands apart from the words round it, as a table must)
          const before = pad && view.state.sliceDoc(view.state.doc.lineAt(start).from, start).trim() ? "\n\n" : pad && view.state.doc.lineAt(start).number > 1 && view.state.doc.line(view.state.doc.lineAt(start).number - 1).text.trim() ? "\n" : "";
          const after = pad && view.state.sliceDoc(to, view.state.doc.lineAt(to).to).trim() ? "\n\n" : pad ? "\n" : "";
          const text = before + insert + after;
          view.dispatch({ changes: { from: start, to, insert: text }, selection: { anchor: start + text.length - back - (pad ? 0 : 0) } });
        },
      });
      const own: Completion[] = [
        block(labels.heading1, "#", "# "), block(labels.heading2, "##", "## "), block(labels.heading3, "###", "### "), block(labels.heading4, "####", "#### "),
        block(labels.taskList, "[ ]", "- [ ] ", 0, "todo to-do checkbox check task list", 99),
        block(labels.bulletList, "-", "- "), block(labels.orderedList, "1.", "1. "), block(labels.quote, ">", "> "),
        block(labels.codeBlock, "```", "```\n\n```", 4), block(labels.rule, "---", "---\n"),
        block(labels.table, "|", "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |", 0, "", 0, true),
        block(labels.mathBlock, "$$", "$$\n\n$$", 3), block(labels.callout, ">", "> [!note]\n> "),
        block(labels.link, "[]", "[]()", 3), block(labels.image, "![]", "![]()", 3),
      ];
      if (host.newNote) own.push({ label: `${labels.page} new note`, displayLabel: labels.page, detail: "new note", type: "text", apply: (view, _c, _from, to) => {
        view.dispatch({ changes: { from: start, to } });
        host.newNote!();
      } });
      if (host.choosePicture) own.push({ label: labels.picture, detail: "", type: "text", apply: (view, _c, _from, to) => {
        view.dispatch({ changes: { from: start, to } });
        void pickPicture();
      } });
      const extra = host.slash ? await host.slash() : [];
      for (const item of extra) own.push({ label: item.label, ...(item.detail ? { detail: item.detail } : {}), type: "text", apply: (view, _c, _from, to) => {
        view.dispatch({ changes: { from: start, to } });
        void item.pick(self);
      } });
      return { from: start + 1, options: own, validFor: /^[^\s]*$/ };
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
    { key: "Shift-Mod-s", run: COMMANDS.strike },
    { key: "Shift-Mod-h", run: COMMANDS.highlight },
    { key: "Shift-Mod-m", run: COMMANDS.math },
    { key: "Mod-k", run: COMMANDS.link },
    ...(on("task-toggle") ? [{ key: "Mod-l", run: toggleCheckbox }] : []),
    ...(on("marker-hop") ? [{ key: "Alt-]", mac: "Ctrl-.", run: hopMarker(1) }, { key: "Alt-[", mac: "Ctrl-,", run: hopMarker(-1) }] : []),
    { key: "Mod-Alt-f", run: foldAtCursor(true) },
    { key: "Mod-Alt-u", run: foldAtCursor(false) },
    ...(on("reflow") ? [{ key: "Alt-q", mac: "Ctrl-q", run: reflowParagraph }] : []),
    { key: "Shift-Mod-k", run: () => popover?.atCursor() ?? false },
    { key: "Shift-F10", run: (v: EditorView) => (menuAtCursor(v), true) },
    { key: "ContextMenu", run: (v: EditorView) => (menuAtCursor(v), true) },
  ];
  const appKeys = keymap.of([
    { key: "Mod-s", preventDefault: true, run: () => (host.save?.(), true) },
    // (live editing and preview, one then the other; the source, or back to live: as notes apps switch them; a host may rebind them)
    { key: opts.modeKeys?.liveOrPreview ?? "Mod-e", preventDefault: true, run: () => (plain ? false : (setModeBy(mode === "preview" ? "live" : "preview"), true)) },
    { key: opts.modeKeys?.source ?? "Mod-Shift-e", preventDefault: true, run: () => (plain ? false : (setModeBy(mode === "source" ? "live" : "source"), true)) },
    { key: "Mod-4", preventDefault: true, run: () => (plain ? false : (setModeBy("live"), true)) },
    { key: "Mod-5", preventDefault: true, run: () => (plain ? false : (setModeBy("source"), true)) },
    { key: "Mod-6", preventDefault: true, run: () => (plain ? false : (setModeBy("preview"), true)) },
  ]);

  /**
   * How the editor reads, looks and acts: keys, behaviours, the format bar, completion, pastes, links. The note and each table cell it is
   * editing are built from this one list, so whatever the note does a cell does too; a cell leaves out only what has no meaning on a cell's
   * one line (its own history, search, folds, the drawing of blocks) and the right-click menu, which is the table's there.
   */
  const editorSetup = (cell: boolean): Extension[] => {
    const out: Extension[] = [
      drawSelection(),
      EditorView.theme(CM_THEME),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
      appKeys,
      keymap.of([...(plain ? [] : formatKeys), ...(cell ? [] : searchKeymap), ...historyKeymap, ...defaultKeymap, ...(cell ? [] : [indentWithTab])]),
      ...behaviorExtensions(on, plain),
      ...(on("paste-rules") ? [pasteRules(host, plain)] : []),
      ...(on("link-follow") ? [linkFollow((t) => (host.open ? (host.open(followed(t)), true) : false), () => mode === "live")] : []),
    ];
    // shortcut: no Vim keys in a table cell (its Escape and Enter move between cells); give cells Vim's modes if Vim users ask for them.
    if (opts.vim && !plain && !cell) out.unshift(Prec.highest(vim()));
    if (!plain) {
      out.push(markdown({ base: markdownLanguage, extensions: EXTENSIONS, addKeymap: !cell }), markdownLook, selectionBar({ icons, labels: labels as unknown as Record<string, string>, ...(cell ? { turnInto: CELL_BLOCKS } : {}) }), autocompletion({ override: [complete], icons: false, activateOnTyping: true }));
      if (host.codeSpans) out.push(codeColours(host.codeSpans));
      // (pictures: in a table cell's editor too, so a picture in a cell is selected, sized and opened as in the note)
      if (on("picture-select")) out.push(pictureSelect(lightboxWords, () => mode === "live"));
    }
    return out;
  };
  const extensions: Extension[] = [
    history(),
    search({ top: true, createPanel: findBar({ find: labels.findField, replace: labels.replaceField, next: labels.findNext, previous: labels.findPrevious, matchCase: labels.matchCase, regexp: labels.regexp, wholeWord: labels.wholeWord, showReplace: labels.showReplace, replaceOne: labels.replaceOne, replaceAll: labels.replaceAll, close: labels.close, count: labels.findCount, none: labels.findNone }) }),
    placeholderExt(labels.placeholder),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !silent) opts.onChange?.(u.state.sliceDoc());
    }),
    ...editorSetup(false),
    EditorView.domEventHandlers({
      contextmenu: (e, v) => {
        if (plain) return false;
        e.preventDefault();
        // (a right click outside the selection moves the cursor there first, as an editor does)
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
        const sel = v.state.selection.main;
        if (pos !== null && (pos < sel.from || pos > sel.to)) v.dispatch({ selection: { anchor: pos } });
        openContextMenu(v, { x: e.clientX, y: e.clientY }, menuWords, CALLOUTS.map(([t]) => t), (link, wiki) => host.open?.({ link, wiki, media: false }));
        return true;
      },
    }),
  ];
  // (the line the cursor is in, tinted while the note has the focus: where you are, as the first notes editor showed it; not on hover)
  if (!plain) extensions.push(folding, liveLayer.of(liveExt()), highlightActiveLine());
  if (opts.top) extensions.push(topBlock(opts.top));

  /** The table cell being edited, if any: the toolbar's formats act on it. */
  let activeCell: EditorView | null = null;
  /**
   * A table cell's editor: a window onto the cell's text in the note. It is built from the note's own setup (above), and every change in it
   * is written straight into the note at the cell's place, so there is one document and one history: Ctrl+Z in a cell is the note's undo.
   * Only moving is the table's: Tab and Shift+Tab to the next or previous cell, Enter down a row, Escape out; Shift+Enter a line break.
   */
  const cellEditor = (parent: HTMLElement, text: string, events: CellEvents): CellEditor => {
    let syncing = false;
    const cellView: EditorView = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          Prec.highest(keymap.of([
            { key: "Tab", run: () => (events.move("next"), true) },
            { key: "Shift-Tab", run: () => (events.move("prev"), true) },
            // (Enter on a list's line adds the next item, as in the note; elsewhere it goes down a row. Shift+Enter: a new line in the cell)
            // (with suggestions open, Enter and Escape are theirs: a [[ link chosen, or the list closed)
            { key: "Enter", run: (v) => (completionStatus(v.state) === "active" || CELL_LIST.test(v.state.doc.lineAt(v.state.selection.main.head).text) ? false : (events.move("down"), true)) },
            { key: "Shift-Enter", run: (v) => (v.dispatch(v.state.replaceSelection("\n"), { scrollIntoView: true, userEvent: "input" }), true) },
            { key: "Escape", run: (v) => (completionStatus(v.state) ? false : (events.move("out"), true)) },
            { key: "Mod-z", preventDefault: true, run: () => (undo(view), true) },
            { key: "Mod-y", preventDefault: true, run: () => (redo(view), true) },
            { key: "Mod-Shift-z", preventDefault: true, run: () => (redo(view), true) },
          ])),
          ...editorSetup(true),
          mode === "live" ? livePreview({ ...liveCtx, inline: true }) : [],
          EditorView.theme({ ".cm-content": { padding: "0", maxWidth: "none" }, ".cm-scroller": { padding: "0" }, "&": { background: "transparent" } }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !syncing) events.change(u.state.doc.toString(), u.transactions.map((t) => t.annotation(Transaction.userEvent)).find(Boolean) ?? "input");
            if (u.focusChanged) activeCell = u.view.hasFocus ? u.view : activeCell === u.view ? null : activeCell;
          }),
          EditorView.domEventHandlers({ blur: () => void setTimeout(() => !cellView.dom.isConnected || cellView.hasFocus || events.blur()) }),
        ],
      }),
    });
    let anchor = 0;
    return {
      focus(at) {
        cellView.focus();
        const pos = at ? cellView.posAtCoords(at) : null;
        anchor = pos ?? cellView.state.doc.length;
        cellView.dispatch({ selection: { anchor } });
      },
      extend(to) {
        const head = cellView.posAtCoords(to);
        if (head !== null) cellView.dispatch({ selection: { anchor, head } });
      },
      text: () => cellView.state.doc.toString(),
      refocus: () => cellView.focus(),
      setText(next) {
        // (the note changed under the cell, an undo or another view: the smallest change, the cursor kept where it can be)
        const cur = cellView.state.doc.toString();
        if (cur === next) return;
        let a = 0;
        while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
        let b = 0;
        while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
        syncing = true;
        try {
          cellView.dispatch({ changes: { from: a, to: cur.length - b, insert: next.slice(a, next.length - b) } });
        } finally {
          syncing = false;
        }
      },
      destroy() {
        if (activeCell === cellView) activeCell = null;
        cellView.destroy();
      },
    };
  };
  // (a file's own line ends are kept: one written with CR LF throughout is saved so)
  const lineEnds = (text: string): Extension => (/\r\n/.test(text) && !/(^|[^\r])\n/.test(text) ? EditorState.lineSeparator.of("\r\n") : []);
  const stateOf = (text: string): EditorState => EditorState.create({ doc: text, extensions: [extensions, lineEnds(text)] });
  const view = new EditorView({ state: stateOf(opts.value ?? ""), parent: body });
  if (!plain) initialFolds(view);
  // The link popover: a wiki link's note in a small editor, to read and write in.
  const popover = !plain && host.linkTarget
    ? linkPopover(view, {
        find: (t) => host.linkTarget!(t),
        ...(host.createNote ? { create: (t: string) => host.createNote!(t) } : {}),
        open: (t) => host.open?.({ link: t, wiki: true, media: false }),
        editor: (parent, text, onChange) => {
          const mini = createMarkdownEditor({ parent, value: text, mode: "live", toolbar: false, host: { ...host, linkTarget: undefined as never, save: undefined as never }, labels, icons, onChange });
          return { focus: () => mini.focus(), destroy: () => mini.destroy() };
        },
        words: { open: labels.openNote, create: labels.create, missing: labels.missing, close: labels.close },
      })
    : null;
  body.append(preview);

  const followed = (t: HTMLElement): FollowedLink => {
    if (t.hasAttribute("data-wiki")) return { link: t.getAttribute("data-wiki")!, wiki: true, media: false };
    if (t.hasAttribute("data-embed")) return { link: t.getAttribute("data-embed")!, wiki: true, media: true };
    if (t.hasAttribute("data-src")) return { link: t.getAttribute("data-src")!, wiki: false, media: true };
    return { link: t.getAttribute("data-href") ?? t.getAttribute("href") ?? "", wiki: false, media: false };
  };

  const insertAt = (v: EditorView, md: string): void => {
    v.dispatch(v.state.replaceSelection(md), { scrollIntoView: true, userEvent: "input.paste" });
  };
  const menuWords = {
    open: labels.open, openNote: labels.openNote, copyLink: labels.copyLink, highlight: labels.highlight, highlightIn: labels.highlightIn, removeHighlight: labels.removeHighlight,
    cut: labels.cut, copy: labels.copy, paste: labels.paste, toCallout: labels.toCallout, calloutType: labels.calloutType, removeCallout: labels.removeCallout,
    selectAll: labels.selectAll, undo: labels.undo, redo: labels.redo, menu: labels.menu,
    colours: Object.fromEntries(HIGHLIGHTS.map((c) => [c, labels[c]])),
  };
  /** The right-click menu opened from the keyboard, at the cursor. */
  const menuAtCursor = (v: EditorView): void => {
    const r = v.coordsAtPos(v.state.selection.main.head);
    openContextMenu(v, { x: r?.left ?? 0, y: r?.bottom ?? 0 }, menuWords, CALLOUTS.map(([t]) => t), (link, wiki) => host.open?.({ link, wiki, media: false }));
  };
  /** `@` → Date…: a date chosen in a small calendar, written where the `@` was. */
  const pickDate = (v: EditorView, at: number): void => {
    const r = v.coordsAtPos(at);
    const box = document.createElement("div");
    box.className = "me-pop me-date";
    box.style.left = `${r?.left ?? 0}px`;
    box.style.top = `${(r?.bottom ?? 0) + 4}px`;
    const input = document.createElement("input");
    input.type = "date";
    input.setAttribute("aria-label", labels.dateLabel);
    input.value = new Date().toISOString().slice(0, 10);
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "me-pop-item";
    ok.textContent = labels.insertDate;
    const done = (put: boolean): void => {
      if (put && input.value) v.dispatch({ changes: { from: Math.min(at, v.state.doc.length), insert: input.value }, selection: { anchor: Math.min(at, v.state.doc.length) + input.value.length } });
      box.remove();
      v.focus();
    };
    // typing: (writes the chosen date into the note)
    ok.addEventListener("click", () => done(true));
    input.addEventListener("keydown", (e) => (e.key === "Enter" ? (e.preventDefault(), done(true)) : e.key === "Escape" ? (e.preventDefault(), done(false)) : undefined));
    box.append(input, ok);
    document.body.append(box);
    input.focus();
  };
  const pickPicture = async (): Promise<void> => {
    const md = await host.choosePicture?.();
    if (md) insertBlockMarkdown(view, md);
  };

  // Preview mode: the text drawn as a page. A click on a link follows it; a click on a task's box ticks it in the text.
  const drawPreview = (): void => {
    page.innerHTML = cleanHtml(renderMarkdown(view.state.sliceDoc(), { html: true, taskOffsets: true, taskLabel: labels.task, wikiHref: () => "#" }));
    if (opts.top) page.prepend(opts.top);
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
    for (const m of page.querySelectorAll<HTMLElement>(".math[data-tex]")) {
      if (!host.renderMath) break;
      try {
        m.innerHTML = host.renderMath(m.dataset["tex"]!, m.classList.contains("math-block"));
      } catch {
        /* (left as written) */
      }
    }
    for (const pre of page.querySelectorAll<HTMLElement>("pre.language-mermaid")) {
      if (!host.renderDiagram) break;
      const code = pre.textContent ?? "";
      void host.renderDiagram(code).then((svg) => {
        const d = document.createElement("div");
        d.className = "me-diagram";
        d.innerHTML = svg;
        pre.replaceWith(d);
      }, () => undefined);
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
      preview.focus({ preventScroll: true }); // (the box clicked is gone with the page drawn again: the keys stay the note's)
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
  const KEYS: Partial<Record<string, string>> = { bold: `${mod}B`, italic: `${mod}I`, strike: `${mod}Shift+S`, highlight: `${mod}Shift+H`, link: `${mod}K`, taskList: `${mod}L`, find: `${mod}F`, save: `${mod}S`, live: opts.keyNames?.liveOrPreview ?? `${mod}E`, source: opts.keyNames?.source ?? `${mod}Shift+E`, preview: opts.keyNames?.liveOrPreview ?? `${mod}E` };
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
    // (in a table cell the words' own formats act on the cell; a block's have no place on a cell's line)
    if (activeCell && INLINE_FORMATS.has(name)) return void (COMMANDS[name as FormatName]?.(activeCell), activeCell.focus());
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
    else if (opts.top && !view.contentDOM.contains(opts.top)) view.dispatch({ effects: placeTop.of(null) });
    syncBar();
  };
  const setModeBy = (m: EditorMode): void => {
    if (m === mode || plain) return;
    mode = m;
    applyMode();
    opts.onMode?.(m);
    // (the focus stays in the note: the words, or the preview's page, so its keys go on working, a mode key pressed again too)
    if (m !== "preview") view.focus();
    else preview.focus({ preventScroll: true });
  };

  // Ctrl+4 and Ctrl+5 from preview mode, where the text (and its keys) are hidden.
  // view-state: (switches how the note is shown)
  el.addEventListener("keydown", (e) => {
    if (mode !== "preview" || plain || e.altKey || e.shiftKey || !(isMac ? e.metaKey : e.ctrlKey) || (e.key !== "4" && e.key !== "5")) return;
    e.preventDefault();
    e.stopPropagation();
    setModeBy(e.key === "4" ? "live" : "source");
  }, true);
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
    reveal(text) {
      const at = view.state.doc.toString().indexOf(text);
      if (at < 0) return false;
      if (mode === "preview") setModeBy("live");
      view.dispatch({ selection: { anchor: at + text.length }, scrollIntoView: true });
      view.focus();
      return true;
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
      popover?.destroy();
      closePopover();
      view.destroy();
      el.remove();
    },
  };
  return self;
}



/** Places the host's top element again (after the preview had it). */
const placeTop = StateEffect.define<null>();
/** The host's element at the top of the note: a block before its first line (its own events, never the editor's). */
function topBlock(el: HTMLElement): Extension {
  class Top extends WidgetType {
    constructor(readonly n: number) {
      super();
    }
    override eq(o: Top): boolean {
      return o.n === this.n;
    }
    override toDOM(): HTMLElement {
      return el;
    }
    override ignoreEvent(): boolean {
      return true;
    }
    override destroy(): void {
      // (the element is the host's: kept for the next time it is placed)
    }
  }
  let n = 0;
  const make = (): DecorationSet => Decoration.set([Decoration.widget({ widget: new Top(n++), block: true, side: -1 }).range(0)]);
  return StateField.define<DecorationSet>({
    create: make,
    update: (d, tr) => (tr.effects.some((e) => e.is(placeTop)) ? make() : d.map(tr.changes)),
    provide: (f) => EditorView.decorations.from(f),
  });
}
