import { describe, expect, it } from "vitest";
import { linkTarget, noteKindOf, relativeLink, richNameOf, richNoteBody, richNoteFile } from "../../src/notes/note-file";

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
    expect(linkTarget("../Pictures/my%20cat.png", ["Notes"])).toEqual({ path: ["Pictures", "my cat.png"] });
    expect(linkTarget("./x/y.png?raw#top", [])).toEqual({ path: ["x", "y.png"] });
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
});
