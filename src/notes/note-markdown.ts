import { helper } from "suneditor";
import { readableMarkdown } from "./note-file";

/**
 * A markdown note as HTML, with the notes editor's own converter (SunEditor's GFM reader), which leaves a line break inside a paragraph as a bare
 * newline: the editor would drop it and join the words, so it is a `<br>`, the new line Obsidian shows. Imported lazily where Node must not load it.
 */
export function markdownHtml(text: string): string {
  const t = document.createElement("template");
  t.innerHTML = helper.markdown.markdownToHtml(readableMarkdown(text), "P");
  const walk = document.createTreeWalker(t.content, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walk.nextNode()) texts.push(walk.currentNode as Text);
  for (const n of texts) {
    // (the space between two marked words in a table cell: the editor drops a space alone between tags there)
    if (!n.data.trim() && n.data.includes(" ") && n.previousSibling && n.nextSibling && n.parentElement?.closest("td, th")) {
      n.data = "\u00a0";
      continue;
    }
    // (a code block's lines are `<br>` in the editor, which drops a bare newline there too)
    if (n.parentElement?.closest("pre")) {
      if (n.data.includes("\n")) n.replaceWith(...n.data.replace(/\n$/, "").split("\n").flatMap((line, i) => [...(i ? [document.createElement("br")] : []), line]));
      continue;
    }
    if (!n.data.includes("\n") || n.parentElement?.closest("code") || !n.data.trim()) continue;
    // (a line break at the very start or end of its block is no line of its own; beside a link or `code`, it is)
    const lines = n.data.split("\n");
    const first = !lines[0] && !n.previousSibling ? 1 : 0;
    const last = !lines[lines.length - 1] && !n.nextSibling ? lines.length - 2 : lines.length - 1;
    const parts: Array<string | Node> = [];
    for (let i = first; i <= last; i++) {
      if (i > first) parts.push(document.createElement("br"));
      if (lines[i]) parts.push(lines[i]!);
    }
    n.replaceWith(...parts);
  }
  return t.innerHTML;
}
