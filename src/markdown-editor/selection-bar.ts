// The bar over selected words: Turn into (text, headings, lists, quote, code block), the inline formats and a link. Shown while the editor
// has the focus and words are selected, as a tooltip above them.
import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, showTooltip, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { COMMANDS, type FormatName } from "./commands";

export interface SelectionBarOptions {
  icons: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
}

const INLINE: FormatName[] = ["bold", "italic", "strike", "highlight", "code", "link"];
const TURN_INTO: FormatName[] = ["paragraph", "heading1", "heading2", "heading3", "bulletList", "orderedList", "taskList", "quote", "codeBlock"];

function bar(opts: SelectionBarOptions): (view: EditorView) => { dom: HTMLElement } {
  return (view) => {
    const dom = document.createElement("div");
    dom.className = "me-selbar";
    dom.setAttribute("role", "toolbar");
    dom.setAttribute("aria-label", opts.labels["format"] ?? "Format");
    const btn = (name: string, inner: string, label: string): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "me-btn";
      b.dataset["me"] = name;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = inner;
      return b;
    };
    const turn = btn("turn", `<span>${opts.labels["turnInto"] ?? "Turn into"}</span>`, opts.labels["turnInto"] ?? "Turn into");
    turn.classList.add("me-selbar-turn");
    turn.setAttribute("aria-expanded", "false");
    // (a group of the block buttons the Turn into button shows and hides: the package carries no menu of its own)
    const menu = document.createElement("div");
    menu.className = "me-selbar-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", opts.labels["turnInto"] ?? "Turn into");
    menu.hidden = true;
    for (const name of TURN_INTO) {
      const item = btn(name, `${opts.icons[name] ?? ""}<span>${opts.labels[name] ?? name}</span>`, opts.labels[name] ?? name);
      item.className = "me-selbar-item";
      menu.append(item);
    }
    dom.append(turn, ...INLINE.map((n) => btn(n, opts.icons[n] ?? n, opts.labels[n] ?? n)), menu);
    // view-state: (a press on the bar keeps the selection in the text)
    dom.addEventListener("mousedown", (e) => e.preventDefault());
    // typing: (the bar's buttons write the note's Markdown; Turn into only opens its list)
    dom.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-me]");
      if (!b) return;
      const name = b.dataset["me"]!;
      if (name === "turn") return void ((menu.hidden = !menu.hidden), turn.setAttribute("aria-expanded", String(!menu.hidden)));
      menu.hidden = true;
      turn.setAttribute("aria-expanded", "false");
      COMMANDS[name as FormatName]?.(view);
      view.focus();
    });
    return { dom };
  };
}

/** The bar, as a tooltip over the main selection: there whenever words are selected, hidden while the editor has not the focus (a class
 *  set from the view itself, so the first selection after a note opens shows it at once). */
export function selectionBar(opts: SelectionBarOptions): Extension {
  const create = bar(opts);
  const tooltip = (state: EditorState): Tooltip | null => {
    const r = state.selection.main;
    return r.empty ? null : { pos: r.from, end: r.to, above: true, arrow: false, create };
  };
  const field = StateField.define<Tooltip | null>({
    create: tooltip,
    update: (v, tr) => (tr.selection || tr.docChanged ? tooltip(tr.state) : v),
    provide: (f) => showTooltip.from(f),
  });
  const focusClass = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        view.dom.classList.toggle("me-blurred", !view.hasFocus);
      }
      update(u: ViewUpdate): void {
        if (u.focusChanged) u.view.dom.classList.toggle("me-blurred", !u.view.hasFocus);
      }
    },
  );
  return [field, focusClass];
}

/**
 * The same bar, floating over words selected outside the editor's text (a table's cell): the inline formats, each calling `pick` with its
 * name. Returns what closes it.
 */
export function floatingBar(opts: SelectionBarOptions, at: DOMRect, pick: (name: FormatName) => void, parent: HTMLElement = document.body): () => void {
  const dom = document.createElement("div");
  dom.className = "me-selbar me-selbar-floating";
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", opts.labels["format"] ?? "Format");
  for (const n of INLINE) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "me-btn";
    b.dataset["me"] = n;
    b.title = opts.labels[n] ?? n;
    b.setAttribute("aria-label", opts.labels[n] ?? n);
    b.innerHTML = opts.icons[n] ?? n;
    dom.append(b);
  }
  // view-state: (a press on the bar keeps the selection in the cell)
  dom.addEventListener("mousedown", (e) => e.preventDefault());
  // typing: (the bar's buttons write the cell's Markdown)
  dom.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-me]");
    if (b) pick(b.dataset["me"] as FormatName);
  });
  parent.append(dom);
  dom.style.left = `${Math.max(4, Math.min(at.left, innerWidth - dom.offsetWidth - 4))}px`;
  dom.style.top = `${Math.max(4, at.top - dom.offsetHeight - 6)}px`;
  return () => dom.remove();
}

