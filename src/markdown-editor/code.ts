// Colours in fenced code blocks, in live and source mode. The host tokenizes (`codeSpans`), so the package carries no grammars; each span gets
// the class `me-tok-<group>`, coloured by `--me-tok-<group>`.
import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { refresh } from "./live";
import { guessLanguage } from "./detect";

export interface CodeSpan {
  readonly group: string;
  readonly start: number;
  readonly end: number;
}
export type CodeSpans = (text: string, language: string) => Promise<readonly CodeSpan[]>;

/** Code longer than this is left uncoloured (a pasted log). */
const MAX_CODE = 50_000;

export function codeColours(spans: CodeSpans): Extension {
  const known = new Map<string, readonly CodeSpan[] | null>();
  const build = (view: EditorView): DecorationSet => {
    const out: Range<Decoration>[] = [];
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter: (ref) => {
          if (ref.name !== "FencedCode") return;
          const info = ref.node.getChild("CodeInfo");
          const body = ref.node.getChild("CodeText");
          if (!body || body.to - body.from > MAX_CODE) return false;
          const code = view.state.sliceDoc(body.from, body.to);
          // (a block that names no language is coloured as its guess)
          const lang = info ? view.state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0]!.toLowerCase() : (guessLanguage(code) ?? "");
          if (!lang) return false;
          const key = `${lang}\0${code}`;
          if (!known.has(key)) {
            known.set(key, null);
            if (known.size > 200) known.delete(known.keys().next().value!);
            void spans(code, lang).then(
              (got) => {
                known.set(key, got);
                if (view.dom.isConnected) view.dispatch({ effects: refresh.of(null) });
              },
              () => known.set(key, []),
            );
          }
          for (const s of known.get(key) ?? []) if (s.end > s.start) out.push(Decoration.mark({ class: `me-tok-${s.group}` }).range(body.from + s.start, body.from + Math.min(s.end, code.length)));
          return false;
        },
      });
    }
    return Decoration.set(out, true);
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
