import { describe, expect, it } from "vitest";
import { Library, openLibraryDb } from "../../desktop/library-db";
import { libraryPartText } from "../../src/storage/library-mirror";
import type { LibraryItem } from "../../src/storage/library-mirror";

const item = (n: number, over: Partial<LibraryItem> = {}): LibraryItem => ({
  hash: n.toString(16).padStart(2, "0").repeat(32), file: `library/images/p${n}.png`, name: `p${n}.png`, type: "image/png", size: 10, pixelW: 1, pixelH: 1,
  importedAt: n, tags: [], favorite: false, folderId: null, note: "", fields: [], state: "active", ...over,
});
/** A folder of parts as another device wrote them. */
const folder = (items: LibraryItem[]) => {
  const parts = new Map<string, LibraryItem[]>();
  for (const i of items) (parts.get(i.hash.slice(0, 2)) ?? parts.set(i.hash.slice(0, 2), []).get(i.hash.slice(0, 2))!).push(i);
  const files = new Map([...parts].map(([k, l]) => [k, Buffer.from(libraryPartText(l))]));
  return { keys: [...files.keys()].sort(), read: (k: string) => files.get(k) ?? null };
};

describe("library database (desktop)", () => {
  it("takes the folder's items, then only what changed; this device's own change wins; erased items are marked deleted", () => {
    const lib = new Library(openLibraryDb(":memory:"));
    let f = folder([item(1), item(2), item(3)]);
    expect(lib.sync(f.keys, f.read, [], true)).toEqual({ took: true, whole: true, read: 3 });
    expect(lib.rec(item(2).hash)!.file).toBe("library/images/p2.png");
    // Unchanged parts are not read again.
    expect(lib.sync(f.keys, f.read, [], true)).toEqual({ took: false, whole: true, read: 0 });
    // Here: item 1 renamed. There: item 1 and item 2 renamed, item 3 erased.
    lib.apply([{ t: "entry", hash: item(1).hash, v: { ...lib.entry(item(1).hash)!, name: "mine.png" } }]);
    f = folder([item(1, { name: "theirs.png" }), item(2, { name: "two.png" })]);
    const r = lib.sync(f.keys, f.read, [], true);
    expect(r.took).toBe(true);
    expect(lib.entry(item(1).hash)!.name).toBe("mine.png");
    expect(lib.entry(item(2).hash)!.name).toBe("two.png");
    expect(lib.entry(item(3).hash)!.state).toBe("deleted");
    expect(JSON.parse(lib.entriesText("state = 'active'")).length).toBe(2);
  });

  it("erases nothing when a part is missing or damaged, or deletions are off (hidden items locked)", () => {
    const lib = new Library(openLibraryDb(":memory:"));
    const f = folder([item(1), item(2)]);
    lib.sync(f.keys, f.read, [], true);
    expect(lib.sync([...f.keys, "ff"], (k) => (k === "ff" ? Buffer.from("{oops") : null), [], true).whole).toBe(false);
    expect(lib.entry(item(1).hash)!.state).toBe("active");
    const g = folder([item(2)]);
    lib.sync(g.keys, g.read, [], false);
    expect(lib.entry(item(1).hash)!.state).toBe("active");
  });

  it("writes the parts from here: only changed ones, then the index; what it wrote reads back as nothing new", async () => {
    const lib = new Library(openLibraryDb(":memory:"));
    const disk = new Map<string, string>();
    const files = { read: (p: string) => (disk.has(p) ? Buffer.from(disk.get(p)!) : null), write: async (p: string, t: string) => void disk.set(p, t), remove: async (p: string) => void disk.delete(p) };
    const f = folder([item(1), item(2)]);
    for (const k of f.keys) disk.set(`.canvast/library/items-${k}.json`, f.read(k)!.toString());
    lib.sync(f.keys, f.read, [], true);
    await lib.writeParts(null, 10, files);
    expect(disk.get(".canvast/library/items-01.json")).toBe(f.read("01")!.toString());
    expect(JSON.parse(disk.get(".canvast/library/index.json")!).parts).toEqual(["01", "02"]);
    expect(disk.has(".canvast/library.json")).toBe(true);
    // A rename here: only its part is written again, and reading the folder back takes nothing.
    lib.apply([{ t: "entry", hash: item(2).hash, v: { ...lib.entry(item(2).hash)!, name: "two.png" } }]);
    const writes: string[] = [];
    const w = await lib.writeParts([item(2).hash], 1, { ...files, write: async (p, t) => void (writes.push(p), disk.set(p, t)) });
    expect(writes).toEqual([".canvast/library/items-02.json"]);
    expect(w.compat).toBe("-");
    expect(disk.has(".canvast/library.json")).toBe(false);
    const keys = JSON.parse(disk.get(".canvast/library/index.json")!).parts as string[];
    expect(lib.sync(keys, (k) => files.read(`.canvast/library/items-${k}.json`), [], true).took).toBe(false);
  });
});
