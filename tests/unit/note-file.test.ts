import { describe, expect, it } from "vitest";
import { libraryLink, linkTarget, noteKindOf, noteLinks as linksIn, relativeLink, relinkNote as relink } from "../../src/notes/note-file";

describe("note files", () => {
  it("knows the notes by name", () => {
    // (an older version's rich text note, `.note.html`, is a page now: a file, not a note)
    expect(["a.md", "A.MARKDOWN", "b.txt", "c.note.html", "d.html", "e.mdx"].map(noteKindOf)).toEqual(["md", "md", "txt", null, null, null]);
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
});

import { wikiTarget } from "../../src/notes/note-file";

describe("[[links]] between notes", () => {
  it("name an item by its name and folders", () => {
    expect(wikiTarget("Projects/Plan.md#Goals")).toEqual({ name: "plan", dirs: ["projects"] });
  });
});

import { noteLinks, relinkNote } from "../../src/notes/note-file";

describe("a note's links to other items", () => {
  const md = "See [[Plan]], [[Projects/Plan|the plan]], ![[cat.png]] and [[Plan#Goals]].\n![c](../Pictures/cat.png) [b](Brief.md) `[[Plan]]`\n<img src=\"../Pictures/cat.png\">\n";
  it("are found, wherever they are written", () => {
    expect(noteLinks("md", md)).toEqual({ wiki: ["Plan", "Projects/Plan", "cat.png", "Plan"], paths: ["../Pictures/cat.png", "Brief.md", "../Pictures/cat.png"] });
  });
  it("are written again when the item is renamed or moved, nothing else", () => {
    expect(relinkNote("md", md, { oldWiki: "plan", newWiki: "Roadmap", oldPath: "", newPath: "" })).toBe(
      "See [[Roadmap]], [[Roadmap|the plan]], ![[cat.png]] and [[Roadmap#Goals]].\n![c](../Pictures/cat.png) [b](Brief.md) `[[Plan]]`\n<img src=\"../Pictures/cat.png\">\n",
    );
    const moved = relinkNote("md", md, { oldWiki: null, newWiki: "", oldPath: "../Pictures/cat.png", newPath: "../Art/cat.png" });
    expect(noteLinks("md", moved).paths).toEqual(["../Art/cat.png", "Brief.md", "../Art/cat.png"]);
  });

  it("are found, and followed when the item moves, however the address was written", () => {
    // Found, and followed when the item moves, however the address was written.
    expect(linksIn("md", "![a](x%20(2).png) ![b](<my cat.png>)").paths).toEqual(["x%20%282%29.png", "my%20cat.png"]);
    expect(relink("md", "![a](x%20(2).png) ![b](<my cat.png>)", { oldWiki: null, newWiki: "", oldPath: "x%20%282%29.png", newPath: "n.png" })).toBe("![a](n.png) ![b](<my cat.png>)");
    expect(relink("md", "![b](<my cat.png>)", { oldWiki: null, newWiki: "", oldPath: "my%20cat.png", newPath: "n.png" })).toBe("![b](<n.png>)");
  });
});
