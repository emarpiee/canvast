import { describe, expect, it } from "vitest";
import { nameWord, shotFileName, shotTags } from "../../src/app/screenshot";

const at = new Date(2026, 9, 17, 14, 5, 9); // 17 Oct 2026, 14:05:09

describe("screenshot names and tags (ADR 0080)", () => {
  it("the default name: board_name-canvas_name-ddmmyyyy-hhmmss", () => {
    const n = shotFileName("{board}-{canvas}-{ddmmyyyy}-{hhmmss}", { workspace: "My workspace", board: "Cool Board", canvas: "This is an awesome canvas", at }, "underscores");
    expect(n).toBe("cool_board-this_is_an_awesome_canvas-17102026-140509");
  });
  it("names as written, other tokens, unknown tokens left alone, nothing left falls back", () => {
    const parts = { workspace: "W", board: "Cool Board", canvas: "C/1", at };
    expect(shotFileName("{board} {canvas} {yyyymmdd}_{hhmm}", parts, "keep")).toBe("Cool Board C-1 20261017_1405");
    expect(shotFileName("{nope}-{dd}", parts, "keep")).toBe("{nope}-17");
    expect(shotFileName("  ..  ", parts, "keep")).toBe("screenshot");
    expect(shotFileName("a:b*c?", parts, "keep")).toBe("a-b-c-");
  });
  it("name words are safe on every file system", () => {
    expect(nameWord('  A  "Big"  Board?  ', "underscores")).toBe("a_-big-_board");
    expect(nameWord("", "keep")).toBe("untitled");
  });
  it("tags follow the choices and are clean", () => {
    expect(shotTags({ screenshot: true, board: true, canvas: false, items: true }, "Cool Board", "C", ["#sky", "  hero "])).toEqual(["screenshot", "Cool Board", "sky", "hero"]);
    expect(shotTags({ screenshot: false, board: false, canvas: false, items: false }, "B", "C", ["x"])).toEqual([]);
  });
});
