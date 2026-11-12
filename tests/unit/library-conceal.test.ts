import { describe, expect, it } from "vitest";
import type { AssetFolder } from "../../src/assets/asset-catalog";
import { concealedUnder, countSide, inScope, type ListedEntry } from "../../src/assets/library-match";

const folders: AssetFolder[] = [
  { id: "refs", name: "Refs", parentId: null },
  { id: "hands", name: "Hands", parentId: "refs" },
  { id: "other", name: "Other", parentId: null },
];
const item = (hash: string, folderIds: string[]): ListedEntry =>
  ({ hash, name: `${hash}.png`, type: "image/png", size: 1, folderIds, tags: ["study"], importedAt: 0, state: "active", present: true, instances: 0, canvases: 0, canvasIds: [] }) as unknown as ListedEntry;
const inRefs = item("a", ["refs"]);
const inHands = item("b", ["hands"]);
const elsewhere = item("c", ["other"]);
const loose = item("d", []);

describe("concealed folders: a view filter", () => {
  const concealed = concealedUnder(folders, ["refs"]);
  const scope = (s: string, e: ListedEntry): boolean =>
    inScope(e, s, { concealed, inFolders: s.startsWith("folder:") ? new Set(s === "folder:refs" ? ["refs", "hands"] : [s.slice(7)]) : null });

  it("takes in the folder and every folder under it", () => {
    expect([...concealed!].sort()).toEqual(["hands", "refs"]);
    expect(concealedUnder(folders, [])).toBeNull();
  });

  it("lists a concealed folder's items only when it, or a folder in it, is opened", () => {
    for (const s of ["all", "unfiled", "ext:png", "tag:study"]) expect([inRefs, inHands, elsewhere, loose].filter((e) => scope(s, e)).map((e) => e.hash), s).not.toContain("a");
    expect(scope("all", inHands)).toBe(false);
    expect(scope("all", elsewhere)).toBe(true);
    expect(scope("folder:refs", inRefs)).toBe(true);
    expect(scope("folder:refs", inHands)).toBe(true);
    expect(scope("folder:hands", inHands)).toBe(true);
  });

  it("counts a concealed item only in its concealed folders", () => {
    const c = countSide([inRefs, inHands, elsewhere, loose], folders, false, ["refs"]);
    expect(c.shown).toBe(2);
    expect(c.types.get("png")).toBe(2);
    expect(c.tags.get("study")?.n).toBe(2);
    expect(c.folders.get("refs")).toBe(2);
    expect(c.folders.get("hands")).toBe(1);
    expect(c.folders.get("other")).toBe(1);
  });
});
