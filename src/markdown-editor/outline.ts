// The note's outline: every heading in its hierarchy, floating at the left or the right of the editor, as a word processor's navigation
// pane. A click on a heading puts its line in view with the cursor at its end (in preview: the heading in view). Its height is the
// person's, by a grip shown on hover, never more than the editor's view. The text makes room for it: nothing is ever under it.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { stripMarks } from "./behaviors/clear-format";
import { frontmatterLength } from "./render";

export type OutlineSide = "off" | "left" | "right";

/** A heading of the note: its level, its words (marks off) and its line. */
export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** The note's headings in order (the properties at its top left out). */
export function headingsOf(state: EditorState): Heading[] {
  const out: Heading[] = [];
  const skip = frontmatterLength(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
  syntaxTree(state).iterate({
    enter: (n) => {
      const m = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(n.name);
      if (!m) return n.name === "Document" ? undefined : false;
      if (n.from < skip) return false;
      const line = state.doc.lineAt(n.from);
      const words = n.name.startsWith("ATX") ? line.text.replace(/^\s*#{1,6}\s*/, "").replace(/\s+#+\s*$/, "") : line.text;
      out.push({ level: Number(m[1]), text: stripMarks(words).trim(), line: line.number });
      return false;
    },
  });
  return out;
}

export interface Outline {
  /** Where it floats now. */
  readonly side: OutlineSide;
  set(side: OutlineSide): void;
  /** The headings again (the text changed), and the one the cursor is under. */
  update(): void;
  /** Its place again (the mode, the find bar, the editor's size changed). */
  place(): void;
  destroy(): void;
}

export function mountOutline(body: HTMLElement, view: EditorView, opts: { previewing(): boolean; page: HTMLElement; labels: { outline: string; noHeadings: string; resize: string } }): Outline {
  let side: OutlineSide = "off";
  let height: number | null = null; // (set by its grip; null: as tall as its headings, up to the view)
  const box = document.createElement("nav");
  box.className = "me-outline";
  box.hidden = true;
  box.setAttribute("aria-label", opts.labels.outline);
  const list = document.createElement("ol");
  list.className = "me-outline-list";
  const grip = document.createElement("div");
  grip.className = "me-outline-grip";
  grip.title = opts.labels.resize;
  grip.setAttribute("aria-hidden", "true");
  box.append(list, grip);
  body.append(box);
  let heads: Heading[] = [];

  /** Room above and below it: the editor's own padding, and the find bar while it is open. */
  const room = (): { top: number; bottom: number } => {
    const pad = parseFloat(getComputedStyle(body).getPropertyValue("--me-pad")) || 24;
    const panels = opts.previewing() ? 0 : (view.dom.querySelector<HTMLElement>(".cm-panels-top")?.offsetHeight ?? 0);
    return { top: panels + pad / 2, bottom: pad / 2 };
  };
  const place = (): void => {
    // (no room beside the text, a narrow editor: it does not show, rather than cover the words)
    const fits = body.clientWidth >= 560;
    box.hidden = side === "off" || !fits;
    body.classList.toggle("has-outline-left", side === "left" && fits);
    body.classList.toggle("has-outline-right", side === "right" && fits);
    if (box.hidden) return;
    const r = room();
    const most = Math.max(80, body.clientHeight - r.top - r.bottom);
    box.style.top = `${r.top}px`;
    box.style.maxHeight = `${most}px`;
    box.style.height = height === null ? "" : `${Math.min(height, most)}px`;
  };
  const active = (): number => {
    if (opts.previewing()) return -1;
    const at = view.state.doc.lineAt(view.state.selection.main.head).number;
    let k = -1;
    heads.forEach((h, i) => void (h.line <= at && (k = i)));
    return k;
  };
  const draw = (): void => {
    heads = headingsOf(view.state);
    const top = Math.min(...heads.map((h) => h.level), 6);
    const k = active();
    list.innerHTML = heads.length
      ? heads.map((h, i) => `<li><button type="button" class="me-outline-item${i === k ? " is-active" : ""}" data-i="${i}" style="--me-outline-depth: ${h.level - top}" title="${escape(h.text)}">${escape(h.text) || "&nbsp;"}</button></li>`).join("")
      : `<li class="me-outline-empty">${escape(opts.labels.noHeadings)}</li>`;
  };
  // view-state: (a press keeps the focus in the words; a click goes to the heading)
  box.addEventListener("mousedown", (e) => void (!(e.target as Element).closest(".me-outline-grip") && e.preventDefault()));
  // view-state: (goes to a heading: its line in view, the cursor at its end)
  list.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>(".me-outline-item");
    const h = b ? heads[Number(b.dataset["i"])] : undefined;
    if (!h) return;
    if (opts.previewing()) return void opts.page.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")[Number(b!.dataset["i"])]?.scrollIntoView({ block: "start" });
    const line = view.state.doc.line(Math.min(h.line, view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.to }, effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }) });
    view.focus();
  });
  // view-state: (its height, by the grip at its foot: never more than the view)
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    box.classList.add("is-resizing");
    const y0 = e.clientY, h0 = box.offsetHeight;
    const move = (m: PointerEvent): void => {
      const r = room();
      height = Math.round(Math.max(80, Math.min(body.clientHeight - r.top - r.bottom, h0 + m.clientY - y0)));
      place();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", () => (grip.removeEventListener("pointermove", move), box.classList.remove("is-resizing")), { once: true });
  });
  const sizes = new ResizeObserver(() => side !== "off" && place());
  sizes.observe(body);
  return {
    get side() {
      return side;
    },
    set(s) {
      side = s;
      if (s !== "off") draw();
      place();
    },
    update() {
      if (side !== "off") draw();
    },
    place,
    destroy() {
      sizes.disconnect();
      box.remove();
      body.classList.remove("has-outline-left", "has-outline-right");
    },
  };
}

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
