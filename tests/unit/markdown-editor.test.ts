import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { renderMarkdown } from "../../src/markdown-editor/render";
import { wrapTyped } from "../../src/markdown-editor/behaviors/wrap-selection";

describe("the Markdown editor's renderer", () => {
  it("draws CommonMark, GitHub's extras and notes apps' links, without the front matter", () => {
    const html = renderMarkdown(
      "---\ntitle: x\n---\n# Head *em*\n\nOne\ntwo [[Plan|shown]] ![[cat.png|200]] #tag ==hi== ~~del~~ `c`\n\n> q\n> r\n\n- [x] done\n\n| a | b |\n|:--|--:|\n| 1 | **2** |\n\n```js\nlet x;\n```\n\n[r][1]\n\n[1]: http://r.example\n",
      { taskOffsets: true },
    );
    expect(html).toContain("<h1>Head <em>em</em></h1>");
    expect(html).toContain('One<br>two <a href="#Plan" data-wiki="Plan">shown</a> <img src="cat.png" alt="cat.png" data-embed="cat.png" width="200">');
    expect(html).toContain('<span class="tag" data-tag="tag">#tag</span> <mark>hi</mark> <del>del</del> <code>c</code>');
    expect(html).toContain("<blockquote><p>q<br>r</p></blockquote>");
    expect(html).toMatch(/<li class="task done"><input type="checkbox" checked data-task="\d+"> done<\/li>/);
    expect(html).toContain('<th style="text-align:left">a</th><th style="text-align:right">b</th>');
    expect(html).toContain('<pre class="language-js"><code class="language-js">let x;</code></pre>');
    expect(html).toContain('<a href="http://r.example">r</a>');
    expect(html).not.toContain("title: x");
  });

  it("escapes raw HTML and script addresses unless asked", () => {
    expect(renderMarkdown("<b>x</b> [a](javascript:alert(1))")).toBe('<p>&lt;b&gt;x&lt;/b&gt; <a href="#">a</a></p>');
    expect(renderMarkdown("<b>x</b>", { html: true })).toBe("<p><b>x</b></p>");
    expect(renderMarkdown("#1 and a#b are no tags")).not.toContain('class="tag"');
  });
});

describe("a sign typed over selected words", () => {
  it("goes round them as Markdown marks or a pair, and they stay selected", () => {
    const state = EditorState.create({ doc: "one two", selection: EditorSelection.range(4, 7) });
    const tr = wrapTyped(state, "*")!;
    expect(tr.state.doc.toString()).toBe("one *two*");
    expect(tr.state.sliceDoc(tr.state.selection.main.from, tr.state.selection.main.to)).toBe("two");
    expect(wrapTyped(tr.state, "(")!.state.doc.toString()).toBe("one *(two)*");
    expect(wrapTyped(EditorState.create({ doc: "x" }), "*"), "nothing selected: typed as usual").toBeNull();
  });
});

describe("a table row's cells", () => {
  it("are found where their words are, spaces and escaped pipes kept out, an empty cell a place between its spaces", async () => {
    const { cellSpans } = await import("../../src/markdown-editor/table");
    const at = (line: string) => cellSpans(line).map(([a, b]) => line.slice(a, b));
    expect(at("| Ink | a \\| b |")).toEqual(["Ink", "a \\| b"]);
    expect(at("| `x|y` |  |")).toEqual(["`x|y`", ""]);
    expect(cellSpans("|  |")).toEqual([[2, 2]]);
    expect(cellSpans("||")).toEqual([[1, 1]]);
    expect(at("> | q | r |")).toEqual(["q", "r"]);
    expect(at("a | b")).toEqual(["a", "b"]);
  });
});

describe("Turn into, with lines selected", () => {
  const run = async (doc: string, name: string, from = 0, to = doc.length): Promise<string> => {
    const { COMMANDS } = await import("../../src/markdown-editor/commands");
    let state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
    const view = { get state() { return state; }, dispatch: (tr: { state: EditorState }) => void (state = tr.state) };
    (COMMANDS as Record<string, (v: unknown) => boolean>)[name]!(view);
    return state.doc.toString();
  };
  it("keeps the words in every block (code, callout, math), and the block holds the whole lines", async () => {
    expect(await run("let a = 1;\nlet b = 2;", "codeBlock", 2, 14)).toBe("```\nlet a = 1;\nlet b = 2;\n```");
    expect(await run("Mind\nthe step", "callout")).toBe("> [!note]\n> Mind\n> the step");
    expect(await run("x^2", "mathBlock")).toBe("$$\nx^2\n$$");
    for (const name of ["paragraph", "heading1", "heading2", "heading3", "bulletList", "orderedList", "taskList", "quote"]) expect(await run("Ink\nPaper", name)).toMatch(/Ink[^]*Paper/);
  });
  it("makes a table of one row per line (cells apart by tabs), a list's marks and pipes taken care of", async () => {
    expect(await run("- Ink\n- Paper | cheap", "table")).toBe("| Column 1 |\n| --- |\n| Ink |\n| Paper \\| cheap |");
    expect(await run("a\t1\nb\t2", "table")).toBe("| Column 1 | Column 2 |\n| --- | --- |\n| a | 1 |\n| b | 2 |");
  });
});

describe("a table cell's lines", () => {
  it("draw a list, a task list or a callout as blocks; words alone stay words", async () => {
    const { cellHtml } = await import("../../src/markdown-editor/render");
    expect(cellHtml("- ink<br>- paper")).toBe("<ul><li>ink</li><li>paper</li></ul>");
    expect(cellHtml("> [!tip] Hint<br>> dry first")).toContain('<div class="callout" data-callout="tip"><div class="callout-title">Hint</div>');
    expect(cellHtml("one<br>two")).toBeNull();
    expect(renderMarkdown("| a |\n| --- |\n| - x<br>- y |\n")).toContain("<td><ul><li>x</li><li>y</li></ul></td>");
  });
});

describe("a table cell's text as its editor edits it", () => {
  it("leaves one space of padding out each side, keeps spaces typed at its ends, and an empty cell is a place", async () => {
    const { cellRegions } = await import("../../src/markdown-editor/table");
    const at = (line: string) => cellRegions(line).map(([a, b]) => line.slice(a, b));
    expect(at("| Ink  | a<br>b |")).toEqual(["Ink ", "a<br>b"]);
    expect(at("|  | x |")).toEqual(["", "x"]);
    expect(cellRegions("||")).toEqual([[1, 1]]);
  });
});

describe("a format key over links and lines", () => {
  const run = async (doc: string, from: number, to = from, m = "**"): Promise<string> => {
    const { toggleInline } = await import("../../src/markdown-editor/behaviors/format-toggle");
    const { markdown, markdownLanguage } = await import("@codemirror/lang-markdown");
    const { ensureSyntaxTree } = await import("@codemirror/language");
    const { EXTENSIONS } = await import("../../src/markdown-editor/syntax");
    let state = EditorState.create({ doc, selection: EditorSelection.range(from, to), extensions: markdown({ base: markdownLanguage, extensions: EXTENSIONS }) });
    ensureSyntaxTree(state, doc.length, 5000);
    const view = { get state() { return state; }, dispatch: (tr: { state: EditorState }) => void (state = tr.state) };
    toggleInline(m)(view as never);
    return state.doc.toString();
  };
  it("never cuts into a link: a selection ending in one takes it whole; the cursor in one formats the whole link", async () => {
    expect(await run("see [[foreshortening]] now", 0, 10)).toBe("**see [[foreshortening]]** now");
    expect(await run("[[a-b]] x", 3)).toBe("**[[a-b]]** x");
    expect(await run("**[[a-b]]** x", 5)).toBe("[[a-b]] x");
    expect(await run("go [site](https://x.example) on", 12)).toBe("go **[site](https://x.example)** on");
  });
  it("marks each selected line apart (lists' marks kept outside), and off again when all have them", async () => {
    expect(await run("[[a]]\n[[b]]", 0, 11)).toBe("**[[a]]**\n**[[b]]**");
    expect(await run("- one\n- two", 0, 11)).toBe("- **one**\n- **two**");
    expect(await run("**one**\n**two**", 0, 15)).toBe("one\ntwo");
  });
  it("plain words: a word with the cursor in it, a selection, an empty pair", async () => {
    expect(await run("good day", 2)).toBe("**good** day");
    expect(await run("good day", 0, 4)).toBe("**good** day");
    expect(await run("a  b", 2)).toBe("a ****  b".replace("**** ", "****"));
  });
});

describe("Clear formatting", () => {
  it("takes inline marks off and keeps the words and links", async () => {
    const { stripMarks } = await import("../../src/markdown-editor/behaviors/clear-format");
    expect(stripMarks('**bold** *it* ~~s~~ ==hl== <mark class="hl-red">red</mark> `c` [[Link]] [a](b) snake_case')).toBe("bold it s hl red c [[Link]] [a](b) snake_case");
  });
});

describe("a picture's link besides its file", () => {
  it("reads and writes its size, alt text, turn and flips (another notes app reads the size and shows the rest as its alt text)", async () => {
    const { readAlt, withAlt, lookTransform } = await import("../../src/markdown-editor/picture-alt");
    expect(readAlt("rotate-90 flip-x|200")).toEqual({ alt: "", width: 200, height: null, rotate: 90, flipX: true, flipY: false });
    expect(readAlt("A cat|300x200")).toMatchObject({ alt: "A cat", width: 300, height: 200 });
    expect(withAlt("![[cat.png|200]]", (a) => ({ ...a, rotate: 270 }))).toBe("![[cat.png|rotate-270|200]]");
    expect(withAlt("![cat|200](cat.png)", (a) => ({ ...a, flipY: true, width: 120 }))).toBe("![cat flip-y|120](cat.png)");
    expect(withAlt("![[cat.png|rotate-90]]", (a) => ({ ...a, rotate: 0 }))).toBe("![[cat.png]]");
    expect(lookTransform(readAlt("rotate-180 flip-x"))).toBe("rotate(180deg) scaleX(-1)");
  });
});

describe("note styles", () => {
  it("heading sizes come down from H1's in even steps to the text's size, or are all H1's; H1 is always larger than the text", async () => {
    const { headingSizes, noteStyleVars } = await import("../../src/notes/note-styles");
    const s = headingSizes(2, "steps");
    expect(s[0]).toBeCloseTo(2);
    expect(s[5]).toBeCloseTo(1);
    for (let i = 1; i < 6; i++) expect(s[i]!).toBeLessThan(s[i - 1]!);
    expect(headingSizes(1.5, "same")).toEqual([1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
    expect(headingSizes(0.8, "steps")[0]).toBeGreaterThan(1);
    const vars = noteStyleVars((k) => ({ "notes.style.headingColours": "rainbow", "notes.style.boldColour": "#112233", "notes.style.italicColour": "" } as Record<string, unknown>)[k] ?? (k === "notes.style.h1Size" ? 1.9 : k === "notes.style.boldWeight" ? 700 : ""));
    expect(vars).toContain("--me-h1-fg: #e5484d;");
    expect(vars).toContain("--me-strong-fg: #112233;");
    expect(vars).not.toContain("--me-em-fg");
  });
});
