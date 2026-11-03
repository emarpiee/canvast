import { describe, expect, it } from "vitest";
import { normalizeFields } from "../../src/assets/asset-catalog";
import { fileMeta, wholeMarkdown, withFileMeta } from "../../src/notes/frontmatter";
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
