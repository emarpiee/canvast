/**
 * Colours in a note's code blocks. Prism only reads the words into tokens; the colours are painted over them by the browser's CSS highlights, so nothing in
 * the note changes: not its elements, not the cursor, not undo, not what is saved. Loaded when a note first has a code block in a language.
 */

/** Every language the editor's code block offers, by the name its grammar goes by. */
const GRAMMARS: Readonly<Record<string, string>> = {
  javascript: "javascript", typescript: "typescript", html: "markup", css: "css", json: "json", python: "python", java: "java", c: "c", cpp: "cpp", csharp: "csharp", go: "go", rust: "rust",
  ruby: "ruby", php: "php", swift: "swift", kotlin: "kotlin", sql: "sql", bash: "bash", markdown: "markdown", xml: "markup", yaml: "yaml",
  js: "javascript", ts: "typescript", py: "python", sh: "bash", shell: "bash", yml: "yaml", md: "markdown", cs: "csharp", "c++": "cpp",
};
export const CODE_LANGUAGES: readonly string[] = Object.keys(GRAMMARS);

type Stream = string | Token | Stream[];
interface Token { type: string; alias?: string | string[]; content: Stream }
interface PrismApi { languages: Record<string, unknown>; tokenize(text: string, grammar: unknown): Stream[] }

let prism: Promise<PrismApi> | null = null;
function loadPrism(): Promise<PrismApi> {
  return (prism ??= (async () => {
    const g = globalThis as unknown as { Prism?: unknown };
    g.Prism = { manual: true, disableWorkerMessageHandler: true }; // (it must not go through the page by itself)
    g.Prism = (await import("prismjs/components/prism-core.js")).default;
    // (each grammar finds the others in the global, in this order)
    await import("prismjs/components/prism-markup.js");
    await import("prismjs/components/prism-clike.js");
    await import("prismjs/components/prism-javascript.js");
    await import("prismjs/components/prism-typescript.js");
    await import("prismjs/components/prism-css.js");
    await import("prismjs/components/prism-json.js");
    await import("prismjs/components/prism-python.js");
    await import("prismjs/components/prism-java.js");
    await import("prismjs/components/prism-c.js");
    await import("prismjs/components/prism-cpp.js");
    await import("prismjs/components/prism-csharp.js");
    await import("prismjs/components/prism-go.js");
    await import("prismjs/components/prism-rust.js");
    await import("prismjs/components/prism-ruby.js");
    await import("prismjs/components/prism-markup-templating.js");
    await import("prismjs/components/prism-php.js");
    await import("prismjs/components/prism-swift.js");
    await import("prismjs/components/prism-kotlin.js");
    await import("prismjs/components/prism-sql.js");
    await import("prismjs/components/prism-bash.js");
    await import("prismjs/components/prism-markdown.js");
    await import("prismjs/components/prism-yaml.js");
    return g.Prism as PrismApi;
  })());
}

/** The few colours, and the many kinds of token each is for. */
const GROUPS: Readonly<Record<string, string>> = {
  keyword: "keyword", boolean: "keyword", important: "keyword", atrule: "keyword", rule: "keyword", directive: "keyword", "macro": "keyword",
  string: "string", "attr-value": "string", char: "string", regex: "string", url: "string", "template-string": "string", "string-interpolation": "string",
  comment: "comment", prolog: "comment", doctype: "comment", cdata: "comment",
  number: "number", constant: "number", symbol: "number", null: "number", unit: "number",
  function: "function", builtin: "function", "class-name": "function", selector: "function", title: "function",
  tag: "tag", "attr-name": "tag", property: "tag", key: "tag", namespace: "tag", variable: "tag",
};
export const CODE_COLOUR_GROUPS: readonly string[] = [...new Set(Object.values(GROUPS))];

export interface CodeSpan { readonly group: string; readonly start: number; readonly end: number }

/** The coloured stretches of some code; none in a language it has no grammar for. */
export async function codeSpans(text: string, language: string): Promise<CodeSpan[]> {
  const name = GRAMMARS[language.toLowerCase()];
  if (!name) return [];
  const P = await loadPrism();
  const grammar = P.languages[name];
  if (!grammar) return [];
  const out: CodeSpan[] = [];
  let at = 0;
  const walk = (s: Stream, inherited: string | undefined): void => {
    if (typeof s === "string") {
      if (inherited && s.length) out.push({ group: inherited, start: at, end: at + s.length });
      at += s.length;
    } else if (Array.isArray(s)) for (const x of s) walk(x, inherited);
    else {
      const aliases = Array.isArray(s.alias) ? s.alias : s.alias ? [s.alias] : [];
      const own = [s.type, ...aliases].map((t) => GROUPS[t]).find(Boolean);
      walk(s.content, own ?? inherited);
    }
  };
  walk(P.tokenize(text, grammar), undefined);
  return out;
}

/** A block longer than this stays plain: colouring it would be felt at every key. */
const MAX_CODE = 200_000;
const known = new WeakMap<Element, { text: string; language: string; spans: CodeSpan[] }>();
const painted = new Map<object, Map<string, Range[]>>();

type HighlightCtor = new (...ranges: Range[]) => unknown;
const registry = (): Map<string, unknown> | null => (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights ?? null;

function publish(): void {
  const all = registry();
  if (!all) return;
  const Ctor = (globalThis as unknown as { Highlight: HighlightCtor }).Highlight;
  for (const group of CODE_COLOUR_GROUPS) {
    const ranges = [...painted.values()].flatMap((byGroup) => byGroup.get(group) ?? []);
    if (ranges.length) all.set(`canvast-code-${group}`, new Ctor(...ranges));
    else all.delete(`canvast-code-${group}`);
  }
}

/** A block's words, with where each text node begins (a line break in it is an element). */
function readBlock(pre: Element): { text: string; nodes: { node: Text; start: number }[] } {
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeType === Node.TEXT_NODE) {
      nodes.push({ node: n as Text, start: text.length });
      text += (n as Text).data;
    } else if (n.nodeName === "BR") text += "\n";
  }
  return { text, nodes };
}

/** Colour the code blocks of this page, as they are now. `owner`: whose colours these are, as several notes can be open. */
export async function paintCode(owner: object, page: Element): Promise<void> {
  if (!registry()) return;
  const byGroup = new Map<string, Range[]>();
  for (const pre of page.querySelectorAll("pre")) {
    const language = /language-([\w+#-]+)/.exec(`${pre.className} ${pre.querySelector("code")?.className ?? ""}`)?.[1];
    if (!language) continue;
    const { text, nodes } = readBlock(pre);
    if (text.length > MAX_CODE) continue;
    let was = known.get(pre);
    if (was?.text !== text || was.language !== language) known.set(pre, (was = { text, language, spans: await codeSpans(text, language) }));
    let n = 0;
    const place = (offset: number): [Text, number] | null => {
      while (n + 1 < nodes.length && nodes[n + 1]!.start <= offset) n++;
      const at = nodes[n];
      return at ? [at.node, Math.min(offset - at.start, at.node.length)] : null;
    };
    for (const { group, start, end } of was.spans) {
      const [from, to] = [place(start), place(end)];
      if (!from || !to) continue;
      const range = document.createRange();
      range.setStart(from[0], from[1]);
      range.setEnd(to[0], to[1]);
      const list = byGroup.get(group);
      if (list) list.push(range);
      else byGroup.set(group, [range]);
    }
  }
  painted.set(owner, byGroup);
  publish();
}

export function dropCode(owner: object): void {
  if (painted.delete(owner)) publish();
}
