// Live mode: the Markdown is the text being edited, shown as it reads. Once the editor has been focused, the lines the selection is on
// show their marks (a heading's `#`, `**`, a quote's `>`, a list's `-`, a task's `[ ]`, a picture's source); links, wiki links and
// highlights show theirs only where the selection touches them. Elsewhere marks are hidden and pictures, task boxes, rules, callouts,
// code cards and tables are drawn. Source mode is the same editor without this layer.
import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { toggleTask } from "./behaviors/task-toggle";
import { deletePicture, duplicatePicture, pictureEdit, selectedPicture, setPictureEdit, setPictureWidth, viewPicture } from "./behaviors/picture-select";
import { readAlt } from "./picture-alt";
import type { LightboxWords } from "./lightbox";
import { tableField } from "./table";
import { openPopover } from "./popover";
import { guessLanguage } from "./detect";

/** What live mode asks of the host. */
export interface LiveContext {
  /** A picture for a link as written (`cat.png`) or an embed's target (`![[cat.png]]`): an address the page can show, and its type. */
  media?: (link: string, embed: boolean) => Promise<{ url: string; type: string } | null>;
  /** Words for the task box (screen readers) and the code card's and table's buttons. */
  taskLabel: string;
  copyLabel: string;
  copiedLabel: string;
  languageLabel: string;
  addRowLabel: string;
  addColumnLabel: string;
  tableLabel: string;
  /** The grip that moves a whole table. */
  moveTableLabel: string;
  tableWords: TableWords;
  /** The languages a code block's label offers. */
  languages: readonly string[];
  /** Math as HTML (`display`: a block of its own); absent, math stays as written. */
  renderMath?: (tex: string, display: boolean) => string;
  /** A diagram (a ```mermaid block) as SVG; absent, it stays code. */
  renderDiagram?: (code: string) => Promise<string>;
  /** Play a video with the host's own player (else the browser's controls). */
  player?: (video: HTMLVideoElement, box: HTMLElement, url: string) => void;
  /** A table cell's editor (a window onto the cell's text in the note): Tab, Enter and Escape \`move\` on. */
  cellEditor?: (parent: HTMLElement, text: string, on: CellEvents) => CellEditor;
  /** Only what is drawn in a line's words (a table cell's editor): no tables or other blocks. */
  inline?: boolean;
  /** A pair's sign typed over selected words goes round them (Settings). */
  wrapSelection?: boolean;
  /** Whether a wiki link's target reaches anything (undefined: not known). */
  exists?: (target: string) => boolean | undefined;
  /** Words for a picture's resize handle and the "no language" choice. */
  resizeLabel: string;
  /** A picture's buttons (its file never changes): duplicate it, take it out of the note. */
  pictureWords: { open: string; duplicate: string; remove: string };
  /** Show the item an embed or picture is (the library's file), from its tools. */
  openMedia?: (link: string, embed: boolean) => void;
  /** What an embed that finds nothing says: "“{name}” could not be found." */
  missingLabel: string;
  /** A picture's buttons: full size, edit its Markdown; and the full-size view's close button. */
  zoomLabel: string;
  editPictureLabel: string;
  lightboxWords: LightboxWords;
  plainLabel: string;
  detectedLabel: string;
}

/** What a table cell's editor reports. */
export interface CellEvents {
  move(to: "next" | "prev" | "down" | "out"): void;
  /** The cell's text changed (its lines are the file's <br>): written into the note at the cell's place. */
  change(text: string, userEvent: string): void;
  blur(): void;
}

/** A table cell's editor, as the table drives it. */
export interface CellEditor {
  /** Focus it, the cursor where `at` points (else at the end). */
  focus(at?: { x: number; y: number }): void;
  /** Select from where it was pressed to `to` (a drag in the cell). */
  extend(to: { x: number; y: number }): void;
  text(): string;
  /** The note changed under it (an undo): its words follow. */
  setText(text: string): void;
  /** Take the focus back, the cursor kept (the table was drawn again round it). */
  refocus(): void;
  destroy(): void;
}

/** The words of a table's actions. */
export interface TableWords {
  rowAbove: string; rowBelow: string; colBefore: string; colAfter: string; rowUp: string; rowDown: string; colLeft: string; colRight: string;
  dupRow: string; dupCol: string; alignLeft: string; alignCenter: string; alignRight: string; sortUp: string; sortDown: string;
  delRow: string; delCol: string; copy: string; duplicate: string; toList: string; toNumbered: string; toTasks: string; toLines: string;
}

/** Ask for the decorations again (a picture or colours arrived). */
export const refresh = StateEffect.define<null>();

/**
 * Whether the selection reveals marks: not until the editor has taken the focus (a note opened, or sitting in a panel, reads as a page),
 * then from that focus on, a blur included (a menu or a dialog over a note being written must not redraw the line under the cursor).
 */
const setRevealing = StateEffect.define<boolean>();
const revealing = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((was, e) => (e.is(setRevealing) ? e.value : was), v),
});
const revealOnFocus: Extension = [
  revealing,
  EditorView.focusChangeEffect.of((state, on) => (on && !state.field(revealing, false) ? setRevealing.of(true) : null)),
  // (at once, not on the focus notice a moment later: the cursor's line would show rendered for a frame first)
  EditorView.domEventObservers({
    focus: (_e, view) => queueMicrotask(() => void (view.hasFocus && !view.state.field(revealing, false) && view.dispatch({ effects: setRevealing.of(true) }))),
  }),
];
/** Whether a transaction turned revealing on or off. */
export const revealChanged = (u: ViewUpdate): boolean => u.startState.field(revealing, false) !== u.state.field(revealing, false);
/** The selection's ranges that reveal: none until the editor has been focused. */
const revealed = (state: EditorState) => (state.field(revealing, false) ? state.selection.ranges : []);
/** The lines the selection is on. */
export function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const r of revealed(state)) for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) out.add(l);
  return out;
}
/** Whether the selection touches `from`…`to` (a cursor at either end counts). */
export const touches = (state: EditorState, from: number, to: number): boolean =>
  revealed(state).some((r) => (r.empty ? r.from >= from && r.from <= to : Math.max(r.from, from) < Math.min(r.to, to)));

const hide = Decoration.replace({});

/** The widget each drawn picture is now (a picture kept on the page as its Markdown moves reads where it is from here). */
const drawnAs = new WeakMap<HTMLElement, MediaWidget>();

/**
 * A picture (or a file's name when it is not one) drawn where its Markdown is, always (its Markdown shows only while it is edited: Enter,
 * or the edit button). A click selects it (an outline); on it, a button opens it full size, one edits its Markdown, and the handle at its
 * corner sets its width (behaviors/picture-select.ts has its keys).
 */
class MediaWidget extends WidgetType {
  constructor(readonly link: string, readonly alt: string, readonly embed: boolean, readonly width: number | null, readonly ctx: LiveContext, readonly at?: { from: number; to: number }, readonly selected = false) {
    super();
  }
  override eq(o: MediaWidget): boolean {
    return o.link === this.link && o.alt === this.alt && o.embed === this.embed && o.width === this.width && o.at?.from === this.at?.from && o.at?.to === this.at?.to && o.selected === this.selected;
  }
  /** The same picture moved or (de)selected: kept as it is drawn, not loaded again. */
  override updateDOM(dom: HTMLElement): boolean {
    const was = drawnAs.get(dom);
    if (!was || was.link !== this.link || was.embed !== this.embed || was.width !== this.width || was.alt !== this.alt) return false;
    drawnAs.set(dom, this);
    this.mark(dom);
    return true;
  }
  private mark(box: HTMLElement): void {
    box.classList.toggle("is-selected", this.selected);
    if (this.at) box.dataset["from"] = String(this.at.from);
  }
  override toDOM(view?: EditorView): HTMLElement {
    const box = document.createElement("span");
    box.className = "me-media";
    box.setAttribute(this.embed ? "data-embed" : "data-src", this.link);
    drawnAs.set(box, this);
    this.mark(box);
    const name = this.alt || decodeURIComponent(this.link.split(/[/\\]/).pop() ?? this.link);
    box.textContent = name;
    const now = (): MediaWidget => drawnAs.get(box) ?? this;
    if (view && this.at) {
      // view-state: (a press on the picture selects it, as one piece of the note; a press on its buttons or handle is theirs)
      box.addEventListener("mousedown", (e) => {
        // (only the picture or video itself: a host's player bar under a video keeps its own presses)
        const t = e.target as HTMLElement;
        if (e.button !== 0 || t.closest(".me-media-tools, .me-resize") || !(t === box || t instanceof HTMLImageElement || t instanceof HTMLVideoElement)) return;
        e.preventDefault();
        const at = now().at!;
        view.dispatch({ selection: { anchor: at.from, head: at.to }, effects: setPictureEdit.of(null) });
        view.focus();
      });
    }
    void this.ctx.media?.(this.link, this.embed).then((got) => {
      if (!box.isConnected) return;
      // (a picture or file that is nowhere: a box that says so, as notes apps show it)
      if (!got) return void (box.classList.add("is-missing"), (box.textContent = this.ctx.missingLabel.replace("{name}", name)));
      const kind = got.type.split("/")[0];
      if (kind !== "image" && kind !== "video" && kind !== "audio") return;
      box.textContent = "";
      const el = kind === "video" ? document.createElement("video") : kind === "audio" ? document.createElement("audio") : document.createElement("img");
      if (el instanceof HTMLImageElement) el.alt = name;
      if (this.width) el.style.width = `${this.width}px`;
      box.append(el);
      // (a video plays in the host's player when it has one; a picture and a video are sized by the handle at their corner)
      if (el instanceof HTMLVideoElement && this.ctx.player) {
        box.classList.add("is-video");
        this.ctx.player(el, box, got.url);
      } else {
        if (!(el instanceof HTMLImageElement)) el.controls = true;
        el.src = got.url;
      }
      // (one frame for a picture and a video alike: its tools and its handle; on a small one the tools stand above it, readable)
      if (kind !== "audio" && this.at && view) {
        box.append(this.tools(box, view, now, kind === "image"), this.resizer(el, view, now));
        const small = (): void => void box.classList.toggle("is-small", el.getBoundingClientRect().width < 260);
        new ResizeObserver(small).observe(el);
      }
    });
    return box;
  }
  /** The buttons on a picture: full size, and edit its Markdown. */
  private tools(box: HTMLElement, view: EditorView, now: () => MediaWidget, picture = true): HTMLElement {
    const bar = document.createElement("span");
    bar.className = "me-media-tools";
    const button = (cls: string, label: string, icon: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `me-btn ${cls}`;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = icon;
      // view-state: (the button keeps the note's focus)
      b.addEventListener("mousedown", (e) => (e.preventDefault(), e.stopPropagation()));
      // view-state: (full size changes nothing in the note; edit shows the picture's Markdown with the cursor in it)
      b.addEventListener("click", (e) => (e.stopPropagation(), run()));
      return b;
    };
    const at = (): { from: number; to: number } => now().at!;
    const ICON = (d: string): string => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    // (what a picture can have done to it without its file changing: copied, taken out of the note)
    bar.append(
      ...(this.ctx.openMedia ? [button("me-media-open", this.ctx.pictureWords.open, ICON('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'), () => this.ctx.openMedia!(now().link, now().embed))] : []),
      button("me-media-copy", this.ctx.pictureWords.duplicate, ICON('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>'), () => duplicatePicture(view, at())),
      button("me-media-delete", this.ctx.pictureWords.remove, ICON('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'), () => deletePicture(view, at())),
    );
    bar.append(
      // (full size: a picture's; a video plays where it is)
      ...(picture ? [button("me-media-zoom", this.ctx.zoomLabel, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/></svg>', () => void viewPicture(view, now().at!.from, this.ctx.lightboxWords))] : []),
      button("me-media-edit", this.ctx.editPictureLabel, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>', () => {
        const at = now().at!;
        view.dispatch({ effects: setPictureEdit.of(at.from), selection: { anchor: at.to } });
        view.focus();
      }),
    );
    return bar;
  }
  /** A handle at the picture's corner: dragged, the picture's width is written into its Markdown (`![alt|300](…)`, `![[cat.png|300]]`). */
  private resizer(img: HTMLElement, view: EditorView, now: () => MediaWidget): HTMLElement {
    const h = document.createElement("span");
    h.className = "me-resize";
    h.title = this.ctx.resizeLabel;
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = img.getBoundingClientRect().width;
      let w = w0;
      const move = (ev: PointerEvent): void => {
        w = Math.max(32, Math.round(w0 + ev.clientX - x0));
        img.style.width = `${w}px`;
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", () => {
        h.removeEventListener("pointermove", move);
        setPictureWidth(view, now().at!, w);
      }, { once: true });
    });
    return h;
  }
  /** A press on the picture is the editor's (it selects it); one on a control (a host's player bar, its sliders, the tools) is the control's. */
  override ignoreEvent(e: Event): boolean {
    return e.target instanceof Element && !!e.target.closest("input, button, select, .me-media-tools, .me-resize, [role=toolbar]");
  }
}
/** A picture drawn for any widget's page (a table's cells). */
export const mediaElement = (ctx: LiveContext, link: string, alt: string, embed: boolean, width: number | null = null): HTMLElement => new MediaWidget(link, alt, embed, width, ctx).toDOM();

/** The note's footnotes: each reference's number (by its first use, inline ones counted where they stand), and each definition's words and place. */
interface Footnotes {
  number: Map<string, number>;
  inline: Map<number, number>;
  defs: Map<string, { text: string; at: number }>;
}
const footnoteCache = new WeakMap<object, Footnotes>();
function footnotesOf(state: EditorState): Footnotes {
  const hit = footnoteCache.get(state.doc);
  if (hit) return hit;
  const f: Footnotes = { number: new Map(), inline: new Map(), defs: new Map() };
  const doc = state.doc.toString();
  let n = 0;
  for (const m of doc.matchAll(/\[\^([^\]\s]+)\](?!:)|\^\[/g)) {
    if (m[1] === undefined) f.inline.set(m.index!, ++n);
    else if (!f.number.has(m[1])) f.number.set(m[1], ++n);
  }
  for (const m of doc.matchAll(/^\[\^([^\]\s]+)\]:[ \t]?(.*)$/gm)) f.defs.set(m[1]!, { text: m[2]!, at: m.index! });
  footnoteCache.set(state.doc, f);
  return f;
}

/** A footnote's number, raised: its words on hover; a click on a reference goes to its definition. */
class FootnoteWidget extends WidgetType {
  constructor(readonly n: number, readonly words: string, readonly label: string | null) {
    super();
  }
  override eq(o: FootnoteWidget): boolean {
    return o.n === this.n && o.words === this.words && o.label === this.label;
  }
  override toDOM(view: EditorView): HTMLElement {
    const s = document.createElement("sup");
    s.className = "me-fn";
    s.textContent = String(this.n || "?");
    if (this.words) s.title = this.words;
    if (this.label !== null) {
      const label = this.label;
      // view-state: (goes to the footnote's words: moves the cursor there)
      s.addEventListener("mousedown", (e) => {
        const def = footnotesOf(view.state).defs.get(label);
        if (!def) return;
        e.preventDefault();
        view.dispatch({ selection: { anchor: def.at + `[^${label}]: `.length }, scrollIntoView: true });
        view.focus();
      });
    }
    return s;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** A coloured highlight's tag at the cursor, drawn as notes apps show it: `==` and, at its start, a dot of its colour. */
class HighlightMark extends WidgetType {
  constructor(readonly colour: string, readonly open: boolean) {
    super();
  }
  override eq(o: HighlightMark): boolean {
    return o.colour === this.colour && o.open === this.open;
  }
  override toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "me-t-mark me-hl-tag";
    s.textContent = "==";
    if (this.open) {
      const dot = document.createElement("span");
      dot.className = `me-hl-dot me-hl-${this.colour}`;
      s.append(dot);
    }
    return s;
  }
}

/** A task's box: a click ticks it in the text. */
class TaskWidget extends WidgetType {
  constructor(readonly on: boolean, readonly at: number, readonly label: string) {
    super();
  }
  override eq(o: TaskWidget): boolean {
    return o.on === this.on && o.at === this.at;
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "me-task-box";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "me-task";
    box.checked = this.on;
    box.setAttribute("aria-label", this.label);
    // typing: (ticking the box is writing the note's text)
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      toggleTask(view, this.at);
    });
    wrap.append(box);
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** A task in another state: cancelled (✕), in progress (half full, ticked off by a click) or forwarded (→). */
class TaskState extends WidgetType {
  constructor(readonly kind: string, readonly at: number, readonly label: string) {
    super();
  }
  override eq(o: TaskState): boolean {
    return o.kind === this.kind && o.at === this.at;
  }
  override toDOM(view: EditorView): HTMLElement {
    const s = document.createElement("span");
    s.className = `me-task-box me-task-state me-task-${this.kind === "-" ? "cancelled" : this.kind === "/" ? "progress" : "forwarded"}`;
    s.setAttribute("aria-label", this.label);
    // typing: (an item in progress is ticked off by a click, as its box would be)
    s.addEventListener("mousedown", (e) => {
      if (this.kind !== "/") return;
      e.preventDefault();
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: "x" }, userEvent: "input.task" });
    });
    return s;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "me-bullet";
    s.textContent = "•";
    return s;
  }
}

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "me-rule";
    return s;
  }
}

/** Math drawn (inline, or a block of its own); a click puts the cursor in its source. */
class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean, readonly at: number, readonly ctx: LiveContext) {
    super();
  }
  override eq(o: MathWidget): boolean {
    return o.tex === this.tex && o.display === this.display;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "me-math me-math-block" : "me-math";
    try {
      el.innerHTML = this.ctx.renderMath?.(this.tex, this.display) ?? "";
    } catch (e) {
      el.textContent = this.tex;
      el.classList.add("me-math-error");
      el.title = (e as Error).message;
    }
    // view-state: (a click on drawn math puts the cursor in its source, to edit it)
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.at } });
      view.focus();
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** A diagram drawn from its code; a click puts the cursor in its code. */
class DiagramWidget extends WidgetType {
  constructor(readonly code: string, readonly at: number, readonly ctx: LiveContext) {
    super();
  }
  override eq(o: DiagramWidget): boolean {
    return o.code === this.code;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "me-diagram";
    el.textContent = "…";
    void this.ctx.renderDiagram?.(this.code).then((svg) => void (el.innerHTML = svg), (e: Error) => {
      el.textContent = e.message;
      el.classList.add("me-math-error");
    });
    // view-state: (a click on the drawn diagram puts the cursor in its code)
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.at } });
      view.focus();
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** Math blocks and diagrams drawn while the cursor is out of them (block replacements: a state field's). */
function blockField(ctx: LiveContext): Extension {
  const build = (state: EditorState): DecorationSet => {
    const active = activeLines(state);
    const out: Range<Decoration>[] = [];
    const inside = (from: number, to: number): boolean => {
      for (let l = state.doc.lineAt(from).number; l <= state.doc.lineAt(to).number; l++) if (active.has(l)) return true;
      return false;
    };
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name === "BlockMath" && ctx.renderMath) {
          const from = state.doc.lineAt(ref.from).from, to = state.doc.lineAt(ref.to).to;
          if (!inside(from, to)) out.push(Decoration.replace({ widget: new MathWidget(state.sliceDoc(ref.from, ref.to).trim().replace(/^\$\$|\$\$$/g, "").trim(), true, ref.from + 2, ctx), block: true }).range(from, to));
          return false;
        }
        if (ref.name === "FencedCode" && ctx.renderDiagram) {
          const info = ref.node.getChild("CodeInfo");
          if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== "mermaid") return false;
          const from = state.doc.lineAt(ref.from).from, to = state.doc.lineAt(ref.to).to;
          const body = ref.node.getChild("CodeText");
          if (!inside(from, to)) out.push(Decoration.replace({ widget: new DiagramWidget(body ? state.sliceDoc(body.from, body.to) : "", info.to, ctx), block: true }).range(from, to));
          return false;
        }
        return ref.name === "Document" || ref.name === "Blockquote" || ref.name === "ListItem" || ref.name === "BulletList" || ref.name === "OrderedList";
      },
    });
    return Decoration.set(out, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.effects.some((e) => e.is(setRevealing)) ? build(tr.state) : deco.map(tr.changes)),
    provide: (f) => EditorView.decorations.from(f),
  });
}

/** A callout's title when it has none of its own: its type, capitalised. */
class CalloutTitle extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  override eq(o: CalloutTitle): boolean {
    return o.label === this.label;
  }
  override toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "me-callout-title";
    s.textContent = this.label;
    return s;
  }
}

const ICON = (d: string): string => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const COPY_ICON = ICON('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>');
const CHECK_ICON = ICON('<path d="M20 6 9 17l-5-5"/>');

/** A code card's corner: its language (a click puts the cursor on the fence, to change it) and a button that copies its code. */
class CodeFlair extends WidgetType {
  constructor(readonly language: string, readonly fenceEnd: number, readonly from: number, readonly to: number, readonly ctx: LiveContext, readonly detected = false) {
    super();
  }
  override eq(o: CodeFlair): boolean {
    return o.language === this.language && o.fenceEnd === this.fenceEnd && o.from === this.from && o.to === this.to && o.detected === this.detected;
  }
  override toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement("span");
    bar.className = "me-code-flair";
    bar.contentEditable = "false";
    const lang = document.createElement("button");
    lang.type = "button";
    lang.className = `me-code-lang${this.detected ? " is-detected" : ""}`;
    lang.innerHTML = `<span></span>${ICON('<path d="m6 9 6 6 6-6"/>')}`;
    lang.firstElementChild!.textContent = this.detected ? `${this.language} · ${this.ctx.detectedLabel}` : this.language;
    lang.title = this.ctx.languageLabel;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "me-code-copy";
    copy.title = this.ctx.copyLabel;
    copy.setAttribute("aria-label", this.ctx.copyLabel);
    copy.innerHTML = COPY_ICON;
    // view-state: (a press on the card's buttons leaves the cursor where it was)
    for (const b of [lang, copy]) b.addEventListener("mousedown", (e) => (e.preventDefault(), e.stopPropagation()));
    // view-state: (opens the list of languages; a choice writes it on the block's fence)
    lang.addEventListener("click", () => {
      const line = view.state.doc.lineAt(this.fenceEnd);
      const fence = /^(\s*(?:>\s?)*\s*)(`{3,}|~{3,})(.*)$/.exec(line.text);
      if (!fence) return;
      const set = (name: string): void => {
        const from = line.from + fence[1]!.length + fence[2]!.length;
        view.dispatch({ changes: { from, to: line.to, insert: name }, userEvent: "input.language" });
      };
      openPopover(lang, [{ id: "language.none", label: this.ctx.plainLabel, on: !fence[3]!.trim(), pick: () => set("") }, ...this.ctx.languages.map((l) => ({ id: `language.${l}`, label: l, on: fence[3]!.trim() === l, pick: () => set(l) }))], this.ctx.languageLabel);
    });
    // view-state: (copies the block's code to the clipboard; the note is unchanged)
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(view.state.sliceDoc(this.from, this.to)).then(() => {
        copy.innerHTML = CHECK_ICON;
        copy.title = this.ctx.copiedLabel;
        setTimeout(() => ((copy.innerHTML = COPY_ICON), (copy.title = this.ctx.copyLabel)), 1100);
      }, () => undefined);
    });
    bar.append(lang, copy);
    return bar;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** `> [!type] Title`: a callout's first line. */
const CALLOUT_HEAD = /^(\s*>\s?)\[!(\w+)\]([-+])?\s?(.*)$/;
/** Each callout type's colour family. */
const CALLOUT_GROUP: Readonly<Record<string, string>> = {
  note: "note", info: "note", abstract: "note", summary: "note", tldr: "note", todo: "note",
  tip: "tip", hint: "tip", important: "tip", success: "tip", check: "tip", done: "tip",
  question: "question", help: "question", faq: "question", example: "question",
  warning: "warning", warn: "warning", caution: "warning", attention: "warning",
  danger: "danger", error: "danger", bug: "danger", failure: "danger", fail: "danger", missing: "danger",
  quote: "quote", cite: "quote",
};

/** The decorations of the lines on screen. */
function decorations(view: EditorView, ctx: LiveContext): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];
  const text = (n: SyntaxNode): string => state.sliceDoc(n.from, n.to);
  const lineOf = (pos: number) => state.doc.lineAt(pos);
  const lineActive = (pos: number): boolean => active.has(lineOf(pos).number);
  const lineClass = (pos: number, cls: string): void => void out.push(Decoration.line({ class: cls }).range(lineOf(pos).from));
  /** Hide a mark, with the spaces after it when `spaces`. */
  const hideMark = (from: number, to: number, spaces = false): void => {
    if (spaces) while (to < state.doc.length && /[ \t]/.test(state.sliceDoc(to, to + 1))) to++;
    if (to > from) out.push(hide.range(from, to));
  };
  /** A picture: drawn in place of its Markdown, always; while it is edited (Enter, or its edit button) its Markdown shows with it after. */
  const editing = state.field(pictureEdit, false);
  const picked = selectedPicture(state);
  const media = (n: SyntaxNode, make: (selected: boolean) => MediaWidget): void => {
    if (editing === n.from) out.push(Decoration.widget({ widget: make(false), side: 1 }).range(n.to));
    else out.push(Decoration.replace({ widget: make(picked?.from === n.from && picked.to === n.to) }).range(n.from, n.to));
  };
  const seenQuotes = new Set<number>();
  const codeAt = (pos: number): boolean => {
    for (let c: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); c; c = c.parent) if (c.name === "FencedCode" || c.name === "CodeBlock") return true;
    return false;
  };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const n = ref.node;
        const name = n.name;
        if (/^ATXHeading\d$/.test(name) || /^SetextHeading\d$/.test(name)) {
          lineClass(n.from, `me-h me-h${name.slice(-1)}`);
          if (!lineActive(n.from)) for (const m of n.getChildren("HeaderMark")) hideMark(m.from, m.to, m.from === n.from && name.startsWith("ATX"));
          return;
        }
        switch (name) {
          case "Emphasis": case "StrongEmphasis": case "Strikethrough": case "InlineCode": {
            if (lineActive(n.from)) return;
            for (const m of n.getChildren(name === "InlineCode" ? "CodeMark" : name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark")) hideMark(m.from, m.to);
            return;
          }
          case "Highlight":
            out.push(Decoration.mark({ class: "me-mark" }).range(n.from, n.to));
            if (!touches(state, n.from, n.to)) for (const m of n.getChildren("HighlightMark")) hideMark(m.from, m.to);
            return;
          case "Escape":
            if (!lineActive(n.from)) hideMark(n.from, n.from + 1);
            return;
          case "InlineMath":
            if (ctx.renderMath && !touches(state, n.from, n.to)) out.push(Decoration.replace({ widget: new MathWidget(state.sliceDoc(n.from + 1, n.to - 1), false, n.from + 1, ctx) }).range(n.from, n.to));
            return false;
          case "BlockMath":
            return false;
          case "Link": {
            // (`[-]` cancelled, `[/]` in progress, `[>]` forwarded at a list item's start: task states the parser reads as links)
            const state3 = /^\[([-/>])\]$/.exec(text(n));
            if (state3 && /^\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])[ \t]+$/.test(state.sliceDoc(lineOf(n.from).from, n.from))) {
              const line = lineOf(n.from);
              if (state3[1] === "-" && n.to < line.to) out.push(Decoration.mark({ class: "me-cancelled" }).range(n.to, line.to));
              if (!active.has(line.number)) out.push(Decoration.replace({ widget: new TaskState(state3[1]!, n.from, ctx.taskLabel) }).range(n.from, n.to));
              return false;
            }
            const marks = n.getChildren("LinkMark");
            const url = n.getChild("URL");
            const close = marks.find((m) => text(m) === "]");
            const href = url ? text(url).replace(/^<|>$/g, "") : "";
            // (`[label](` with no `)` yet is no link: its brackets stay while the address is typed)
            const finished = !!url || !!n.getChild("LinkLabel") || state.sliceDoc(n.to, n.to + 1) !== "(";
            if (close && marks[0]) out.push(Decoration.mark({ class: "me-link", attributes: { "data-href": href } }).range(marks[0].to, close.from));
            if (finished && marks[0] && close && close.from > marks[0].to && !touches(state, n.from, n.to)) {
              hideMark(marks[0].from, marks[0].to);
              hideMark(close.from, n.to);
            }
            return false;
          }
          case "Image": {
            const marks = n.getChildren("LinkMark");
            const url = n.getChild("URL");
            const close = marks.find((m) => text(m) === "]");
            if (!url || !close) return false;
            const a = readAlt(state.sliceDoc(marks[0]!.to, close.from));
            media(n, (sel) => new MediaWidget(text(url).replace(/^<|>$/g, ""), a.alt, false, a.width, ctx, { from: n.from, to: n.to }, sel));
            return false;
          }
          case "Embed": {
            const target = n.getChild("WikiTarget");
            if (!target) return false;
            const alias = n.getChild("WikiAlias");
            const a = readAlt(alias ? text(alias) : "");
            media(n, (sel) => new MediaWidget(text(target).trim(), a.alt, true, a.width, ctx, { from: n.from, to: n.to }, sel));
            return false;
          }
          case "FootnoteRef": case "InlineFootnote": {
            // (off the cursor, a footnote is its number, small and raised, as notes apps draw it: its words on hover, a click goes to them)
            if (touches(state, n.from, n.to)) return false;
            const fn = footnotesOf(state);
            const inline = name === "InlineFootnote";
            const label = inline ? "" : text(n).slice(2, -1);
            const num = inline ? fn.inline.get(n.from) ?? 0 : fn.number.get(label) ?? 0;
            const words = inline ? text(n).slice(2, -1) : fn.defs.get(label)?.text ?? "";
            out.push(Decoration.replace({ widget: new FootnoteWidget(num, words, inline ? null : label) }).range(n.from, n.to));
            return false;
          }
          case "FootnoteDef": {
            // (a definition's label drawn as the footnote's number off the cursor's line)
            const mark = n.getChild("FootnoteMark");
            if (mark && !lineActive(n.from)) out.push(Decoration.mark({ class: "me-fn-label" }).range(mark.from, mark.to));
            return;
          }
          case "WikiLink": {
            const target = n.getChild("WikiTarget");
            const alias = n.getChild("WikiAlias");
            if (!target) return false;
            const broken = ctx.exists?.(text(target).trim().split("#")[0]!) === false;
            const attrs = { class: `me-link me-wikilink${broken ? " me-wikilink-broken" : ""}`, attributes: { "data-wiki": text(target).trim() } };
            if (touches(state, n.from, n.to)) {
              out.push(Decoration.mark(attrs).range(n.from, n.to));
              return false;
            }
            // (shown: the alias, else the target without its folders, as notes apps show it)
            const shownFrom = alias ? alias.from : target.from + text(target).split("#")[0]!.lastIndexOf("/") + 1;
            const shownTo = alias ? alias.to : target.to;
            hideMark(n.from, shownFrom);
            out.push(Decoration.mark(attrs).range(shownFrom, shownTo));
            hideMark(shownTo, n.to);
            return false;
          }
          case "Tag":
            if (/^(ATX|Setext)Heading/.test(n.parent?.name ?? "")) return false;
            out.push(Decoration.mark({ class: "me-tag", attributes: { "data-tag": state.sliceDoc(n.from + 1, n.to) } }).range(n.from, n.to));
            return false;
          case "URL":
            if (n.parent?.name !== "Link" && n.parent?.name !== "Image" && n.parent?.name !== "LinkReference") out.push(Decoration.mark({ class: "me-link", attributes: { "data-href": text(n) } }).range(n.from, n.to));
            return false;
          case "Autolink": {
            const url = n.getChild("URL");
            if (url) out.push(Decoration.mark({ class: "me-link", attributes: { "data-href": text(url) } }).range(url.from, url.to));
            if (url && !touches(state, n.from, n.to)) {
              hideMark(n.from, url.from);
              hideMark(url.to, n.to);
            }
            return false;
          }
          case "Blockquote": {
            const first = lineOf(n.from).number;
            if (seenQuotes.has(first)) return;
            const last = lineOf(Math.max(n.from, n.to - 1)).number;
            const head = state.doc.line(first);
            const callout = CALLOUT_HEAD.exec(head.text);
            for (let l = first; l <= last; l++) {
              if (seenQuotes.has(l)) continue;
              seenQuotes.add(l);
              const cls = callout ? `me-callout me-callout-${CALLOUT_GROUP[callout[2]!.toLowerCase()] ?? "note"}${l === first ? " me-callout-head" : ""}${l === last ? " me-callout-foot" : ""}` : "me-quote";
              out.push(Decoration.line({ class: cls }).range(state.doc.line(l).from));
            }
            if (callout && !active.has(first)) {
              const start = head.from + callout[1]!.length;
              const end = start + `[!${callout[2]}]${callout[3] ?? ""}`.length;
              if (callout[4]!.trim()) hideMark(start, end, true);
              else out.push(Decoration.replace({ widget: new CalloutTitle(callout[2]!.charAt(0).toUpperCase() + callout[2]!.slice(1).toLowerCase()) }).range(start, end));
            }
            return;
          }
          case "QuoteMark":
            if (!lineActive(n.from)) hideMark(n.from, n.to, true);
            return;
          case "ListMark": {
            if (lineActive(n.from)) return;
            if (n.parent?.getChild("Task") || /^\s*\[[-/>]\]/.test(state.sliceDoc(n.to, lineOf(n.from).to))) hideMark(n.from, n.to, true);
            else if (n.parent?.parent?.name === "BulletList") out.push(Decoration.replace({ widget: new BulletWidget() }).range(n.from, n.to));
            else out.push(Decoration.mark({ class: "me-list-number" }).range(n.from, n.to));
            return;
          }
          case "TaskMarker": {
            const on = /x/i.test(text(n));
            const line = lineOf(n.from);
            if (on && n.to < line.to) out.push(Decoration.mark({ class: "me-done" }).range(n.to, line.to));
            if (!active.has(line.number)) out.push(Decoration.replace({ widget: new TaskWidget(on, n.from, ctx.taskLabel) }).range(n.from, n.to));
            return;
          }
          case "HorizontalRule":
            if (!lineActive(n.from)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(n.from, n.to));
            return;
          case "FencedCode": {
            const first = lineOf(n.from), last = lineOf(Math.max(n.from, n.to - 1));
            let blockActive = false;
            for (let l = first.number; l <= last.number && !blockActive; l++) blockActive = active.has(l);
            const closes = last.number > first.number && /^\s*(?:>\s?)*(`{3,}|~{3,})\s*$/.test(last.text);
            for (let l = first.number; l <= last.number; l++) out.push(Decoration.line({ class: `me-code-card${l === first.number ? " me-code-begin" : ""}${l === last.number ? " me-code-end" : ""}` }).range(state.doc.line(l).from));
            // (outside the block its fences go, and it reads as a card; inside, they are there to edit)
            if (!blockActive) {
              if (first.to > first.from) hideMark(first.from, first.to);
              if (closes && last.to > last.from) hideMark(last.from, last.to);
            }
            const info = n.getChild("CodeInfo");
            const body = n.getChild("CodeText");
            const guess = !info && body ? guessLanguage(state.sliceDoc(body.from, body.to)) : null;
            const language = info ? text(info).trim().split(/\s+/)[0]! : (guess ?? ctx.plainLabel);
            out.push(Decoration.widget({ widget: new CodeFlair(language, first.to, body?.from ?? first.to, body?.to ?? first.to, ctx, !!guess), side: 1 }).range(first.to));
            return false;
          }
          case "Table":
            return false; // (the table field draws it)
        }
        return;
      },
    });
  }
  // Per line: a block's `^id` at its end (an address, not words) hidden off the cursor's line; `<mark class="hl-red">…</mark>` drawn as a highlight.
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = lineOf(pos);
      pos = line.to + 1;
      if (codeAt(line.from)) continue;
      const anchor = /\s\^([\w-]+)\s*$/.exec(line.text);
      if (anchor && !active.has(line.number)) hideMark(line.from + anchor.index, line.to);
      for (const m of line.text.matchAll(/<mark class="hl-(\w+)">([^<]*)<\/mark>/g)) {
        const a = line.from + m.index!, b = a + m[0].length;
        const open = m[0].indexOf(">") + 1;
        out.push(Decoration.mark({ class: `me-mark me-hl-${m[1]}` }).range(a + open, b - 7));
        // (off the cursor its tags go; at the cursor they read as a highlight's marks do, ==, with a dot of its colour, not as HTML)
        if (!touches(state, a, b)) (hideMark(a, a + open), hideMark(b - 7, b));
        else out.push(Decoration.replace({ widget: new HighlightMark(m[1]!, true) }).range(a, a + open), Decoration.replace({ widget: new HighlightMark(m[1]!, false) }).range(b - 7, b));
      }
    }
  }
  return Decoration.set(out, true);
}

/** Live mode's layer. */
export function livePreview(ctx: LiveContext): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorations(view, ctx);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet || revealChanged(u) || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) this.decorations = decorations(u.view, ctx);
      }
    },
    { decorations: (v) => v.decorations },
  );
  if (ctx.inline) return [revealOnFocus, plugin];
  return [revealOnFocus, plugin, tableField(ctx), blockField(ctx), EditorView.editorAttributes.of({ class: "me-live" })];
}
