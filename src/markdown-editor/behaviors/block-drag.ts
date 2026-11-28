// Behaviour: every block of a note (a paragraph, a heading, a list item, a quote, a code block, a callout…) has a grip at its left while the
// pointer is over it; dragged, the block goes where it is let go, between two blocks (a line shows where), in one undo step. The table's own
// grip moves it the same way (`dragBlock`). As the first notes editor and block editors do. Test: notes.spec "every block is dragged".
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { WIDTHS_LINE, frontmatterLength } from "../render";

/** A block of the note: where it is in the file, and whether it is a list item (moved among list items with no blank line round it). */
export interface Block {
  from: number;
  to: number;
  item: boolean;
}

/** The note's blocks in order: the top-level ones, a list's items each on its own (its nested items go with it), past the properties. */
export function blocksOf(state: EditorState): Block[] {
  const out: Block[] = [];
  const skip = frontmatterLength(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (n.to <= skip) continue;
    if (n.name === "BulletList" || n.name === "OrderedList") {
      for (let i = n.firstChild; i; i = i.nextSibling) if (i.name === "ListItem") out.push({ from: state.doc.lineAt(i.from).from, to: state.doc.lineAt(i.to).to, item: true });
    } else {
      const from = state.doc.lineAt(n.from).from;
      let to = state.doc.lineAt(n.to).to;
      // (a table's widths, in a comment line after it, go with it: never left behind as a stray line)
      const next = n.name === "Table" ? n.nextSibling : null;
      if (next && WIDTHS_LINE.test(state.doc.sliceString(next.from, next.to).trim())) (to = state.doc.lineAt(next.to).to), (n = next);
      out.push({ from, to, item: false });
    }
  }
  return out;
}

/**
 * Drag the block `of()` names from a press on its grip: a line shows where it would go (the start of the block under the pointer, or after the
 * last); let go, it is moved there, blank lines round it as Markdown needs them (none between list items).
 */
export function dragBlock(view: EditorView, grip: HTMLElement, e: PointerEvent, of: () => Block): void {
  e.preventDefault();
  e.stopPropagation();
  grip.setPointerCapture(e.pointerId);
  grip.classList.add("is-dragging");
  const line = document.createElement("div");
  line.className = "me-table-drop";
  line.style.background = getComputedStyle(view.dom).getPropertyValue("--me-accent"); // (on the page's top, outside the editor's tokens)
  document.body.append(line);
  let at: number | null = null;
  const move = (ev: PointerEvent): void => {
    const me = of();
    const blocks = blocksOf(view.state);
    const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY }, false);
    // (the boundary nearest the pointer: before the block under it, or after it when the pointer is in its lower half)
    const b = blocks.find((x) => pos >= x.from && pos <= x.to) ?? (pos > (blocks.at(-1)?.to ?? 0) ? blocks.at(-1) : blocks[0]);
    if (!b) return void (line.hidden = true);
    const top = view.coordsAtPos(b.from), bottom = view.coordsAtPos(b.to);
    const lower = !!top && !!bottom && ev.clientY > (top.top + bottom.bottom) / 2;
    const to = lower ? b.to : b.from;
    // (on itself, or at its own edges: nowhere it would move)
    at = to >= me.from && to <= me.to ? null : to;
    line.hidden = at === null;
    if (at === null) return;
    const c = lower ? bottom : top;
    const content = view.contentDOM.getBoundingClientRect();
    if (!c) return void (line.hidden = true);
    Object.assign(line.style, { left: `${content.left}px`, width: `${content.width}px`, top: `${(lower ? c.bottom : c.top) - 1}px` });
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", () => {
    grip.removeEventListener("pointermove", move);
    grip.classList.remove("is-dragging");
    line.remove();
    if (at === null) return;
    const me = of();
    const doc = view.state.doc;
    const from = me.from, to = Math.min(doc.length, me.to + (doc.sliceString(me.to, me.to + 1) === "\n" ? 1 : 0));
    const text = doc.sliceString(me.from, me.to);
    // (beside a list item, a list item needs no blank line; anything else is a block of its own, a blank line round it)
    const near = blocksOf(view.state).find((x) => x.from === at || x.to === at);
    const sep = me.item && near?.item ? "\n" : "\n\n";
    const before = doc.sliceString(Math.max(0, at - 2), at), after = doc.sliceString(at, at + 2);
    const lead = at === 0 ? "" : before.endsWith(sep) ? "" : before.endsWith("\n") ? sep.slice(1) : sep;
    const trail = at === doc.length ? "\n" : after.startsWith(sep) ? "" : after.startsWith("\n") ? sep.slice(1) : sep;
    const changes = view.state.changes([{ from, to }, { from: at, insert: `${lead}${text}${trail}` }]);
    view.dispatch({ changes, selection: { anchor: changes.mapPos(at, 1) }, scrollIntoView: true, userEvent: "move.block" });
    view.focus();
  }, { once: true });
}

/** The grip at the left of the block the pointer is over (live editing; a table has its own, `TableView.mover`). */
export function blockHandle(label: string) {
  return ViewPlugin.fromClass(
    class {
      readonly grip = document.createElement("span");
      block: Block | null = null;
      constructor(readonly view: EditorView) {
        const g = this.grip;
        g.className = "me-block-grip";
        g.title = label;
        g.setAttribute("aria-label", label);
        g.hidden = true;
        g.innerHTML = '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="3" r="1.1"/><circle cx="7" cy="3" r="1.1"/><circle cx="3" cy="7" r="1.1"/><circle cx="7" cy="7" r="1.1"/><circle cx="3" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>';
        // view-state: (drags a block of the note to another place: one change of the file, as typing is)
        g.addEventListener("pointerdown", (e) => {
          const b = this.block;
          if (b) dragBlock(view, g, e, () => this.block ?? b);
        });
        view.dom.append(g);
        // typing: (where the pointer is: the grip of the block under it)
        view.dom.addEventListener("mousemove", this.near);
        view.dom.addEventListener("mouseleave", this.away);
      }
      readonly near = (e: MouseEvent): void => {
        if (this.grip.classList.contains("is-dragging") || this.grip.contains(e.target as Node)) return;
        const t = e.target as Element;
        // (not in a table, which has its own grip, nor in a cell's own editor)
        if (t.closest(".me-table, .cm-panels, .cm-tooltip")) return this.away();
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
        const b = pos === null ? undefined : blocksOf(this.view.state).find((x) => pos >= x.from && pos <= x.to);
        if (!b) return this.away();
        const c = this.view.coordsAtPos(b.from, 1);
        if (!c) return this.away();
        this.block = b;
        const dom = this.view.dom.getBoundingClientRect(), content = this.view.contentDOM.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft) || 0;
        this.grip.hidden = false;
        this.grip.style.top = `${c.top - dom.top + (c.bottom - c.top) / 2 - 7}px`;
        this.grip.style.left = `${Math.max(0, content.left - dom.left + pad - 36)}px`; // (left of a heading's fold chevron, which sits just before its words)
      };
      readonly away = (): void => {
        if (this.grip.classList.contains("is-dragging")) return;
        this.block = null;
        this.grip.hidden = true;
      };
      update(u: ViewUpdate): void {
        if (u.docChanged && !this.grip.classList.contains("is-dragging")) this.away(); // (the text changed: where the blocks are, too)
      }
      destroy(): void {
        this.grip.remove();
        this.view.dom.removeEventListener("mousemove", this.near);
        this.view.dom.removeEventListener("mouseleave", this.away);
      }
    },
  );
}
