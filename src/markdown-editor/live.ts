// Live mode: the Markdown is the text being edited, shown as it reads. Once the editor has been focused, the lines the selection is on
// show their marks (a heading's `#`, `**`, a quote's `>`, a list's `-`, a task's `[ ]`, a picture's source); links, wiki links and
// highlights show theirs only where the selection touches them. Elsewhere marks are hidden and pictures, task boxes, rules, callouts,
// code cards and tables are drawn. Source mode is the same editor without this layer.
import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { toggleTask } from "./commands";
import { tableField } from "./table";

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

/** A picture (or a file's name when it is not one) drawn where its Markdown is. */
class MediaWidget extends WidgetType {
  constructor(readonly link: string, readonly alt: string, readonly embed: boolean, readonly width: number | null, readonly ctx: LiveContext) {
    super();
  }
  override eq(o: MediaWidget): boolean {
    return o.link === this.link && o.alt === this.alt && o.embed === this.embed && o.width === this.width;
  }
  override toDOM(): HTMLElement {
    const box = document.createElement("span");
    box.className = "me-media";
    box.setAttribute(this.embed ? "data-embed" : "data-src", this.link);
    const name = this.alt || decodeURIComponent(this.link.split(/[/\\]/).pop() ?? this.link);
    box.textContent = name;
    void this.ctx.media?.(this.link, this.embed).then((got) => {
      if (!got || !box.isConnected) return;
      const kind = got.type.split("/")[0];
      if (kind !== "image" && kind !== "video" && kind !== "audio") return;
      box.textContent = "";
      const el = kind === "video" ? document.createElement("video") : kind === "audio" ? document.createElement("audio") : document.createElement("img");
      if (el instanceof HTMLImageElement) el.alt = name;
      else el.controls = true;
      el.src = got.url;
      if (this.width) el.style.width = `${this.width}px`;
      box.append(el);
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}
/** A picture drawn for any widget's page (a table's cells). */
export const mediaElement = (ctx: LiveContext, link: string, alt: string, embed: boolean): HTMLElement => new MediaWidget(link, alt, embed, null, ctx).toDOM();

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
  constructor(readonly language: string, readonly fenceEnd: number, readonly from: number, readonly to: number, readonly ctx: LiveContext) {
    super();
  }
  override eq(o: CodeFlair): boolean {
    return o.language === this.language && o.fenceEnd === this.fenceEnd && o.from === this.from && o.to === this.to;
  }
  override toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement("span");
    bar.className = "me-code-flair";
    bar.contentEditable = "false";
    const lang = document.createElement("button");
    lang.type = "button";
    lang.className = "me-code-lang";
    lang.textContent = this.language;
    lang.title = this.ctx.languageLabel;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "me-code-copy";
    copy.title = this.ctx.copyLabel;
    copy.setAttribute("aria-label", this.ctx.copyLabel);
    copy.innerHTML = COPY_ICON;
    // view-state: (a press on the card's buttons leaves the cursor where it was)
    for (const b of [lang, copy]) b.addEventListener("mousedown", (e) => (e.preventDefault(), e.stopPropagation()));
    // view-state: (puts the cursor at the end of the fence, where its language is written)
    lang.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: this.fenceEnd } });
      view.focus();
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
  /** A picture: on the cursor's line its source shows with the picture after it; elsewhere the picture alone. */
  const media = (n: SyntaxNode, w: MediaWidget): void => {
    if (lineActive(n.from)) out.push(Decoration.widget({ widget: w, side: 1 }).range(n.to));
    else out.push(Decoration.replace({ widget: w }).range(n.from, n.to));
  };
  const seenQuotes = new Set<number>();
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
          case "Link": {
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
            const alt = state.sliceDoc(marks[0]!.to, close.from);
            const size = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(alt);
            media(n, new MediaWidget(text(url).replace(/^<|>$/g, ""), size ? size[1]! : alt, false, size ? Number(size[2]) : null, ctx));
            return false;
          }
          case "Embed": {
            const target = n.getChild("WikiTarget");
            if (!target) return false;
            const alias = n.getChild("WikiAlias");
            const a = alias ? text(alias).trim() : "";
            const size = /^\d+(?:x\d+)?$/.test(a) ? Number(a.split("x")[0]) : null;
            media(n, new MediaWidget(text(target).trim(), size ? "" : a, true, size, ctx));
            return false;
          }
          case "WikiLink": {
            const target = n.getChild("WikiTarget");
            const alias = n.getChild("WikiAlias");
            if (!target) return false;
            const attrs = { class: "me-link me-wikilink", attributes: { "data-wiki": text(target).trim() } };
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
            if (n.parent?.getChild("Task")) hideMark(n.from, n.to, true);
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
            const language = info ? text(info).trim().split(/\s+/)[0]! : "text";
            out.push(Decoration.widget({ widget: new CodeFlair(language, first.to, body?.from ?? first.to, body?.to ?? first.to, ctx), side: 1 }).range(first.to));
            return false;
          }
          case "Table":
            return false; // (the table field draws it)
        }
        return;
      },
    });
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
  return [revealOnFocus, plugin, tableField(ctx), EditorView.editorAttributes.of({ class: "me-live" })];
}
