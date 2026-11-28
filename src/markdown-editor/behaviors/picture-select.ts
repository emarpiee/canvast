// Behaviour: pictures in live mode are drawn, never opened into their Markdown by the cursor; a click, or an arrow key reaching one, selects
// it. Selected: + and − resize it, 0 takes its size off, Backspace or Delete removes it, Ctrl+C / Ctrl+X copy or cut it, Enter edits its
// Markdown, Tab its size, Space opens it full size, Escape lets go (as notes apps do since 2026). Test: notes.spec "pictures".
import { syntaxTree } from "@codemirror/language";
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openLightbox, type LightboxWords } from "../lightbox";
import { withAlt, type PictureAlt } from "../picture-alt";

export interface PictureRange {
  from: number;
  to: number;
  embed: boolean;
}

/** The picture whose Markdown is being edited (Enter or Tab on a selected one): where it starts, or null. */
export const setPictureEdit = StateEffect.define<number | null>();
export const pictureEdit = StateField.define<number | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPictureEdit)) return e.value;
    if (v === null) return null;
    const at = tr.changes.mapPos(v);
    // (done once the cursor leaves the picture's line)
    return tr.state.doc.lineAt(at).number === tr.state.doc.lineAt(tr.state.selection.main.head).number ? at : null;
  },
});

/** The picture starting at `from` (or, with `side` -1, ending at it). */
export function pictureAt(state: EditorState, pos: number, side: 1 | -1): PictureRange | null {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
    if (n.name === "Image" || n.name === "Embed") return (side === 1 ? n.from === pos : n.to === pos) ? { from: n.from, to: n.to, embed: n.name === "Embed" } : null;
  }
  return null;
}

/** The selected picture: the selection is exactly one picture's Markdown (and it is not being edited). */
export function selectedPicture(state: EditorState): PictureRange | null {
  const sel = state.selection.main;
  if (sel.empty || state.selection.ranges.length > 1 || state.field(pictureEdit, false) === sel.from) return null;
  const p = pictureAt(state, sel.from, 1);
  return p && p.to === sel.to ? p : null;
}

export const selectPicture = (view: EditorView, p: { from: number; to: number }): void => {
  view.dispatch({ selection: { anchor: p.from, head: p.to }, effects: setPictureEdit.of(null), scrollIntoView: true });
  view.focus();
};

/** The picture's link with its alt part changed (picture-alt.ts), the picture still selected. */
function changeAlt(view: EditorView, p: { from: number; to: number }, change: (a: PictureAlt) => PictureAlt, userEvent: string): void {
  const src = view.state.sliceDoc(p.from, p.to);
  const next = withAlt(src, change);
  if (next === null || next === src) return;
  view.dispatch({ changes: { from: p.from, to: p.to, insert: next }, selection: { anchor: p.from, head: p.from + next.length }, userEvent });
}
/** The picture's width written into its Markdown (`![alt|300](…)`, `![[cat.png|300]]`), or taken off with null. */
export function setPictureWidth(view: EditorView, p: { from: number; to: number }, width: number | null): void {
  changeAlt(view, p, (a) => ({ ...a, width: width === null ? null : Math.max(32, Math.round(width)), height: null }), "input.resize");
}
/** A copy of the picture's link on a line under it. */
export function duplicatePicture(view: EditorView, p: { from: number; to: number }): void {
  const src = view.state.sliceDoc(p.from, p.to);
  view.dispatch({ changes: { from: p.to, insert: `\n${src}` }, selection: { anchor: p.to + 1, head: p.to + 1 + src.length }, userEvent: "input.picture" });
}
/** The picture's link taken out of the note (its file stays in the library). */
export const deletePicture = (view: EditorView, p: { from: number; to: number }): void =>
  view.dispatch({ changes: { from: p.from, to: p.to }, selection: { anchor: p.from }, userEvent: "delete.picture" });

/** The note's pictures as drawn, for the full-size view's arrows (`shortcut: only the pictures drawn now, in and near the view; read the
 *  document's pictures if notes with many far-apart pictures need them all`). */
const drawnPictures = (view: EditorView): HTMLImageElement[] => [...view.contentDOM.querySelectorAll<HTMLImageElement>(".me-media img")];

/** Open the picture at `from` full size. */
export function viewPicture(view: EditorView, from: number, words: LightboxWords): boolean {
  const all = drawnPictures(view);
  const i = all.findIndex((img) => img.closest<HTMLElement>(".me-media")?.dataset["from"] === String(from));
  if (i < 0) return false;
  openLightbox(all.map((img) => ({ src: img.src, alt: img.alt })), i, words);
  return true;
}

/** The behaviour (live mode only). */
export const pictureSelect = (words: LightboxWords, live: () => boolean): Extension => [
  pictureEdit,
  Prec.high(
    EditorView.domEventHandlers({
      keydown: (e, view) => {
        if (!live() || e.altKey) return false;
        const mod = e.ctrlKey || e.metaKey;
        const sel = view.state.selection.main;
        const p = selectedPicture(view.state);
        if (!p) {
          // (an arrow reaching a picture selects it, as one step)
          if (mod || e.shiftKey || !sel.empty || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return false;
          const q = pictureAt(view.state, sel.head, e.key === "ArrowRight" ? 1 : -1);
          if (!q || view.state.field(pictureEdit, false) === q.from) return false;
          e.preventDefault();
          selectPicture(view, q);
          return true;
        }
        if (mod) return false;
        const img = view.contentDOM.querySelector<HTMLImageElement>(`.me-media[data-from="${p.from}"] img`);
        const step = (k: number): void => void (img && setPictureWidth(view, p, img.getBoundingClientRect().width * k));
        switch (e.key) {
          case "+": case "=": step(1.1); break;
          case "-": case "_": step(1 / 1.1); break;
          case "0": setPictureWidth(view, p, null); break;
          case " ": viewPicture(view, p.from, words); break;
          case "ArrowRight": case "ArrowDown": view.dispatch({ selection: { anchor: p.to } }); break;
          case "ArrowLeft": case "ArrowUp": view.dispatch({ selection: { anchor: p.from } }); break;
          case "Escape": view.dispatch({ selection: { anchor: p.to } }); break;
          case "Enter": view.dispatch({ effects: setPictureEdit.of(p.from), selection: { anchor: p.to } }); break;
          case "Tab": {
            // (its size selected, or a place for one made)
            const src = view.state.sliceDoc(p.from, p.to);
            const m = p.embed ? /\|(\d+(?:x\d+)?)\]\]$/.exec(src) ?? /\|(\d+(?:x\d+)?)\|/.exec(src) : /\|(\d+(?:x\d+)?)\]/.exec(src);
            if (m) {
              const a = p.from + m.index + 1;
              view.dispatch({ effects: setPictureEdit.of(p.from), selection: { anchor: a, head: a + m[1]!.length } });
            } else {
              const at = p.embed ? p.to - 2 : p.from + src.indexOf("](");
              view.dispatch({ effects: setPictureEdit.of(p.from), changes: { from: at, insert: "|" }, selection: { anchor: at + 1 } });
            }
            break;
          }
          default: return false;
        }
        e.preventDefault();
        return true;
      },
    }),
  ),
];
