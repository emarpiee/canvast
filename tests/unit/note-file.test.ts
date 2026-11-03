import { describe, expect, it } from "vitest";
import { libraryLink, linkTarget, noteKindOf, noteLinks as linksIn, obsidianMarkdown, readableMarkdown, relativeLink, relinkNote as relink, richNameOf, richNoteBody, richNoteFile } from "../../src/notes/note-file";

describe("note files", () => {
  it("knows the notes by name", () => {
    expect(["a.md", "A.MARKDOWN", "b.txt", "c.note.html", "d.html", "e.mdx"].map(noteKindOf)).toEqual(["md", "md", "txt", "rich", null, null]);
    expect(richNameOf("plan.md")).toBe("plan.note.html");
  });

  it("writes and reads links relative to the note, and the app's own links", () => {
    expect(relativeLink(["Notes"], ["Pictures", "my cat.png"])).toBe("../Pictures/my%20cat.png");
    expect(relativeLink(["Notes", "2026"], ["Notes", "pic.png"])).toBe("../pic.png");
    expect(relativeLink([], ["pic.png"])).toBe("pic.png");
    expect(relativeLink(["a"], ["a", "a"])).toBe("a"); // (a file named like the folder it is in)
    expect(linkTarget("../Pictures/my%20cat.png", ["Notes"])).toEqual({ path: ["Pictures", "my cat.png"], root: null });
    expect(linkTarget("./x/y.png?raw#top", [])).toEqual({ path: ["x", "y.png"], root: ["x", "y.png"] });
    // Read from the note's folder and from the root of the library (or of a vault one folder up), and written from the root, brackets encoded.
    expect(linkTarget("images/cat.png", ["notes"])).toEqual({ path: ["notes", "images", "cat.png"], root: ["images", "cat.png"] });
    expect(linkTarget("library/images/cat.png", ["notes"])).toEqual({ path: ["notes", "library", "images", "cat.png"], root: ["images", "cat.png"] });
    expect(libraryLink(["my pics", "photo (1).png"])).toBe("my%20pics/photo%20%281%29.png");
    expect(linkTarget(`canvast:${"A".repeat(64)}`, [])).toEqual({ hash: "a".repeat(64) });
    for (const other of ["https://example.com/p.png", "#part", "/home/p.png", "../../out.png", "canvast:short", "%E0%A4%A"]) expect(linkTarget(other, ["Notes"])).toBeNull();
  });

  it("keeps a rich note's body through its file", () => {
    const body = '<p style="text-align:center">A <span style="color:red">&lt;b&gt;</span></p>';
    expect(richNoteBody(richNoteFile('Plan "1" <x>', body))).toBe(body);
    expect(richNoteFile('Plan "1" <x>', body)).toContain("<title>Plan &#34;1&#34; &#60;x&#62;</title>");
    expect(richNoteBody("<p>no page</p>")).toBe("<p>no page</p>");
  });
});

import { linksToWiki, wikiTarget, wikiToLinks } from "../../src/notes/note-file";

describe("[[links]] between notes", () => {
  it("become editor links and come back as written, never in code or embeds", () => {
    const md = "See [[Plan]] and [[Projects/Brief|the brief]], ![[cat.png]], `[[not a link]]`.\n\n```\n[[code]]\n```\n";
    const shown = wikiToLinks(md);
    expect(shown).toBe("See [Plan](canvast-wiki:Plan) and [the brief](canvast-wiki:Projects%2FBrief), ![[cat.png]], `[[not a link]]`.\n\n```\n[[code]]\n```\n");
    expect(linksToWiki(shown)).toBe(md);
    expect(linksToWiki("[Brief](canvast-wiki:Projects%2FBrief)")).toBe("[[Projects/Brief]]");
    expect(wikiTarget("Projects/Plan.md#Goals")).toEqual({ name: "plan", dirs: ["projects"] });
  });
});

import { noteLinks, relinkNote } from "../../src/notes/note-file";

describe("a note's links to other items", () => {
  const md = "See [[Plan]], [[Projects/Plan|the plan]], ![[cat.png]] and [[Plan#Goals]].\n![c](../Pictures/cat.png) [b](Brief.md) `[[Plan]]`\n<img src=\"../Pictures/cat.png\">\n";
  it("are found, wherever they are written", () => {
    expect(noteLinks("md", md)).toEqual({ wiki: ["Plan", "Projects/Plan", "cat.png", "Plan"], paths: ["../Pictures/cat.png", "Brief.md", "../Pictures/cat.png"] });
    expect(noteLinks("rich", '<a href="Brief.md">b</a><img src="../a&amp;b.png">')).toEqual({ wiki: [], paths: ["Brief.md", "../a&b.png"] });
  });
  it("are written again when the item is renamed or moved, nothing else", () => {
    expect(relinkNote("md", md, { oldWiki: "plan", newWiki: "Roadmap", oldPath: "", newPath: "" })).toBe(
      "See [[Roadmap]], [[Roadmap|the plan]], ![[cat.png]] and [[Roadmap#Goals]].\n![c](../Pictures/cat.png) [b](Brief.md) `[[Plan]]`\n<img src=\"../Pictures/cat.png\">\n",
    );
    const moved = relinkNote("md", md, { oldWiki: null, newWiki: "", oldPath: "../Pictures/cat.png", newPath: "../Art/cat.png" });
    expect(noteLinks("md", moved).paths).toEqual(["../Art/cat.png", "Brief.md", "../Art/cat.png"]);
    expect(relinkNote("rich", '<a href="Brief.md">', { oldWiki: "brief", newWiki: "X", oldPath: "Brief.md", newPath: "Docs/Brief.md" })).toBe('<a href="Docs/Brief.md">');
  });

  it("makes what the editor's reader misreads plain, and leaves code alone", () => {
    expect(readableMarkdown("![a](x%20(2).png) ![b](<my cat.png>) [c](d.md \"t\")")).toBe('![a](x%20%282%29.png) ![b](my%20cat.png) [c](d.md "t")');
    expect(readableMarkdown("|:--|--:|".replace(/^/, "| a | b |\n"))).toBe("| a | b |\n|:---|---:|");
    expect(readableMarkdown("Title\n===\n\nPart\n---\n\n- a\n---\n")).toBe("# Title\n\n## Part\n\n- a\n---\n");
    expect(readableMarkdown("2 * 3 * 4 and ```a``` and `b * c`\n* list")).toBe("2 \\* 3 \\* 4 and `a` and `b * c`\n* list");
    expect(readableMarkdown("```\nT\n===\n![a](<x y>)\n```")).toBe("```\nT\n===\n![a](<x y>)\n```");
    expect(readableMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 | 3 | 4 |")).toBe("| a | b |  |  |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |");
    // A code block holding a fence, and a fence's words after its language.
    expect(readableMarkdown("````md\n```x\nT\n===\n```\n````")).toBe("````md\n```x\nT\n===\n```\n````");
    expect(readableMarkdown("```c++ x\ny\n```")).toBe("```c_x2bx__x2bx__x20x_x\ny\n```");
    expect(obsidianMarkdown("```c_x2bx__x2bx__x20x_x\ny\n```")).toBe("```c++ x\ny\n```");
    expect(obsidianMarkdown("```md\n\uE101\uE101\uE101x\ny\n\uE101\uE101\uE101\n```")).toBe("````md\n```x\ny\n```\n````");
    // [[links]] with brackets go there and back.
    expect(linksToWiki(wikiToLinks("[[Foo (bar)]] and [[Foo (bar)|shown]]"))).toBe("[[Foo (bar)]] and [[Foo (bar)|shown]]");
    // Found, and followed when the item moves, however the address was written.
    expect(linksIn("md", "![a](x%20(2).png) ![b](<my cat.png>)").paths).toEqual(["x%20%282%29.png", "my%20cat.png"]);
    expect(relink("md", "![a](x%20(2).png) ![b](<my cat.png>)", { oldWiki: null, newWiki: "", oldPath: "x%20%282%29.png", newPath: "n.png" })).toBe("![a](n.png) ![b](<my cat.png>)");
    expect(relink("md", "![b](<my cat.png>)", { oldWiki: null, newWiki: "", oldPath: "my%20cat.png", newPath: "n.png" })).toBe("![b](<n.png>)");
  });

  it("writes footnotes, embeds and table alignment as Obsidian does, and leaves code and links alone", () => {
    expect(obsidianMarkdown("one\\\ntwo\n\n> [!note] Title\\\n> body\n>\n\nnext")).toBe("one\ntwo\n\n> [!note] Title\n> body\n\nnext");
    expect(obsidianMarkdown("2 \\* 3 and [https://a.b/c](https://a.b/c) [x](https://a.b)")).toBe("2 * 3 and https://a.b/c [x](https://a.b)");
    expect(obsidianMarkdown("A [^1\\] and [^2\\].\n\n![[cat.png\\]\\]\n\n[\\^1\\]: [Gamut](https://x)")).toBe("A [^1] and [^2].\n\n![[cat.png]]\n\n[^1]: [Gamut](https://x)");
    expect(obsidianMarkdown("not a link: [a\\](b)")).toBe("not a link: [a\\](b)");
    expect(obsidianMarkdown("`x\\]` and\n```\ny\\]\n```\n")).toBe("`x\\]` and\n```\ny\\]\n```\n");
    expect(obsidianMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |", [["center", "right"]])).toBe("| a | b |\n| :---: | ---: |\n| 1 | 2 |");
    expect(obsidianMarkdown("| a |\n| --- |", [[null]])).toBe("| a |\n| --- |");
  });
});
