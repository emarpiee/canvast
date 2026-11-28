// A pasted page (HTML from a browser, a word processor, another notes app) as Markdown. Needs a DOM (`DOMParser`). What Markdown cannot hold
// (colours, fonts, sizes) is left out; the words, structure, links, pictures, tables and code stay.

const BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "FIGURE", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "HR", "DL", "DT", "DD", "ADDRESS", "DETAILS", "SUMMARY"]);
const DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "BUTTON", "SELECT", "TEXTAREA"]);

/** Characters that would start Markdown where they stand in words: escaped. */
const escapeText = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/([*_`[\]~]|==)/g, "\\$1")
    .replace(/^(\s*)([#>+-]|\d+[.)])(?=\s)/gm, "$1\\$2");

/** A pasted page's HTML as Markdown. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = blockChildren(doc.body, "").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/** Whether a node is shown as bold or italic by its style alone (word processors write `<span style="font-weight:700">`). */
const styled = (el: HTMLElement, prop: "bold" | "italic" | "strike"): boolean => {
  const s = el.getAttribute("style") ?? "";
  if (prop === "bold") return /font-weight\s*:\s*(bold|[6-9]00)/i.test(s);
  if (prop === "italic") return /font-style\s*:\s*italic/i.test(s);
  return /text-decoration[^;]*line-through/i.test(s);
};

/** The inline content of a node, as Markdown on one logical line (line breaks as `\` + newline). */
function inline(node: Node, inCode = false): string {
  let out = "";
  for (const c of node.childNodes) {
    if (c.nodeType === 3) {
      const t = (c as Text).data;
      out += inCode ? t : escapeText(t.replace(/[ \t\r\n]+/g, " "));
      continue;
    }
    if (c.nodeType !== 1) continue;
    const el = c as HTMLElement;
    const tag = el.tagName;
    if (DROP.has(tag)) continue;
    if (BLOCKS.has(tag)) {
      // (a block inside words, as a div in a span: its words on a line of their own)
      const inner = blockChildren(el, "").trim();
      if (inner) out += (out && !out.endsWith("\n") ? "\\\n" : "") + inner.replace(/\n+/g, "\\\n");
      continue;
    }
    out += inlineEl(el, inCode);
  }
  return out;
}

function wrap(mark: string, inner: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function inlineEl(el: HTMLElement, inCode: boolean): string {
  const tag = el.tagName;
  if (inCode) return tag === "BR" ? "\n" : inline(el, true);
  switch (tag) {
    case "BR":
      return "\\\n";
    case "STRONG": case "B":
      return wrap("**", inline(el));
    case "EM": case "I": case "CITE": case "VAR":
      return wrap("*", inline(el));
    case "DEL": case "S": case "STRIKE":
      return wrap("~~", inline(el));
    case "MARK":
      return wrap("==", inline(el));
    case "CODE": case "KBD": case "SAMP": case "TT": {
      const t = el.textContent ?? "";
      const ticks = "`".repeat(Math.max(1, ...[...t.matchAll(/`+/g)].map((m) => m[0].length + 1)));
      return t ? `${ticks}${/^`|`$/.test(t) ? ` ${t} ` : t}${ticks}` : "";
    }
    case "A": {
      const href = el.getAttribute("href") ?? "";
      const words = inline(el);
      if (!href || href.startsWith("#") || /^javascript:/i.test(href)) return words;
      if (!words.trim()) return "";
      const title = el.getAttribute("title");
      return `[${words}](${linkDest(href)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
    }
    case "IMG": {
      const src = el.getAttribute("src") ?? "";
      if (!src) return "";
      // (a notes app's page shows its own files from an address of its own: the file's name is what finds it again)
      if (/^(app|capacitor|file):/i.test(src)) return `![[${fileName(src)}]]`;
      const alt = (el.getAttribute("alt") ?? "").replace(/[[\]]/g, "");
      return `![${alt}](${linkDest(src)})`;
    }
    case "INPUT":
      return (el as HTMLInputElement).type === "checkbox" ? "" : "";
    case "SUP": case "SUB": case "U": case "INS": case "SMALL": case "BIG": case "ABBR": case "Q": case "TIME": case "LABEL": case "SPAN": case "FONT": default: {
      // (a notes app's embed, drawn as a box that names its file)
      if (el.classList.contains("internal-embed") && el.getAttribute("src")) return `![[${el.getAttribute("src")}]]`;
      let s = inline(el);
      if (styled(el, "strike")) s = wrap("~~", s);
      if (styled(el, "italic")) s = wrap("*", s);
      if (styled(el, "bold")) s = wrap("**", s);
      return tag === "Q" ? `“${s}”` : s;
    }
  }
}

/** The file's name at the end of an address, decoded, without its query. */
const fileName = (u: string): string => {
  const last = u.split(/[?#]/)[0]!.split("/").pop() ?? u;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

/** An address as a Markdown link writes it: in `<>` when it has spaces or unbalanced brackets. */
const linkDest = (u: string): string => (/[\s()<>]/.test(u) ? `<${u.replace(/[<>]/g, encodeURIComponent)}>` : u);

/** A node's children as Markdown blocks, each line led by `prefix` (a quote's `> `, a list item's indent). */
function blockChildren(node: Node, prefix: string): string {
  const parts: string[] = [];
  let words = "";
  const flush = (): void => {
    const t = words.replace(/^[ \t]+|[ \t]+$/gm, "").trim();
    if (t) parts.push(t);
    words = "";
  };
  for (const c of node.childNodes) {
    if (c.nodeType === 3) {
      words += escapeText((c as Text).data.replace(/[ \t\r\n]+/g, " "));
      continue;
    }
    if (c.nodeType !== 1) continue;
    const el = c as HTMLElement;
    if (DROP.has(el.tagName)) continue;
    if (!BLOCKS.has(el.tagName)) {
      words += inlineEl(el, false);
      continue;
    }
    flush();
    const b = blockEl(el);
    if (b.trim()) parts.push(b);
  }
  flush();
  const text = parts.join("\n\n");
  return prefix ? text.split("\n").map((l) => (l ? prefix + l : prefix.trimEnd())).join("\n") : text;
}

function blockEl(el: HTMLElement): string {
  const tag = el.tagName;
  switch (tag) {
    case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
      return `${"#".repeat(Number(tag[1]))} ${inline(el).replace(/\\\n/g, " ").trim()}`;
    case "P": case "DT": case "SUMMARY": case "FIGCAPTION": case "ADDRESS":
      return inline(el).trim();
    case "DD":
      return `: ${inline(el).trim()}`;
    case "HR":
      return "---";
    case "BLOCKQUOTE":
      return blockChildren(el, "> ");
    case "PRE": {
      // (a notes app's page draws a note's properties as a block of YAML: they are its front matter again)
      if (/\bfrontmatter\b/.test(el.className)) return `---\n${(el.textContent ?? "").replace(/\n$/, "")}\n---`;
      const code = el.querySelector("code") ?? el;
      const lang = /(?:language|lang)-([\w+#-]+)/.exec(`${code.className} ${el.className}`)?.[1] ?? "";
      const text = inline(code, true).replace(/\n$/, "");
      const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/^`{3,}/gm)].map((m) => m[0].length + 1)));
      return `${fence}${lang}\n${text}\n${fence}`;
    }
    case "UL": case "OL":
      return list(el);
    case "LI":
      return list(el.ownerDocument.createElement("ul").appendChild(el.cloneNode(true)).parentElement!);
    case "TABLE":
      return table(el as HTMLTableElement);
    default:
      return blockChildren(el, "");
  }
}

function list(el: HTMLElement): string {
  const ordered = el.tagName === "OL";
  let n = Number(el.getAttribute("start") ?? 1) || 1;
  const items: string[] = [];
  for (const li of el.children) {
    if (li.tagName !== "LI") continue;
    const box = li.querySelector<HTMLInputElement>(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
    const mark = ordered ? `${n++}.` : "-";
    const task = box ? `[${box.checked || box.hasAttribute("checked") ? "x" : " "}] ` : "";
    const pad = " ".repeat(mark.length + 1);
    const body = blockChildren(li, "").trim();
    const lines = body.split("\n");
    items.push(`${mark} ${task}${lines[0] ?? ""}${lines.slice(1).map((l) => `\n${l ? pad + l : ""}`).join("")}`);
  }
  return items.join("\n");
}

function table(t: HTMLTableElement): string {
  const rows = [...t.rows].map((r) => [...r.cells].map((c) => inline(c).replace(/\\\n/g, " ").replace(/\|/g, "\\|").trim()));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]): string[] => [...r, ...Array<string>(width - r.length).fill("")];
  const aligns = [...(t.rows[0]?.cells ?? [])].map((c) => (c.style.textAlign || c.getAttribute("align") || "").toLowerCase());
  const sep = pad([]).map((_, i) => (aligns[i] === "center" ? ":---:" : aligns[i] === "right" ? "---:" : aligns[i] === "left" ? ":---" : "---"));
  const line = (r: string[]): string => `| ${pad(r).join(" | ")} |`;
  return [line(rows[0]!), `| ${sep.join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

/** A line that starts a Markdown block: a list item, a heading, a quote, a fence or a table row. */
const MD_BLOCK = /^[ \t]{0,3}(?:[-*+][ \t]+\S|\d{1,9}[.)][ \t]+\S|#{1,6}[ \t]+\S|>[ \t]?\S|```|~~~|\|.*\|[ \t]*$)/m;
/** Inline Markdown: bold, code, a link with its address, a wiki link. */
const MD_INLINE = /\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\[\[[^\]\n]+\]\]/;
/** Elements of a page that give it structure: HTML with none of them is words, and its plain text is what to paste. */
const STRUCTURE = /<(h[1-6]|ul|ol|li|table|blockquote|pre|strong|b|em|i|a|img|del|s|hr|mark|code)[\s>]/i;

/**
 * What to paste, as Markdown, from a clipboard's plain text and HTML: the plain text when it is Markdown already (a notes app's source, a
 * chat) or the HTML has no structure, else the HTML read as Markdown.
 */
export function pastedMarkdown(text: string, html: string): string {
  if (!html || !STRUCTURE.test(html) || MD_BLOCK.test(text) || MD_INLINE.test(text)) return escapeTablePipes(text);
  return escapeTablePipes(htmlToMarkdown(html) || text);
}

/**
 * A table row's `[[link|words]]` and `![[picture|200]]` with their bar written \\| (as notes apps write them in a table): unescaped, the
 * bar ends the cell and the row gets a column too many. Lines that are no table row are left as they are.
 */
export function escapeTablePipes(md: string): string {
  return md.replace(/^[ \t]*\|.*\|[ \t]*$/gm, (row) => row.replace(/\[\[[^\]\n]*\]\]/g, (link) => link.replace(/(?<!\\)\|/g, "\\|")));
}
