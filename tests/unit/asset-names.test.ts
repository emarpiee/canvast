import { describe, expect, it, vi } from "vitest";
import { AssetNames } from "../../src/app/asset-names";

describe("the names of placed items", () => {
  it("follow the library when a name changed outside the app, and say so once", async () => {
    const names: Record<string, string> = { a: "old.png", b: "same.png" };
    const n = new AssetNames(async (h) => names[h]!);
    n.set("a", "old.png");
    n.set("b", "same.png");
    const told = vi.fn();
    n.subscribe(told);
    names["a"] = "new.png";
    await n.refresh();
    expect(n.map.get("a")).toBe("new.png");
    expect(told).toHaveBeenCalledTimes(1);
    await n.refresh();
    expect(told).toHaveBeenCalledTimes(1);
  });
});
