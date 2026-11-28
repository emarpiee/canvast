// The editor's right-click menu (also the keyboard's Menu key, Shift+F10): the link under the pointer (open it, copy it), highlights in
// colours (selected words), cut, copy, paste, a callout (make one of the block, change its type, take it off), select all, undo, redo.
import { redo, selectAll, undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { openPopover, type PopItem } from "./popover";

export interface MenuWords {
  open: string; openNote: string; copyLink: string; highlight: string; highlightIn: string; removeHighlight: string; cut: string; copy: string; paste: string;
  toCallout: string; calloutType: string; removeCallout: string; selectAll: string; undo: string; redo: string; menu: string;
  colours: Readonly<Record<string, string>>;
}

/** The highlight colours: yellow is `==…==`, the others `<mark class="hl-…">`. */
/** The highlight colours (as notes apps offer them): the default is `==words==`, the others `<mark class="hl-red">`, each a colour of the
 *  theme, so light and dark alike. */
export const HIGHLIGHTS = ["default", "red", "orange", "yellow", "green", "blue", "purple"] as const;

/** The highlight choices for a menu: each colour, then taking it off. */
export function highlightItems(view: EditorView, words: { highlight: string; colours: Record<string, string>; removeHighlight: string }, range?: { from: number; to: number }): PopItem[] {
  return [
    ...HIGHLIGHTS.map((c): PopItem => ({ id: `highlight.${c}`, label: words.colours[c] ?? c, ...(c === "default" ? { detail: "Ctrl+Shift+H" } : {}), pick: () => applyHighlight(view, c, range) })),
    { id: "highlight.remove", label: words.removeHighlight, sep: true, pick: () => applyHighlight(view, "remove", range) },
  ];
}

/** Highlight the selection in a colour (or take a highlight off it). */
export function applyHighlight(view: EditorView, colour: (typeof HIGHLIGHTS)[number] | "remove", range: { from: number; to: number } = view.state.selection.main): void {
  const { state } = view;
  let { from, to } = range;
  // (the highlight round the selection, or the selection's own marks)
  const around = (open: RegExp, close: string): { from: number; to: number; inner: string } | null => {
    const line = state.doc.lineAt(from);
    const before = state.sliceDoc(line.from, from), after = state.sliceDoc(to, line.to);
    const o = open.exec(before), c = after.startsWith(close) ? close.length : -1;
    if (o && c >= 0) return { from: from - o[0].length, to: to + c, inner: state.sliceDoc(from, to) };
    const sel = state.sliceDoc(from, to);
    const whole = new RegExp(`^${open.source.replace(/\$$/, "")}([\\s\\S]*)${close.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`).exec(sel);
    return whole ? { from, to, inner: whole[whole.length - 1]! } : null;
  };
  const existing = around(/==$/, "==") ?? around(/<mark class="hl-\w+">$/, "</mark>");
  if (existing) {
    from = existing.from;
    to = existing.to;
  }
  const words = existing ? existing.inner : state.sliceDoc(from, to);
  const insert = colour === "remove" ? words : colour === "default" ? `==${words}==` : `<mark class="hl-${colour}">${words}</mark>`;
  const start = colour === "remove" ? from : colour === "default" ? from + 2 : from + `<mark class="hl-${colour}">`.length;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: start, head: start + words.length }, userEvent: "input.format" });
  view.focus();
}

/** The link at `pos`: its address or wiki target. */
function linkAt(view: EditorView, pos: number): { link: string; wiki: boolean } | null {
  const { state } = view;
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "WikiLink") {
      const t = n.getChild("WikiTarget");
      return t ? { link: state.sliceDoc(t.from, t.to).trim(), wiki: true } : null;
    }
    if (n.name === "Link" || n.name === "Autolink") {
      const u = n.getChild("URL");
      return u ? { link: state.sliceDoc(u.from, u.to).replace(/^<|>$/g, ""), wiki: false } : null;
    }
    if (n.name === "URL") return { link: state.sliceDoc(n.from, n.to), wiki: false };
  }
  return null;
}

const CALLOUT_HEAD = /^(\s*>\s?)\[!(\w+)\]([-+])?\s?/;

/** Open the menu at a point (a right click) or at the cursor (the keyboard). */
export function openContextMenu(view: EditorView, at: { x: number; y: number }, words: MenuWords, callouts: readonly string[], follow: (link: string, wiki: boolean) => void): void {
  const { state } = view;
  const sel = state.selection.main;
  const pos = view.posAtCoords(at) ?? sel.head;
  const link = linkAt(view, pos);
  const items: PopItem[] = [];
  const focusRun = (f: () => void) => () => (f(), view.focus());
  if (link) {
    items.push({ id: "openLink", label: link.wiki ? words.openNote : words.open, pick: () => follow(link.link, link.wiki) });
    items.push({ id: "copyLink", label: words.copyLink, pick: () => void navigator.clipboard?.writeText(link.wiki ? `[[${link.link}]]` : link.link).catch(() => undefined) });
  }
  if (!sel.empty) {
    const range = { from: sel.from, to: sel.to };
    const hl = highlightItems(view, words, range).map((it) => (it.id === "highlight.remove" ? it : { ...it, label: it.id === "highlight.default" ? words.highlight : `${words.highlightIn} ${it.label}` }));
    items.push({ ...hl[0]!, sep: items.length > 0 }, ...hl.slice(1).map((it) => ({ ...it, sep: false })));
  }
  const copy = (): void => void navigator.clipboard?.writeText(view.state.sliceDoc(sel.from, sel.to)).catch(() => undefined);
  items.push({ id: "cut", label: words.cut, detail: "Ctrl+X", sep: items.length > 0, disabled: sel.empty, pick: focusRun(() => (copy(), view.dispatch({ changes: { from: sel.from, to: sel.to }, userEvent: "delete.cut" }))) });
  items.push({ id: "copy", label: words.copy, detail: "Ctrl+C", disabled: sel.empty, pick: copy });
  items.push({ id: "paste", label: words.paste, detail: "Ctrl+V", pick: () => void navigator.clipboard?.readText().then((t) => t && view.dispatch(view.state.replaceSelection(t), { userEvent: "input.paste" }), () => undefined).finally(() => view.focus()) });
  // A callout: the block (its lines) made one, its type changed, or taken off.
  const line = state.doc.lineAt(sel.head);
  let head = line;
  while (head.number > 1 && /^\s*>/.test(head.text) && !CALLOUT_HEAD.test(head.text) && /^\s*>/.test(state.doc.line(head.number - 1).text)) head = state.doc.line(head.number - 1);
  const isCallout = CALLOUT_HEAD.test(head.text);
  const chooseType = (put: (type: string) => void): void => openPopover(new DOMRect(at.x, at.y, 0, 0), callouts.map((c) => ({ id: `callout.${c}`, label: c.charAt(0).toUpperCase() + c.slice(1), pick: () => put(c) })), words.calloutType);
  if (isCallout) {
    items.push({ id: "calloutType", label: words.calloutType, sep: true, pick: () => setTimeout(() => chooseType((type) => {
      const m = CALLOUT_HEAD.exec(head.text)!;
      const from = head.from + m[1]!.length + 2;
      view.dispatch({ changes: { from, to: from + m[2]!.length, insert: type }, userEvent: "input.format" });
    })) });
    items.push({ id: "removeCallout", label: words.removeCallout, pick: () => {
      const changes = [];
      const m = CALLOUT_HEAD.exec(head.text)!;
      changes.push({ from: head.from + m[1]!.length, to: head.from + m[0].length });
      for (let n = head.number; n <= state.doc.lines && /^\s*>/.test(state.doc.line(n).text); n++) {
        const l = state.doc.line(n);
        const q = /^\s*>\s?/.exec(l.text)!;
        changes.push({ from: l.from, to: l.from + q[0].length });
      }
      view.dispatch({ changes, userEvent: "input.format" });
    } });
  } else if (line.text.trim()) {
    items.push({ id: "toCallout", label: words.toCallout, sep: true, pick: () => setTimeout(() => chooseType((type) => {
      // (the paragraph round the cursor, quoted, under a title line)
      let a = line.number, b = line.number;
      while (a > 1 && state.doc.line(a - 1).text.trim()) a--;
      while (b < state.doc.lines && state.doc.line(b + 1).text.trim()) b++;
      const changes = [{ from: state.doc.line(a).from, insert: `> [!${type}]\n` }];
      for (let n = a; n <= b; n++) {
        const l = state.doc.line(n);
        changes.push({ from: l.from, insert: /^\s*>/.test(l.text) ? "" : "> " });
      }
      view.dispatch({ changes, userEvent: "input.format" });
    })) });
  }
  items.push({ id: "selectAll", label: words.selectAll, detail: "Ctrl+A", sep: true, pick: focusRun(() => selectAll(view)) });
  items.push({ id: "undo", label: words.undo, detail: "Ctrl+Z", sep: true, pick: focusRun(() => undo(view)) });
  items.push({ id: "redo", label: words.redo, detail: "Ctrl+Shift+Z", pick: focusRun(() => redo(view)) });
  openPopover(new DOMRect(at.x, at.y, 0, 0), items, words.menu);
}
