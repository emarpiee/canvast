import { describe, expect, it } from "vitest";
import { byUse, forget, keep, matching, MAX_SAVED, moved, parseSaved, renamed, touch, validSaved, withLook } from "../../src/search/saved";

describe("saved searches", () => {
  it("a saved search keeps its look when it is used, and a look goes in the setting's text", () => {
    const look = { layout: "list" as const, order: ["name", "prop:status"], hidden: [], sort: "prop:status", reversed: true };
    const l = withLook(keep([], "red", "all", 1)!, "red", "all", look);
    expect(touch(l, "red", "all", 2)[0]!.look).toEqual(look);
    expect(validSaved(JSON.stringify(l))).toBeTruthy();
    expect(parseSaved(JSON.stringify([{ ...l[0], look: { layout: "x" } }]))).toBeNull();
  });
  it("keeps one per text and way, newest use first, and refuses more than the limit", () => {
    let l = keep([], "red cat", "all", 1)!;
    l = keep(l, "red cat", "name", 2)!;
    l = keep(l, " red cat ", "all", 3)!; // the same search again: used, in its place, not doubled
    expect(l.map((s) => [s.q, s.m])).toEqual([["red cat", "all"], ["red cat", "name"]]);
    expect(byUse(touch(l, "red cat", "name", 9))[0]!.m).toBe("name");
    expect(touch(l, "nope", "all", 9)).toEqual(l);
    expect(forget(l, "red cat", "all").length).toBe(1);
    const full = Array.from({ length: MAX_SAVED }, (_, i) => ({ q: `q${i}`, m: "all" as const, u: i }));
    expect(keep(full, "one more", "all", 1)).toBeNull();
    expect(keep(full, "q3", "all", 1)).not.toBeNull(); // already saved: just used
  });
  it("offers the ones that hold every typed word, the ones starting with the first word first", () => {
    const l = [
      { q: "kind:video duration>1m", m: "all" as const, u: 1 },
      { q: "#sky kind:video", m: "all" as const, u: 2 },
      { q: "red", m: "all" as const, u: 3 },
    ];
    expect(matching(l, "kind vid", 5).map((s) => s.q)).toEqual(["kind:video duration>1m", "#sky kind:video"]);
    expect(matching(l, "red", 5)).toEqual([]); // typed in full: nothing to offer
    expect(matching(l, "", 5)).toEqual([]);
  });
  it("keeps the person's order: a new one last, moved up and down, and a name of its own", () => {
    let l = keep(keep(keep([], "a", "all", 1)!, "b", "all", 2)!, "c", "all", 3)!;
    expect(l.map((s) => s.q)).toEqual(["a", "b", "c"]);
    l = moved(l, "c", "all", -1);
    expect(l.map((s) => s.q)).toEqual(["a", "c", "b"]);
    expect(moved(l, "a", "all", -1)).toEqual(l); // (the first stays first)
    l = renamed(l, "b", "all", " Blues ");
    expect(l[2]).toMatchObject({ q: "b", n: "Blues" });
    expect(validSaved(JSON.stringify(l))).toBeTruthy();
    expect(renamed(l, "b", "all", "")[2]!.n).toBeUndefined(); // (no name: its words again)
    expect(touch(l, "a", "all", 9).map((s) => s.q)).toEqual(["a", "c", "b"]); // (used: in its place)
  });
  it("reads only a valid stored list", () => {
    expect(parseSaved("")).toEqual([]);
    expect(validSaved('[{"q":"a","m":"all","u":1}]')).toBeDefined();
    expect(validSaved('[{"q":"","m":"all","u":1}]')).toBeUndefined();
    expect(validSaved('[{"q":"a","m":"bogus","u":1}]')).toBeUndefined();
    expect(validSaved("{not json")).toBeUndefined();
  });
});
