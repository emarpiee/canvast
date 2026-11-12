import { FENCE_TICK, obsidianMarkdown } from "./note-file";
import { helper } from "suneditor";
import { WIKI, encodeLinkPart, readableMarkdown } from "./note-file";
import { parseProps, splitFrontmatter, type Prop } from "./frontmatter";

/** A code block's lines as `<br>`: the editor drops a bare newline there. Its words may be split into coloured parts, a newline alone in one. */
function codeLines(pre: Element): void {
  const walk = pre.ownerDocument.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walk.nextNode()) texts.push(walk.currentNode as Text);
  const end = texts[texts.length - 1];
  if (end) end.data = end.data.replace(/\n$/, "");
  for (const n of texts) {
    if (n.data.includes("\n")) n.replaceWith(...n.data.split("\n").flatMap((line, i) => [...(i ? [pre.ownerDocument.createElement("br")] : []), line]));
  }
}

/** A picture in a table cell as the editor's own component: bare, the editor takes it out of the table. */
function cellPictures(root: ParentNode, doc: Document): void {
  for (const img of root.querySelectorAll("td img, th img")) {
    const box = doc.createElement("div");
    box.className = "se-component se-image-container __se__float-none";
    const figure = doc.createElement("figure");
    img.replaceWith(box);
    box.append(figure);
    figure.append(img);
  }
}

/** What is pasted from Obsidian: as this note's content, and its properties, which go in with the note's own at the next save. */
export interface Pasted<T> {
  content: T;
  props: Prop[];
}

/** A line that starts a markdown block: a list item (a task too), a heading, a quote, a fence or a table row. */
const MD_BLOCK = /^[ \t]{0,3}(?:[-*+][ \t]+\S|\d{1,9}[.)][ \t]+\S|#{1,6}[ \t]+\S|>[ \t]?\S|```|~~~|\|.*\|[ \t]*$)/m;
/** Inline markdown: bold, code, a link with its address, a wiki link. */
const MD_INLINE = /\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\[\[[^\]\n]+\]\]/;
/** Elements of a page that are its structure: HTML with none of them is words laid out, not a page drawn from markdown. */
const HTML_STRUCTURE = /<(?:ul|ol|li|h[1-6]|blockquote|table|pre|strong|b|em|i|code|a)\b/i;

/**
 * Markdown on the clipboard that the editor would not read as it stands, ready for `markdownHtml`; else null: Obsidian's own source
 * (`![[embeds]]`, properties, `[[links]]` and `[^footnotes]` over lines), and any markdown that comes as words (a chat app's or a
 * terminal's copy, a `.md` file in a text editor: `html` empty or holding the same words without lists, headings or marks). Words with
 * no markdown in them are left to the editor, as they are.
 */
export function pastedMarkdown(text: string, html = ""): Pasted<string> | null {
  const t = text.replace(/\r\n/g, "\n");
  const { props, body } = splitFrontmatter(t);
  const obsidian = !!props || /!\[\[/.test(t) || (t.includes("\n") && /\[\[|\[\^/.test(t));
  const words = !HTML_STRUCTURE.test(html) && (MD_BLOCK.test(body) || MD_INLINE.test(body));
  if (!obsidian && !words) return null;
  return { content: body, props: props ?? [] };
}

/**
 * The marks of a markdown block a writer escapes in a paragraph's lines (`1\.`, `\-`, `\#`, `\>`), taken off, so the lines are read as
 * the list, heading or quote they say (a note pasted or typed before lists were read from words; see `readMarks` in the notes editor).
 * An indent written with no-break spaces is spaces again (a list inside a list).
 */
export function unescapeMarks(md: string): string {
  return md
    .split("\n")
    .map((line) => line.replace(/^([ \t ]*)(?:(\d{1,9})\\([.)])|\\([-*+>#]))/, (_m, lead: string, n?: string, dot?: string, mark?: string) => `${lead.replace(/ /g, " ")}${n !== undefined ? `${n}${dot}` : mark}`))
    .join("\n");
}

/** What Obsidian puts on the clipboard as HTML (a page it drew, when no source came with it), with its embeds and links as this app's own; else null. */
export function pastedHtml(html: string): Pasted<string> | null {
  if (!/internal-embed|internal-link|frontmatter|\bsrc="app:\/\//.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const picture = (name: string, alt: string): HTMLImageElement => {
    const img = doc.createElement("img");
    img.setAttribute("src", `${WIKI}${encodeLinkPart(name)}`);
    img.setAttribute("alt", alt);
    return img;
  };
  const props = [...doc.body.querySelectorAll(".frontmatter")].flatMap((n) => parseProps((n.textContent ?? "").trim().split("\n")));
  for (const n of doc.body.querySelectorAll(".copy-code-button, .frontmatter, .metadata-container")) n.remove();
  for (const n of doc.body.querySelectorAll(".internal-embed[src]")) {
    const name = n.getAttribute("src")!;
    n.replaceWith(picture(name, name.split("/").pop()!));
  }
  for (const n of doc.body.querySelectorAll('img[src^="app://"]')) {
    let name = (n.getAttribute("src")!.split(/[?#]/)[0] ?? "").split("/").pop()!;
    try {
      name = decodeURIComponent(name);
    } catch {
      // (written as it is)
    }
    n.replaceWith(picture(name, name));
  }
  for (const a of doc.body.querySelectorAll("a.internal-link[data-href]")) a.setAttribute("href", `${WIKI}${encodeLinkPart(a.getAttribute("data-href")!)}`);
  for (const pre of doc.body.querySelectorAll("pre")) codeLines(pre);
  cellPictures(doc.body, doc);
  return { content: doc.body.innerHTML, props };
}

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
    if (n.parentElement?.closest("pre")) continue;
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
  for (const pre of t.content.querySelectorAll("pre")) codeLines(pre);
  cellPictures(t.content, document);
  return t.innerHTML;
}

/** A note's HTML as markdown, as Obsidian writes it: footnotes, embeds and table alignment kept (see obsidianMarkdown). */
export function htmlMarkdown(h: string): string {
  const t = document.createElement("template");
  t.innerHTML = h;
  // (a code block holding a code fence: its backticks are out of the writer's sight, and its own fence made longer after, see obsidianMarkdown)
  // (and its lines, which the writer reads from newlines, are `<br>` in the editor)
  for (const c of t.content.querySelectorAll("pre")) {
    c.innerHTML = c.innerHTML.replace(/<br\s*\/?>/g, "\n");
    if (/(?:^|>|\n)`{3,}/.test(c.innerHTML)) c.innerHTML = c.innerHTML.replace(/`/g, FENCE_TICK);
  }
  h = t.innerHTML;
  const aligns = [...t.content.querySelectorAll("table")].map((tb) => [...(tb.querySelector("tr")?.children ?? [])].map((c) => ((c as HTMLElement).style.textAlign || null) as "left" | "center" | "right" | null));
  return obsidianMarkdown(helper.markdown.jsonToMarkdown(helper.converter.htmlToJson(h)), aligns);
}
