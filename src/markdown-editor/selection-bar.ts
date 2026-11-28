// The bar over selected words: Turn into (text, headings, lists, quote, code block), the inline formats and a link. Shown while the editor
// has the focus and words are selected, as a tooltip above them.
import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, showTooltip, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { COMMANDS, type FormatName } from "./commands";
import { HIGHLIGHTS, highlightItems } from "./context-menu";
import { clearFormat } from "./behaviors/clear-format";
import { openPopover, type PopItem } from "./popover";

export interface SelectionBarOptions {
  icons: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
  /** What Turn into offers (a table cell: only what a cell can hold); false: no Turn into. Default: every block. */
  turnInto?: readonly FormatName[] | false;
}

/** A selection that is one embed and nothing else: `![[file]]` or `![alt](src)`. */
const EMBED_ALONE = /^!(\[\[[^\]\n]*\]\]|\[[^\]\n]*\]\([^)\n]*\))$/;
const INLINE: FormatName[] = ["bold", "italic", "strike", "highlight", "code", "link"];
const TURN_INTO: FormatName[] = ["paragraph", "heading1", "heading2", "heading3", "bulletList", "orderedList", "taskList", "quote", "callout", "codeBlock", "mathBlock", "table"];

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
    turn.setAttribute("aria-haspopup", "menu");
    /** Turn into's blocks, in the editor's one list of choices (the host's menu: inside the window, above every bar). */
    const turnItems = (): PopItem[] => (opts.turnInto || TURN_INTO).map((name) => ({ id: `turn.${name}`, label: opts.labels[name] ?? name, pick: () => (COMMANDS[name]?.(view), view.focus()) }));
    const clear = btn("clearFormat", opts.icons["clearFormat"] ?? "", opts.labels["clearFormat"] ?? "Clear formatting");
    dom.append(...(opts.turnInto === false ? [] : [turn]), ...INLINE.map((n) => btn(n, opts.icons[n] ?? n, opts.labels[n] ?? n)), clear);
    // view-state: (a press on the bar keeps the selection in the text)
    dom.addEventListener("mousedown", (e) => e.preventDefault());
    // typing: (the bar's buttons write the note's Markdown; Turn into only opens its list)
    dom.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-me]");
      if (!b) return;
      const name = b.dataset["me"]!;
      if (name === "turn") return void openPopover(turn, turnItems(), opts.labels["turnInto"] ?? "Turn into");
      // (Highlight: its colours, as notes apps offer them; Clear formatting: the words' marks off)
      if (name === "highlight") return void openPopover(b, highlightItems(view, { highlight: opts.labels["highlight"] ?? "Highlight", removeHighlight: opts.labels["removeHighlight"] ?? "Remove highlight", colours: Object.fromEntries(HIGHLIGHTS.map((c) => [c, opts.labels[c] ?? c])) }), opts.labels["highlight"] ?? "Highlight");
      if (name === "clearFormat") return void (clearFormat(view), view.focus());
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
    // (an embed selected alone, a picture clicked: its own tools, no format bar over them)
    if (r.empty || EMBED_ALONE.test(state.sliceDoc(r.from, r.to))) return null;
    return { pos: r.from, end: r.to, above: true, arrow: false, create };
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
