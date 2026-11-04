import { describe, expect, it } from "vitest";
import { cleanItemName, cleanName, cleanNoteName, cleanWholeName, fitsWritten, freeNameIn, isClashOf, nameWarnings, numberedName, replaceInvalid, sameOnDisk } from "../../src/doc/file-names";
import type { CatalogEntry } from "../../src/assets/asset-catalog";
import { propValues } from "../../src/assets/library-match";
import { dateWords } from "../../src/doc/date-words";
import { encodeLinkPart, wikiKeyOf, wikiTarget } from "../../src/notes/note-file";
import { isFolderOf, keptFile, keptFits } from "../../src/storage/workspace-names";

describe("the rules of file and folder names", () => {
  it("what a system refuses goes, in every style, on every system", () => {
    for (const style of ["kept", "clean"] as const) {
      for (const bad of ['a<b>c:d"e/f\\g|h?i*j', "a\u0000b", "a\u007fb", "  ..name..  "]) expect(cleanName(bad, style)).not.toMatch(/[<>:"/\\|?*\u0000-\u001f\u007f]|^[.\s]|[.\s]$/);
      expect(cleanName("CON", style).toLowerCase()).toBe("con_file");
      expect(cleanName("???", style === "clean" ? "clean" : "clean", "x")).toBe("x");
      expect(new TextEncoder().encode(cleanName("日".repeat(400), style)).length).toBeLessThanOrEqual(230);
    }
    expect(cleanName("My Note: Part (1)", "kept")).toBe("My Note- Part (1)");
    expect(cleanName("My Note: Part (1)", "clean")).toBe("my_note-part-1");
    expect(cleanName("a::b", "kept")).toBe("a-b");
  });
  it("what no one sees goes; what joins emoji and words in some scripts stays", () => {
    expect(replaceInvalid("gn‮p.exe​")).toBe("gnp.exe");
    expect(replaceInvalid("👨‍👩")).toBe("👨‍👩");
    expect(replaceInvalid("é")).toBe("é");
  });
  it("an item's name: no end dot, no device name; a note's holds nothing a link cannot", () => {
    expect(cleanItemName("name.")).toBe("name");
    expect(cleanItemName("con.png")).toBe("con_file.png");
    expect(cleanItemName("C# [draft].md")).toBe("C- -draft-.md");
    expect(cleanItemName("C# [draft].png")).toBe("C# [draft].png");
    expect(cleanItemName("plan.note.html")).toBe("plan.note.html");
    expect(cleanNoteName("C# notes ^1", "kept")).toBe("C- notes -1");
    expect(cleanNoteName("C# notes", "clean")).toBe("c_notes");
    expect(cleanWholeName("a/b.png", "x")).toBe("a-b.png");
    expect(cleanWholeName("???", "x")).toBe("---".replace(/-+/, "-"));
  });
  it("one way to number: a name taken becomes -2, without regard to case", () => {
    expect(numberedName("a", 1, ".png")).toBe("a.png");
    expect(numberedName("a", 3, ".png")).toBe("a-3.png");
    const taken = new Set<string>();
    expect(["a.png", "A.PNG", "a.png"].map((n) => freeNameIn(taken, n))).toEqual(["a.png", "A-2.PNG", "a-3.png"]);
    expect(freeNameIn(taken, "plan.note.html", "d/")).toBe("d/plan.note.html");
    expect(isClashOf("x-2", "x") && isClashOf("x-10", "x") && !isClashOf("x-1", "x") && !isClashOf("x-0", "x") && !isClashOf("xy-2", "x")).toBe(true);
    expect(isClashOf("Chapter-2024", "Chapter", 999)).toBe(false);
  });
  it("folders a disk takes for one are found", () => {
    expect(["Refs|refs", "A: B|a- b", "???|!!!"].every((p) => sameOnDisk(p.split("|")[0]!, p.split("|")[1]!))).toBe(true);
    expect(sameOnDisk("Refs", "Other")).toBe(false);
  });
  it("what can bite elsewhere is said, not changed", () => {
    expect(nameWarnings("plain name.png")).toEqual([]);
    expect(nameWarnings("a.part")[0]).toContain("does not come back");
    expect(nameWarnings("-x.png")).toHaveLength(1);
    expect(nameWarnings("100%.png")).toHaveLength(1);
    expect(nameWarnings("C#.png")).toHaveLength(1);
    expect(nameWarnings("C#.md")).toHaveLength(0);
  });
});

describe("no file on a disk is renamed by a newer rule", () => {
  it("a name right by an earlier version still fits: dots taken for an extension, other letters, unseen ones, runs of forbidden ones", () => {
    const fits = (file: string, name: string, type = "image/png", strict = false): boolean => keptFits(`library/${file}`, ["library"], name, type, strict);
    expect(fits("Scan v2.1", "Scan v2.1")).toBe(true);
    expect(fits("Scan v2.1.png", "Scan v2.1")).toBe(true);
    expect(fits("café.png", "café.png")).toBe(true);
    expect(fits("a​b.png", "a​b.png")).toBe(true);
    expect(fits("a--b.png", "a::b.png")).toBe(true);
    expect(fits("C# notes.md", "C# notes.md", "text/markdown")).toBe(true);
    expect(fits("photo-2.png", "photo.png")).toBe(true);
    expect(fits("other.png", "photo.png")).toBe(false);
    // Asked for by name, they take today's.
    expect(fits("Scan v2.1", "Scan v2.1", "image/png", true)).toBe(false);
    expect(fits("Scan v2.1.png", "Scan v2.1", "image/png", true)).toBe(true);
    expect(fits("a​b.png", "a​b.png", "image/png", true)).toBe(false);
    expect(fitsWritten("x", "x.png", "x")).toBe(true);
    // Repair leaves what it cannot tell alone.
    expect(fits("README", "README", "", true)).toBe(true);
    expect(fits("x.7z.001", "x.7z.001", "", true)).toBe(true);
    expect(fits("data.xyz", "data.xyz", "", true)).toBe(true);
  });
  it("a file keeps its real extension: a dot in a name is a part of the name, unless it gives a kind of file", () => {
    expect(keptFile("Scan v2.1", "png", "image/png")).toEqual({ base: "Scan v2.1", ext: "png" });
    expect(keptFile("draft.final", "png", "image/png")).toEqual({ base: "draft.final", ext: "png" });
    expect(keptFile("photo.jpg", "png", "image/png")).toEqual({ base: "photo", ext: "jpg" });
    expect(keptFile("data.xyz", "xyz", "")).toEqual({ base: "data", ext: "xyz" });
    expect(keptFile("Scan v2.1", "1", "image/png")).toEqual({ base: "Scan v2.1", ext: "png" });
    expect(keptFile("plan.note.html", "html", "text/html")).toEqual({ base: "plan.note", ext: "html" });
    // Not known what it is: nothing made up, and the name stays as it is.
    expect(keptFile("README", "", "")).toEqual({ base: "README", ext: "" });
    expect(keptFile("README", "", "application/octet-stream")).toEqual({ base: "README", ext: "" });
    expect(keptFile("x.7z.001", "001", "")).toEqual({ base: "x.7z", ext: "001" });
    expect(keptFile("photo", "", "image/png")).toEqual({ base: "photo", ext: "png" });
  });
});

describe("folders spelled another way on disk", () => {
  it("are the place of their library folder, at every depth, and no other folder's", () => {
    expect(isFolderOf("library/A- B", ["a-b"])).toBe(true);
    expect(isFolderOf("library/a-b", ["A- B"])).toBe(true);
    expect(isFolderOf("library/Refs/A: B", ["refs", "a-b"])).toBe(true);
    expect(isFolderOf("library/Refs", ["Other"])).toBe(false);
    expect(isFolderOf("library/Refs/Sub", ["Refs"])).toBe(false);
    expect(isFolderOf("library", [])).toBe(false);
  });
});

describe("hidden items", () => {
  const item = (hidden: boolean, value: string): CatalogEntry => ({ hash: value, name: `${value}.png`, type: "image/png", size: 1, pixelW: 1, pixelH: 1, importedAt: 1, state: "active", hidden, fields: [{ key: "secret", value }] }) as unknown as CatalogEntry;
  it("what a hidden item says is offered in hidden mode only", () => {
    const all = [item(false, "shown"), item(true, "private")];
    expect(propValues(all, "secret")).toEqual(["shown"]);
    expect(propValues(all, "secret", 50, true)).toEqual(["private"]);
  });
  it("the sealed name of a clash is what it was, so no sealed file moves", () => {
    expect(numberedName("plan.note", 2, ".html")).toBe("plan.note-2.html");
    expect(numberedName("plan.note", 1, ".html")).toBe("plan.note.html");
  });
});

describe("the other shared rules", () => {
  it("one engine for dates: both spellings of a template read it", () => {
    const w = dateWords(new Date(2026, 10, 4, 15, 7, 9));
    expect([w.YYYY, w.MM, w.DD, w.HH, w.mm, w.ss, w.h, w.A, w.MMM, w.ddd]).toEqual(["2026", "11", "04", "15", "07", "09", "3", "PM", "Nov", "Wed"]);
  });
  it("one key for a [[link]]; one encoder, and a link reads back whole", () => {
    expect(["Plan.md", "plan.MARKDOWN", "plan.txt", "PLAN.note.html", "plan"].map(wikiKeyOf)).toEqual(["plan", "plan", "plan", "plan", "plan"]);
    expect(wikiKeyOf("cat.png")).toBe("cat.png");
    expect(wikiTarget("Dir/Plan.md#head")).toEqual({ name: "plan", dirs: ["dir"] });
    for (const part of ["Mix (RGB) One.png", "it's!*.md", "日本語 ファイル", "a b/c"]) expect(decodeURIComponent(encodeLinkPart(part))).toBe(part);
    expect(encodeLinkPart("a (b)")).toBe("a%20%28b%29");
  });
});
