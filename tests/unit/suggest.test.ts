import { describe, expect, it } from "vitest";
import { applySuggestion, suggest, wordAt } from "../../src/search/suggest";

const src = {
  tags: [{ label: "sky", n: 3 }, { label: "skyline", n: 1 }, { label: "hero", n: 5 }, { label: "two words", n: 2 }],
  types: [{ ext: "png", n: 40 }, { ext: "pdf", n: 2 }, { ext: "glb", n: 1 }],
};
const at = (v: string) => suggest(v, v.length, src);
const labels = (v: string) => at(v).items.map((i) => i.label);

describe("search suggestions (ADR 0083)", () => {
  it("a dot word suggests file types by what is typed, most files first", () => {
    expect(labels(".p")).toEqual([".png", ".pdf"]);
    expect(labels(".g")).toEqual([".glb"]);
    expect(labels(".png")).toEqual([]); // complete already
    expect(labels(".")).toEqual([".png", ".pdf", ".glb"]);
  });
  it("a hash word suggests tags, prefix matches first; a tag with spaces is quoted", () => {
    expect(labels("#sk")).toEqual(["#sky", "#skyline"]);
    expect(labels("#wor")).toEqual(["#two words"]);
    expect(at("#wor").items[0]!.insert).toBe('"#two words" ');
  });
  it("a plain word suggests matching tags and file types", () => {
    expect(labels("sk")).toEqual(["#sky", "#skyline"]);
    expect(labels("pn")).toEqual([".png"]);
    expect(labels("zzz")).toEqual([]);
  });
  it("a capital letter suggests the operator it starts; a finished word suggests what can follow", () => {
    expect(labels("sky O")).toEqual(["OR"]);
    expect(labels("sky A")).toEqual(["AND"]);
    expect(labels("sky ")).toEqual(["AND", "OR", "XOR"]);
    expect(labels("sky OR ")).toEqual([]);
    expect(labels("")).toEqual([]);
    expect(labels("(")).toEqual([]);
  });
  it("finds the word around the cursor and ignores a leading minus", () => {
    expect(wordAt("red -#sk blue", 8)).toEqual({ start: 5, end: 8, text: "#sk" });
    expect(wordAt("red OR blue", 5)).toEqual({ start: 4, end: 6, text: "OR" });
  });
  it("applying replaces just that word and keeps the rest", () => {
    const v = "red .p blue";
    const s = suggest(v, 6, src);
    const r = applySuggestion(v, s, s.items[0]!);
    expect(r.value).toBe("red .png blue");
    expect(r.caret).toBe("red .png ".length);
  });
});
