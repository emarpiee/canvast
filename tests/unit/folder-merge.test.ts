import { describe, expect, it } from "vitest";
import { freeFolderName, mergeFolderInto } from "../../src/app/folder-merge";
import type { AssetFolder } from "../../src/assets/asset-catalog";
import type { CatalogStore } from "../../src/storage/store";

/** The catalog as far as merging reads it. */
function catalog(folders: AssetFolder[], items: Record<string, string>): { c: CatalogStore; items: Record<string, string>; folders: AssetFolder[] } {
  const state = { folders: [...folders], items: { ...items } };
  const c = {
    folders: async () => state.folders,
    list: async () => ({ entries: Object.entries(state.items).map(([hash, f]) => ({ hash, folderIds: [f] })), folders: state.folders, missing: [], pendingDeletion: 0 }),
    updateMetaEach: async (ch: Array<{ hash: string; change: { addFolders: string[] } }>) => {
      for (const x of ch) state.items[x.hash] = x.change.addFolders[0]!;
      return [];
    },
    createFolder: async (name: string, parentId: string | null, id: string) => {
      const f = { id, name, parentId } as AssetFolder;
      state.folders.push(f);
      return f;
    },
    deleteFolder: async (id: string) => {
      const gone = new Set([id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const f of state.folders) if (f.parentId && gone.has(f.parentId) && !gone.has(f.id)) (gone.add(f.id), (grew = true));
      }
      state.folders = state.folders.filter((f) => !gone.has(f.id));
      return { folders: gone.size, unfiled: Object.values(state.items).filter((v) => gone.has(v)).length };
    },
  } as unknown as CatalogStore;
  return { c, get items() { return state.items; }, get folders() { return state.folders; } };
}
const F = (id: string, name: string, parentId: string | null = null): AssetFolder => ({ id, name, parentId }) as AssetFolder;

describe("two folders become one", () => {
  it("items and subfolders go across; like subfolders join; none is left out of a folder", async () => {
    const x = catalog([F("a", "Refs"), F("b", "refs"), F("a1", "Hands", "a"), F("b1", "hands", "b"), F("a2", "Only", "a"), F("a3", "Deep", "a2")], { p: "a", q: "a1", r: "a2", s: "a3", t: "b" });
    await mergeFolderInto(x.c, "a", "b");
    expect(x.items.p).toBe("b");
    expect(x.items.q).toBe("b1"); // (joined its like)
    expect(x.items.t).toBe("b");
    const only = x.folders.find((f) => f.name === "Only")!;
    expect(only.parentId).toBe("b");
    expect(x.items.r).toBe(only.id);
    const deep = x.folders.find((f) => f.name === "Deep")!;
    expect(deep.parentId).toBe(only.id);
    expect(x.items.s).toBe(deep.id);
    expect(x.folders.some((f) => f.id === "a" || f.id === "a1" || f.id === "a2" || f.id === "a3")).toBe(false);
    const known = new Set(x.folders.map((f) => f.id));
    for (const v of Object.values(x.items)) expect(known.has(v)).toBe(true);
  });
  it("a free name is free on any disk, beside these folders only", () => {
    expect(freeFolderName([F("a", "Refs"), F("b", "refs-2"), F("c", "Refs-3", "z")], null, "REFS")).toBe("REFS-3");
    expect(freeFolderName([F("a", "Refs")], null, "refs", "a")).toBe("refs-2");
  });
});
