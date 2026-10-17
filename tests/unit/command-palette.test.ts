import { describe, expect, it } from "vitest";
import { findCommands } from "../../src/ui/command-palette";
import type { Command } from "../../src/ui/command-palette";

const c = (group: string, title: string, extra: Partial<Command> = {}): Command => ({ group, title, run: () => undefined, ...extra });

describe("finding a command (ADR 0117)", () => {
  const all = [c("Tool", "Select"), c("Edit", "Undo", { words: "back" }), c("Edit", "Delete the selection", { enabled: () => false }), c("View", "Zoom in"), c("View", "Zoom out"), c("Settings", "Animation")];
  it("needs every word, in the group, title or extra words, and skips what cannot be done now", () => {
    expect(findCommands(all, "zoom").map((x) => x.title)).toEqual(["Zoom in", "Zoom out"]);
    expect(findCommands(all, "view out").map((x) => x.title)).toEqual(["Zoom out"]);
    expect(findCommands(all, "back").map((x) => x.title)).toEqual(["Undo"]);
    expect(findCommands(all, "delete")).toEqual([]);
    expect(findCommands(all, "")).toHaveLength(5);
  });
  it("puts a title that starts with the word first, then the shorter title", () => {
    const l = [c("Edit", "Redo the selection"), c("Edit", "Select everything"), c("Tool", "Select")];
    expect(findCommands(l, "select").map((x) => x.title)).toEqual(["Select", "Select everything", "Redo the selection"]);
  });
});
