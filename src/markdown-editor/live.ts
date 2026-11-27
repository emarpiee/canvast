// Live mode: the Markdown is the text being edited, shown as it reads. Marks (`**`, `#`, `>`, a link's address) are hidden except where the
// cursor or the selection is, so they can be edited there; pictures, task boxes, rules and tables are drawn in place. Source mode is the same
// editor without this layer.
import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { toggleTask } from "./commands";
import { renderMarkdown } from "./render";

/** What live mode asks of the host. */
export interface LiveContext {
  /** A picture for a link as written (`cat.png`) or an embed's target (`![[cat.png]]`): an address the page can show, and its type. */
  media?: (link: string, embed: boolean) => Promise<{ url: string; type: string } | null>;
  /** Words for the task box (screen readers). */
  taskLabel: string;
}

/** Ask for the decorations again (a picture or colours arrived). */
export const refresh = StateEffect.define<null>();

/** The editor has the focus: marks show at the cursor only then, so a note opens (and sits unfocused) as it reads. */
const setFocus = StateEffect.define<boolean>();
const focused = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((was, e) => (e.is(setFocus) ? e.value : was), v),
});
/** Whether the selection touches `from`…`to` (an empty cursor at either end counts), while the editor has the focus. */
const touches = (state: EditorState, from: number, to: number): boolean => state.field(focused, false) === true && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
/** Whether the selection is on any line from `from` to `to`. */
const onLines = (state: EditorState, from: number, to: number): boolean => {
  const a = state.doc.lineAt(from).from, b = state.doc.lineAt(to).to;
  return touches(state, a, b);
};

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
      box.textContent = "";
      const kind = got.type.split("/")[0];
      const el = kind === "video" ? document.createElement("video") : kind === "audio" ? document.createElement("audio") : document.createElement("img");
      if (el instanceof HTMLImageElement) el.alt = name;
      else el.controls = true;
      el.src = got.url;
      if (this.width) el.style.width = `${this.width}px`;
      if (kind !== "image" && kind !== "video" && kind !== "audio") return void (box.textContent = name);
      box.append(el);
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return false;
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
    return box;
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

/** A table drawn as a table while the cursor is outside it; a click puts the cursor in it, where its Markdown shows. */
class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly ctx: LiveContext) {
    super();
  }
  override eq(o: TableWidget): boolean {
    return o.source === this.source;
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "me-table";
    box.innerHTML = renderMarkdown(this.source);
    for (const img of box.querySelectorAll("img")) img.replaceWith(new MediaWidget(img.getAttribute("data-embed") ?? img.getAttribute("src") ?? "", img.alt, img.hasAttribute("data-embed"), null, this.ctx).toDOM());
    // view-state: (a click on the drawn table moves the cursor into its text)
    box.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The inline decorations of the lines on screen. */
function inlineDecorations(view: EditorView, ctx: LiveContext): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const text = (n: SyntaxNode): string => state.sliceDoc(n.from, n.to);
  const lineClass = (pos: number, cls: string): void => void out.push(Decoration.line({ class: cls }).range(state.doc.lineAt(pos).from));
  /** Hide a mark, with the spaces after it when `spaces`. */
  const hideMark = (from: number, to: number, spaces = false): void => {
    if (spaces) while (to < state.doc.length && /[ \t]/.test(state.sliceDoc(to, to + 1))) to++;
    if (to > from) out.push(hide.range(from, to));
  };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const n = ref.node;
        const name = n.name;
        if (/^ATXHeading\d$/.test(name)) {
          lineClass(n.from, `me-h me-h${name.slice(-1)}`);
          if (!onLines(state, n.from, n.to)) for (const m of n.getChildren("HeaderMark")) hideMark(m.from, m.to, m.from === n.from);
          return;
        }
        if (/^SetextHeading\d$/.test(name)) {
          lineClass(n.from, `me-h me-h${name.slice(-1)}`);
          return;
        }
        switch (name) {
          case "Emphasis": case "StrongEmphasis": case "Strikethrough": case "Highlight": case "InlineCode": {
            const cls = { Emphasis: "me-em", StrongEmphasis: "me-strong", Strikethrough: "me-strike", Highlight: "me-mark", InlineCode: "me-code" }[name];
            out.push(Decoration.mark({ class: cls }).range(n.from, n.to));
            if (!touches(state, n.from, n.to)) {
              const markName = name === "InlineCode" ? "CodeMark" : name === "Strikethrough" ? "StrikethroughMark" : name === "Highlight" ? "HighlightMark" : "EmphasisMark";
              for (const m of n.getChildren(markName)) hideMark(m.from, m.to);
            }
            return;
          }
          case "Link": {
            const marks = n.getChildren("LinkMark");
            const url = n.getChild("URL");
            const close = marks.find((m) => text(m) === "]");
            const href = url ? text(url).replace(/^<|>$/g, "") : "";
            if (close && marks[0]) out.push(Decoration.mark({ class: "me-link", attributes: { "data-href": href } }).range(marks[0].to, close.from));
            if (!touches(state, n.from, n.to) && marks[0] && close && close.from > marks[0].to) {
              hideMark(marks[0].from, marks[0].to);
              hideMark(close.from, n.to);
            } else if (url) out.push(Decoration.mark({ class: "me-url" }).range(url.from, url.to));
            return false;
          }
          case "Image": {
            const marks = n.getChildren("LinkMark");
            const url = n.getChild("URL");
            const close = marks.find((m) => text(m) === "]");
            if (!url || !close) return false;
            const alt = state.sliceDoc(marks[0]!.to, close.from);
            const size = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(alt);
            const w = new MediaWidget(text(url).replace(/^<|>$/g, ""), size ? size[1]! : alt, false, size ? Number(size[2]) : null, ctx);
            if (touches(state, n.from, n.to)) out.push(Decoration.mark({ class: "me-url" }).range(n.from, n.to), Decoration.widget({ widget: w, side: 1 }).range(n.to));
            else out.push(Decoration.replace({ widget: w }).range(n.from, n.to));
            return false;
          }
          case "WikiLink": case "Embed": {
            const target = n.getChild("WikiTarget");
            const alias = n.getChild("WikiAlias");
            if (!target) return false;
            const t = text(target).trim();
            if (name === "Embed") {
              const a = alias ? text(alias).trim() : "";
              const size = /^\d+(?:x\d+)?$/.test(a) ? Number(a.split("x")[0]) : null;
              const w = new MediaWidget(t, size ? "" : a, true, size, ctx);
              if (touches(state, n.from, n.to)) out.push(Decoration.mark({ class: "me-url" }).range(n.from, n.to), Decoration.widget({ widget: w, side: 1 }).range(n.to));
              else out.push(Decoration.replace({ widget: w }).range(n.from, n.to));
              return false;
            }
            const attrs = { class: "me-link me-wikilink", attributes: { "data-wiki": t } };
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
            if (!touches(state, n.from, n.to) && url) {
              hideMark(n.from, url.from);
              hideMark(url.to, n.to);
            }
            return false;
          }
          case "Blockquote": {
            for (let p = n.from; p <= n.to; ) {
              const line = state.doc.lineAt(p);
              lineClass(line.from, "me-quote");
              p = line.to + 1;
            }
            return;
          }
          case "QuoteMark":
            if (!onLines(state, n.from, n.to)) hideMark(n.from, n.to, true);
            return;
          case "ListMark": {
            const item = n.parent;
            const list = item?.parent;
            const task = item?.getChild("Task");
            if (onLines(state, n.from, n.to)) return;
            if (task) hideMark(n.from, n.to, true);
            else if (list?.name === "BulletList") out.push(Decoration.replace({ widget: new BulletWidget() }).range(n.from, n.to));
            else out.push(Decoration.mark({ class: "me-list-number" }).range(n.from, n.to));
            return;
          }
          case "TaskMarker": {
            const on = /x/i.test(text(n));
            if (!touches(state, n.from, n.to) || !state.selection.ranges.some((r) => r.from > n.from && r.to < n.to)) {
              out.push(Decoration.replace({ widget: new TaskWidget(on, n.from, ctx.taskLabel) }).range(n.from, n.to));
            }
            if (on) {
              const line = state.doc.lineAt(n.from);
              if (n.to < line.to) out.push(Decoration.mark({ class: "me-done" }).range(n.to, line.to));
            }
            return;
          }
          case "HorizontalRule":
            if (!onLines(state, n.from, n.to)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(n.from, n.to));
            return;
          case "FencedCode": {
            const first = state.doc.lineAt(n.from), last = state.doc.lineAt(n.to);
            for (let l = first.number; l <= last.number; l++) {
              const line = state.doc.line(l);
              const edge = l === first.number || (l === last.number && /^\s*(`{3,}|~{3,})\s*$/.test(line.text));
              lineClass(line.from, `me-code-block${l === first.number ? " me-code-first" : ""}${l === last.number ? " me-code-last" : ""}${edge ? " me-fence" : ""}`);
            }
            return false;
          }
          case "Table":
            return false; // (drawn by the table field)
          case "Escape":
            if (!touches(state, n.from, n.to)) hideMark(n.from, n.from + 1);
            return;
        }
        return;
      },
    });
  }
  return Decoration.set(out, true);
}

/** Tables drawn whole while the cursor is not in them (a block replacement, which only a state field may make). */
function tableField(ctx: LiveContext): StateField<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const out: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name === "Table") {
          const from = state.doc.lineAt(ref.from).from, to = state.doc.lineAt(ref.to).to;
          if (!touches(state, from, to)) out.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), from, ctx), block: true }).range(from, to));
          return false;
        }
        // (only blocks hold tables)
        return ref.name === "Document" || ref.name === "Blockquote" || ref.name === "ListItem" || ref.name === "BulletList" || ref.name === "OrderedList";
      },
    });
    return Decoration.set(out, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.effects.some((e) => e.is(refresh) || e.is(setFocus)) ? build(tr.state) : deco.map(tr.changes)),
    provide: (f) => EditorView.decorations.from(f),
  });
}

/** Live mode's layer. */
export function livePreview(ctx: LiveContext): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = inlineDecorations(view, ctx);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((t) => t.effects.some((e) => e.is(refresh) || e.is(setFocus)))) this.decorations = inlineDecorations(u.view, ctx);
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [focused, EditorView.focusChangeEffect.of((_s, on) => setFocus.of(on)), plugin, tableField(ctx), EditorView.editorAttributes.of({ class: "me-live" })];
}
