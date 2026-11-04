import { describe, expect, it } from "vitest";
import { normalizeFields } from "../../src/assets/asset-catalog";
import { fileMeta, parseProps, splitFrontmatter, wholeMarkdown, withFileMeta } from "../../src/notes/frontmatter";
import { firstHeading, formatNoteDate, isAutoDate, isAutoKey, noteFileName, setAutoDates, stampNote } from "../../src/notes/note-dates";
import { asWritten, fitsType, guessType, parsePropTypes, pickerShows, propType, setPropTypes, typeWarning, validPropTypes, withPropType } from "../../src/notes/prop-types";

describe("property types", () => {
  it("checks a value against each type; empty always fits", () => {
    expect(["1977", "3.14", "-2"].every((v) => fitsType("number", v))).toBe(true);
    expect(["1 + 1", "four", "1,5"].some((v) => fitsType("number", v))).toBe(false);
    expect(fitsType("checkbox", "true") && fitsType("checkbox", "False") && !fitsType("checkbox", "yes")).toBe(true);
    expect(fitsType("date", "2024-02-29") && !fitsType("date", "2025-02-29") && !fitsType("date", "2025-1-5") && !fitsType("date", "2025-01-05T10:00")).toBe(true);
    expect(fitsType("datetime", "2025-01-05T10:00") && fitsType("datetime", "2025-01-05T10:00:30+02:00") && !fitsType("datetime", "2025-01-05") && !fitsType("datetime", "2025-01-05T25:00")).toBe(true);
    for (const t of ["number", "checkbox", "date", "datetime", "text", "list"] as const) expect(fitsType(t, "")).toBe(true);
    expect(typeWarning("number", "x")).toContain("expected a number");
    expect(typeWarning("text", "x")).toBe("");
  });
  it("reads a type from a value; a name's own type comes first; aliases and cssclasses are lists", () => {
    expect(["4", "true", "2025-01-05", "2025-01-05T10:00", "hello", ""].map(guessType)).toEqual(["number", "checkbox", "date", "datetime", "text", "text"]);
    setPropTypes(withPropType("{}", " Rating ", "text"));
    expect(propType("rating", "4")).toBe("text");
    expect(propType("year", "4")).toBe("number");
    expect(propType("Aliases", "4")).toBe("list");
    setPropTypes("{}");
  });
  it("refuses a stored list with an unknown type", () => {
    expect(parsePropTypes('{"a":"colour"}')).toBeNull();
    expect(validPropTypes('{"a":"date"}')).toBeTruthy();
    expect(validPropTypes("[]")).toBeUndefined();
  });
  it("a picker's value stays as written while it means the same", () => {
    expect(asWritten("2025-01-05T10:00:00", "2025-01-05T10:00")).toBe("2025-01-05T10:00:00");
    expect(asWritten("2025-01-05T10:00:30", "2025-01-05T10:00")).toBe("2025-01-05T10:00");
    expect(asWritten("True", "true")).toBe("True");
    expect(pickerShows("2025-01-05T10:00+02:00")).toBe(false);
  });
  it("a list's items stay whole: a comma in one is no second item, and an edit writes them as they are", () => {
    const file = '---\ncast:\n  - "Smith, John"\n  - Ana\n---\n# T\n';
    const m = fileMeta("md", file)!;
    expect(m.fields).toEqual([{ key: "cast", value: "Smith, John, Ana", items: ["Smith, John", "Ana"] }]);
    expect(propType("cast", "Smith, John, Ana", m.fields[0]!.items)).toBe("list");
    expect(withFileMeta("md", file, m)).toBe(file);
    const items = ["Smith, John", "Bo", "[[Link]]"];
    expect(withFileMeta("md", file, { ...m, fields: [{ key: "cast", value: items.join(", "), items }] })).toBe('---\ncast:\n  - Smith, John\n  - Bo\n  - "[[Link]]"\n---\n# T\n');
    expect(normalizeFields([{ key: "a", value: "x", items: [" b ", "", "c, d"] }])).toEqual([{ key: "a", value: "b, c, d", items: ["b", "c, d"] }]);
    expect(withFileMeta("md", "---\naliases: []\n---\nx", fileMeta("md", "---\naliases: []\n---\nx")!)).toBe("---\naliases: []\n---\nx");
  });
  it("the whole note: properties as the panel has them over its words, as written where they are the same", () => {
    const file = '---\nstatus: "new"\ntype: Zettel\n---\nOld words\n';
    const meta = { tags: ["a"], note: "", fields: [{ key: "status", value: "new" }, { key: "type", value: "Zettel" }, { key: "cast", value: "Ana", items: ["Ana"] }] };
    expect(wholeMarkdown("md", file, "# New words\n", meta, [])).toBe('---\nstatus: "new"\ntype: Zettel\ntags:\n  - a\ncast:\n  - Ana\n---\n# New words\n');
    expect(wholeMarkdown("rich", "", "# R\n", { tags: [], note: "", fields: [{ key: "k", value: "v" }] }, [])).toBe("---\nk: v\n---\n# R\n");
  });
  it("the file: a list as a list, a checkbox unquoted, whatever else as before", () => {
    setPropTypes('{"cast":"list","done":"checkbox","word":"text"}');
    const out = withFileMeta("md", "# T\n", { tags: [], note: "", fields: [{ key: "cast", value: "Ana, Bo" }, { key: "done", value: "true" }, { key: "word", value: "true" }, { key: "aliases", value: "One" }] });
    expect(out).toBe('---\ncast:\n  - Ana\n  - Bo\ndone: true\nword: "true"\naliases:\n  - One\n---\n# T\n');
    setPropTypes("{}");
  });
});

describe("what a save changes by itself", () => {
  const AT = new Date(2026, 10, 4, 15, 7, 9);
  const now = AT.getTime();
  const off = { on: false, created: "created", modified: "modified", format: "YYYY-MM-DDTHH:mm", title: "title", titleFrom: "off" as const, rename: false, nameFrom: "h1" as const, nameStyle: "kept" as const };
  it("formats a moment; brackets and other letters stay", () => {
    expect(formatNoteDate(AT, "YYYY-MM-DDTHH:mm:ss")).toBe("2026-11-04T15:07:09");
    expect(formatNoteDate(AT, "ddd D MMM YY, h:mm A [at] [home]")).toBe("Wed 4 Nov 26, 3:07 PM at home");
  });
  it("all off (the default): nothing changes", () => {
    setAutoDates(off);
    const file = '---\ntitle:   "x"\n---\n\n# H\n';
    expect(stampNote("md", file, 1, now)).toBe(file);
    expect(stampNote("rich", "<html></html>", 1, now)).toBe("<html></html>");
    expect(noteFileName("md", file, "n.md")).toBeNull();
  });
  it("the two times: modified in its place, created kept or added", () => {
    setAutoDates({ ...off, on: true });
    expect(stampNote("md", '---\nmodified: "old"\ntitle: T\ncreated: 2000\n---\nBody\n', 1, now)).toBe("---\nmodified: 2026-11-04T15:07\ntitle: T\ncreated: 2000\n---\nBody\n");
    expect(stampNote("md", "Body\n", new Date(2020, 0, 2, 3, 4).getTime(), now)).toBe("---\ncreated: 2020-01-02T03:04\nmodified: 2026-11-04T15:07\n---\nBody\n");
    expect(stampNote("txt", "Body", 1, now)).toBe("Body");
    expect(stampNote("rich", "<html><head><title>t</title></head><body></body></html>", now, now)).toContain('<meta name="modified" content="2026-11-04T15:07">');
    expect(isAutoDate("md", "CREATED")).toBe(true);
    expect(isAutoKey("md", "title")).toBe(false);
    setAutoDates(off);
  });
  it("the title follows the first heading, not one in code; no heading leaves it", () => {
    setAutoDates({ ...off, titleFrom: "h1" });
    const title = (file: string): string | string[] | undefined => splitFrontmatter(stampNote("md", file, 1, now)).props?.find((p) => p.key === "title")?.value;
    expect(title("---\ntitle: By hand\n---\n```\n# not this\n```\n## Nor this\n# **My** [[a|Head]] #\n")).toBe("My Head");
    expect(title("---\ntitle: By hand\n---\nNo heading\n")).toBe("By hand");
    expect(stampNote("md", "No heading\n", 1, now)).toBe("No heading\n");
    expect(firstHeading("rich", '<body><h1 class="x">A <b>B</b> &amp; C</h1></body>')).toBe("A B & C");
    expect(isAutoKey("md", "Title")).toBe(true);
    expect(isAutoKey("txt", "Title")).toBe(false);
    setAutoDates(off);
  });
  it("a note pasted with its own title and created keeps them over the note's; modified is the save's", () => {
    setAutoDates({ ...off, on: true, titleFrom: "h1" });
    const pasted = parseProps(["title: Pasted", "created: 2001-01-01", "modified: 2002-02-02"]);
    expect(stampNote("md", "---\ntitle: Mine\ncreated: 2020-01-01\nmodified: 2020-01-01\n---\n# Head\n", 1, now, pasted)).toBe("---\ntitle: Pasted\ncreated: 2001-01-01\nmodified: 2026-11-04T15:07\n---\n# Head\n");
    setAutoDates(off);
  });
  it("a file's name: from the heading or the title, in either style, and what must never happen to it", () => {
    const name = (file: string, current = "old.md", over = {}, itemTitle?: string): string | null => {
      setAutoDates({ ...off, rename: true, ...over });
      const out = noteFileName("md", file, current, itemTitle);
      setAutoDates(off);
      return out;
    };
    expect(name("# My Note: Part (1)\n")).toBe("My Note- Part (1).md");
    expect(name("# My Note: Part (1)\n", "old.md", { nameStyle: "clean" })).toBe("my_note-part-1.md");
    expect(name("---\ntitle: From Title\n---\n# Head\n", "old.md", { nameFrom: "title" })).toBe("From Title.md");
    expect(name("# Head\n", "old.md", { nameFrom: "title" }, "In the library")).toBe("In the library.md");
    expect(name("# Report v1.2\n"), "a dot is no extension").toBe("Report v1.2.md");
    expect(name("# ???\n"), "nothing usable").toBeNull();
    expect(name("# ???\n", "old.md", { nameStyle: "clean" })).toBeNull();
    expect(name("No heading\n")).toBeNull();
    expect(name("# .hidden\n"), "never a hidden file").toBe("hidden.md");
    expect(name("# CON\n")).toBe("CON_file.md");
    expect(name("# C# notes\n"), "a link can reach it").toBe("C- notes.md");
    expect(name("# Chapter\n", "Chapter-2024.md"), "a year is no clash").toBe("Chapter.md");
    expect(name("# a/b\\c\n"), "never a path").toBe("a-b-c.md");
    expect(name("# Same\n", "Same.md")).toBeNull();
    expect(name("# Same\n", "Same-2.md"), "another note had it first").toBeNull();
    expect(name("# Same-2\n", "Same-2.md")).toBeNull();
    expect(name("# Other\n", "Same-2.md")).toBe("Other.md");
    expect(name(`# ${"x".repeat(400)}\n`)!.length).toBeLessThan(260);
    setAutoDates({ ...off, rename: true });
    expect(noteFileName("rich", "<h1>Rich: one</h1>", "old.note.html")).toBe("Rich- one.note.html");
    expect(noteFileName("txt", "# Head", "old.txt")).toBeNull();
    setAutoDates(off);
  });
});
