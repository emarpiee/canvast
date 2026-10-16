import { describe, expect, it } from "vitest";
import { formatTag, formatTags, isTag, renamedTag, tagFormatNote, tagIsOrUnder } from "../../src/doc/tags";

describe("tags follow Obsidian's rules (ADR 0084)", () => {
  it("keeps letters of any script, digits, _ - and / and drops the rest", () => {
    expect(formatTag("project/design")).toBe("project/design");
    expect(formatTag("Été_2024-notes")).toBe("Été_2024-notes");
    expect(formatTag("日本語")).toBe("日本語");
    expect(formatTag("#already")).toBe("already");
    expect(formatTag("My Tag!")).toBe("My-Tag");
    expect(formatTag("v1.2 beta")).toBe("v12-beta");
    expect(formatTag("a  b   c")).toBe("a-b-c");
    expect(formatTag("💜")).toBe("");
    expect(formatTag("a//b/")).toBe("a/b");
    expect(formatTag("--x--")).toBe("x");
  });
  it("a tag needs a character that is not a digit: all digits get a word in front", () => {
    expect(formatTag("1984")).toBe("tag-1984");
    expect(formatTag("y1984")).toBe("y1984");
    expect(formatTag("2024/jan")).toBe("2024/jan");
  });
  it("is idempotent and says what is a proper tag", () => {
    for (const raw of ["My Tag!", "a//b", "1984", "x y/z w"]) expect(formatTag(formatTag(raw))).toBe(formatTag(raw));
    expect(isTag("a/b")).toBe(true);
    expect(isTag("a b")).toBe(false);
    expect(isTag("#a")).toBe(false);
    expect(isTag("")).toBe(false);
  });
  it("lists: empties dropped, case-different repeats keep the first spelling", () => {
    expect(formatTags(["Sky", "sky", "My Tag", "", "💜", "#hero"])).toEqual(["Sky", "My-Tag", "hero"]);
  });
  it("nested tags: a tag is also what is under it, and renaming carries the children", () => {
    expect(tagIsOrUnder("project/design", "project")).toBe(true);
    expect(tagIsOrUnder("Project", "project")).toBe(true);
    expect(tagIsOrUnder("projects", "project")).toBe(false);
    expect(renamedTag("Project/Design", "project", "work")).toBe("work/Design");
    expect(renamedTag("project", "project", "work")).toBe("work");
    expect(renamedTag("other", "project", "work")).toBeUndefined();
  });
  it("says when what was typed was formatted", () => {
    expect(tagFormatNote(["fine", "also/fine"])).toBeNull();
    expect(tagFormatNote(["My Tag"])).toContain("#My-Tag");
    expect(tagFormatNote(["a b", "c d"])).toContain("and 1 more");
  });
});
