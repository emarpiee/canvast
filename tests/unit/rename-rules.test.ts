import { describe, expect, it } from "vitest";
import { applyRule, cleanFileName, ruleProblem, splitName } from "../../src/doc/rename-rules";

const names = ["a.png", "b.png", "My Photo.JPG", "notes"];

describe("batch rename rules (ADR 0085)", () => {
  it("splits a name and its extension", () => {
    expect(splitName("model.final.glb")).toEqual({ stem: "model.final", ext: ".glb" });
    expect(splitName("notes")).toEqual({ stem: "notes", ext: "" });
    expect(splitName(".hidden")).toEqual({ stem: ".hidden", ext: "" });
    expect(splitName("a.toolongextension")).toEqual({ stem: "a.toolongextension", ext: "" });
  });
  it("enumerate: # becomes ascending numbers, a run of # is zero-padded, the extension stays", () => {
    expect(applyRule(names, { mode: "enumerate", pattern: "Shot #", start: 1, keepExt: true })).toEqual(["Shot 1.png", "Shot 2.png", "Shot 3.JPG", "Shot 4"]);
    expect(applyRule(["x.png", "y.png"], { mode: "enumerate", pattern: "img-###", start: 8, keepExt: true })).toEqual(["img-008.png", "img-009.png"]);
    expect(applyRule(["x.png"], { mode: "enumerate", pattern: "New name", start: 1, keepExt: true })).toEqual(["New name 1.png"]); // no #: the number follows
    expect(applyRule(["x.png"], { mode: "enumerate", pattern: "{name}_#", start: 1, keepExt: true })).toEqual(["x_1.png"]);
    expect(applyRule(["x.png"], { mode: "enumerate", pattern: "n#", start: 1, keepExt: false })).toEqual(["n1"]); // the extension is part of what is replaced
  });
  it("replace text: plain or regular expression, with or without case", () => {
    expect(applyRule(names, { mode: "replace", find: "PHOTO", with: "pic", matchCase: false, regex: false, keepExt: true })[2]).toBe("My pic.JPG");
    expect(applyRule(names, { mode: "replace", find: "PHOTO", with: "pic", matchCase: true, regex: false, keepExt: true })[2]).toBe("My Photo.JPG");
    expect(applyRule(["a1.png", "b22.png"], { mode: "replace", find: "(\\d+)", with: "[$1]", matchCase: true, regex: true, keepExt: true })).toEqual(["a[1].png", "b[22].png"]);
    expect(applyRule(["a.b.png"], { mode: "replace", find: ".", with: "_", matchCase: true, regex: false, keepExt: true })).toEqual(["a_b.png"]); // a dot is a dot, not any character
    expect(applyRule(["a.png"], { mode: "replace", find: "", with: "x", matchCase: true, regex: false, keepExt: true })).toEqual(["a.png"]);
  });
  it("add text before or after the name, before the extension", () => {
    expect(applyRule(["a.png", "notes"], { mode: "add", text: "old-", where: "before", keepExt: true })).toEqual(["old-a.png", "old-notes"]);
    expect(applyRule(["a.png", "notes"], { mode: "add", text: "_v2", where: "after", keepExt: true })).toEqual(["a_v2.png", "notes_v2"]);
    expect(applyRule(["a.png"], { mode: "add", text: "_v2", where: "after", keepExt: false })).toEqual(["a.png_v2"]);
  });
  it("set, change or remove the extension", () => {
    expect(applyRule(["a.png", "notes"], { mode: "extension", ext: "jpg" })).toEqual(["a.jpg", "notes.jpg"]);
    expect(applyRule(["a.png"], { mode: "extension", ext: ".webp" })).toEqual(["a.webp"]);
    expect(applyRule(["a.png"], { mode: "extension", ext: "" })).toEqual(["a"]);
  });
  it("names are cleaned, an unreadable pattern changes nothing, a name that would be empty is kept", () => {
    expect(cleanFileName('  a/b:c*"d"  ')).toBe("a-b-c-d-");
    expect(ruleProblem({ mode: "replace", find: "(", with: "", matchCase: true, regex: true, keepExt: true })).not.toBeNull();
    expect(applyRule(["a.png"], { mode: "replace", find: "(", with: "", matchCase: true, regex: true, keepExt: true })).toEqual(["a.png"]);
    expect(applyRule(["a.png"], { mode: "replace", find: "a", with: "", matchCase: true, regex: false, keepExt: true })).toEqual(["a.png"]);
    expect(ruleProblem({ mode: "enumerate", pattern: "#", start: -1, keepExt: true })).not.toBeNull();
  });
});
