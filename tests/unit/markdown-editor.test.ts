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
