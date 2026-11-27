// Behaviour: what a paste or a drop puts in. A web address or a `[[link]]` pasted over words on one line makes them the link (as canvast's
// first notes editor did); a page (HTML) becomes Markdown unless its plain text is Markdown already; files go to the host, and pictures go
// on lines of their own, never inside a heading or a sentence; in code, words are pasted as they are. Test: notes.spec "a note copied from
// another notes app", "a markdown note opens in live mode".
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { pastedMarkdown } from "../html-to-markdown";

export interface PasteHost {
  files?(files: File[]): Promise<string | null>;
  pasting?(markdown: string): string;
}

const inCodeBlock = (v: EditorView, pos: number): boolean => {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(v.state).resolveInner(pos, -1); n; n = n.parent) if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  return false;
};

/** Markdown on lines of its own at the cursor (a picture: never inside a heading or a sentence). */
export function insertBlockMarkdown(v: EditorView, md: string): void {
  const r = v.state.selection.main;
  const line = v.state.doc.lineAt(r.from), endLine = v.state.doc.lineAt(r.to);
  const before = line.text.slice(0, r.from - line.from).trim() ? "\n\n" : "";
  const after = endLine.text.slice(r.to - endLine.from).trim() ? "\n\n" : "";
  v.dispatch({ changes: { from: r.from, to: r.to, insert: `${before}${md}${after}` }, selection: { anchor: r.from + before.length + md.length }, scrollIntoView: true, userEvent: "input.paste" });
}

/** The behaviour (`plain`: a plain text note takes words as words). */
export const pasteRules = (host: PasteHost, plain: boolean) =>
  EditorView.domEventHandlers({
    paste: (e, v) => {
      const data = e.clipboardData;
      if (!data) return false;
      const files = [...data.files];
      if (files.length && host.files) {
        e.preventDefault();
        void host.files(files).then((md) => md && insertBlockMarkdown(v, md));
        return true;
      }
      if (plain || inCodeBlock(v, v.state.selection.main.head)) return false;
      const text = data.getData("text/plain");
      const html = data.getData("text/html");
      const sel = v.state.selection.main;
      const words = v.state.sliceDoc(sel.from, sel.to);
      const address = text.trim();
      const wiki = /^\[\[([^[\]|\n]+)\]\]$/.exec(address);
      if (words.trim() && !words.includes("\n") && (wiki || /^(https?:\/\/|mailto:)\S+$/i.test(address))) {
        e.preventDefault();
        v.dispatch(v.state.replaceSelection(wiki ? `[[${wiki[1]}|${words}]]` : `[${words}](${address})`), { scrollIntoView: true, userEvent: "input.paste" });
        return true;
      }
      if (!html && !host.pasting) return false;
      let md = pastedMarkdown(text, html);
      if (host.pasting) md = host.pasting(md);
      e.preventDefault();
      v.dispatch(v.state.replaceSelection(md), { scrollIntoView: true, userEvent: "input.paste" });
      return true;
    },
    drop: (e, v) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length || !host.files) return false;
      e.preventDefault();
      const at = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
      v.dispatch({ selection: { anchor: at } });
      void host.files(files).then((md) => md && insertBlockMarkdown(v, md));
      return true;
    },
  });
