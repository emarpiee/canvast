import { describe, expect, it } from "vitest";
import { withFileMeta } from "../../src/notes/frontmatter";
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
  it("the file: a list as a list, a checkbox unquoted, whatever else as before", () => {
    setPropTypes('{"cast":"list","done":"checkbox","word":"text"}');
    const out = withFileMeta("md", "# T\n", { tags: [], note: "", fields: [{ key: "cast", value: "Ana, Bo" }, { key: "done", value: "true" }, { key: "word", value: "true" }, { key: "aliases", value: "One" }] });
    expect(out).toBe('---\ncast:\n  - Ana\n  - Bo\ndone: true\nword: "true"\naliases:\n  - One\n---\n# T\n');
    setPropTypes("{}");
  });
});
