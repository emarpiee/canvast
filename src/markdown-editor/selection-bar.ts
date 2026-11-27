// The bar over selected words: Turn into (text, headings, lists, quote, code block), the inline formats and a link. Shown while the editor
// has the focus and words are selected, as a tooltip above them.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { COMMANDS, type FormatName } from "./commands";

export interface SelectionBarOptions {
  icons: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
}

const focusEffect = StateEffect.define<boolean>();
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
    turn.setAttribute("aria-haspopup", "menu");
    const menu = document.createElement("div");
    menu.className = "me-selbar-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    for (const name of TURN_INTO) {
      const item = btn(name, `${opts.icons[name] ?? ""}<span>${opts.labels[name] ?? name}</span>`, opts.labels[name] ?? name);
      item.className = "me-selbar-item";
      item.setAttribute("role", "menuitem");
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
      if (name === "turn") return void (menu.hidden = !menu.hidden);
      menu.hidden = true;
      COMMANDS[name as FormatName]?.(view);
      view.focus();
    });
    return { dom };
  };
}

/** The bar, as a tooltip over the main selection. */
export function selectionBar(opts: SelectionBarOptions): Extension {
  const create = bar(opts);
  const tooltip = (state: EditorState, focused: boolean): Tooltip | null => {
    const r = state.selection.main;
    if (r.empty || !focused) return null;
    return { pos: r.from, end: r.to, above: true, arrow: false, create };
  };
  const field = StateField.define<{ focused: boolean; tip: Tooltip | null }>({
    create: (state) => ({ focused: false, tip: tooltip(state, false) }),
    update(v, tr) {
      let focused = v.focused;
      for (const e of tr.effects) if (e.is(focusEffect)) focused = e.value;
      if (!tr.selection && !tr.docChanged && focused === v.focused) return v;
      return { focused, tip: tooltip(tr.state, focused) };
    },
    provide: (f) => showTooltip.compute([f], (s) => s.field(f).tip),
  });
  return [field, EditorView.focusChangeEffect.of((_s, on) => focusEffect.of(on))];
}

