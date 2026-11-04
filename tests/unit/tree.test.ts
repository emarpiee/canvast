import { describe, expect, it } from "vitest";
import { pathNodes, walkTree } from "../../src/ui/tree";

describe("the shared tree", () => {
  const kids: Record<string, string[]> = { a: ["b", "c"], b: ["d"], c: [], d: [] };
  const walk = (shut: string[] = []): string[] => walkTree(["a"], (t) => kids[t]!, (t) => !shut.includes(t), (t, at) => `${t}:${at.depth}:${at.last ? "L" : ""}:${at.conts.join()};`).split(";").filter(Boolean);
  it("walks what is open, in order, and says where each row is", () => {
    expect(walk()).toEqual(["a:0:L:;", "b:1::;", "d:2:L:true;", "c:1:L:;"].map((x) => x.slice(0, -1)));
    expect(walk(["b"])).toEqual(["a:0:L:", "b:1::", "c:1:L:"]);
    expect(walk(["a"])).toEqual(["a:0:L:"]);
  });
  it("names that are paths become a tree; a parent nothing stands for has no value", () => {
    const nodes = pathNodes([{ id: "x", name: "Art/Ink", value: 1 }, { id: "y", name: "solo", value: 2 }]);
    expect(nodes).toEqual([
      { id: "art", name: "Art", parent: null, value: null },
      { id: "art/ink", name: "Ink", parent: "art", value: 1 },
      { id: "solo", name: "solo", parent: null, value: 2 },
    ]);
    expect(pathNodes([{ id: "x", name: "a/b", value: 1 }, { id: "y", name: "a", value: 2 }]).find((n) => n.id === "a")!.value).toBe(2);
  });
});
