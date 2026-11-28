// Behaviour: a click on a link or wiki link drawn as a link (live mode, the cursor not in it) follows it; Ctrl+click (⌘ on a Mac) follows
// one anywhere; a click on a link whose Markdown shows puts the cursor in it, to edit (as notes apps do); a web address only on a double-click.
// Test: notes.spec "[[links]]".
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);

/** The link, wiki link or address round `pos`. */
function linkAround(v: EditorView, pos: number): { from: number; to: number } | null {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(v.state).resolveInner(pos, 1); n; n = n.parent) if (/^(Link|WikiLink|Autolink|URL)$/.test(n.name)) return { from: n.from, to: n.to };
  return null;
}

/** The behaviour: `follow` the link element pressed; `live`: whether links are drawn as links now. */
export const linkFollow = (follow: (el: HTMLElement) => boolean, live: () => boolean) =>
  EditorView.domEventHandlers({
    mousedown: (e, v) => {
      if (e.button !== 0 || e.altKey || e.shiftKey) return false;
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-href], [data-wiki]");
      if (!t) return false;
      // (a web address is followed on a double-click only, a single click placing the cursor: the host may copy it rather than go online)
      const web = !t.dataset["wiki"] && /^([a-z][a-z0-9+.-]*:|www\.)/i.test(t.dataset["href"] ?? "");
      if (web && e.detail < 2) return false;
      if (!(isMac ? e.metaKey : e.ctrlKey)) {
        if (!live()) return false;
        const node = linkAround(v, v.posAtDOM(t));
        const sel = v.state.selection.main;
        if (!node || !(sel.to < node.from || sel.from > node.to)) return false;
      }
      if (!follow(t)) return false;
      e.preventDefault();
      return true;
    },
  });
