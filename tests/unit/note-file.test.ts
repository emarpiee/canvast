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
