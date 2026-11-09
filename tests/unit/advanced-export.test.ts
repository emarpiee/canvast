import { describe, expect, it } from "vitest";
import { chosenItems, type ExportItem } from "../../src/ui/advanced-export";
import type { AssetFolder } from "../../src/assets/asset-catalog";

const folders: AssetFolder[] = [{ id: "a", name: "A", parentId: null }, { id: "b", name: "B", parentId: "a" }];
const items: ExportItem[] = [{ hash: "1", name: "one", size: 1 }, { hash: "2", name: "two", size: 2, folderIds: ["a"] }, { hash: "3", name: "three", size: 3, folderIds: ["b"] }];

describe("what Advanced export takes", () => {
  it("an item by itself, or a folder with what is inside it and in its folders", () => {
    expect(chosenItems(items, folders, new Set(["1"]), new Set()).map((i) => i.hash)).toEqual(["1"]);
    expect(chosenItems(items, folders, new Set(), new Set(["a"])).map((i) => i.hash)).toEqual(["2", "3"]);
    expect(chosenItems(items, folders, new Set(), new Set(["b"])).map((i) => i.hash)).toEqual(["3"]);
  });
});
