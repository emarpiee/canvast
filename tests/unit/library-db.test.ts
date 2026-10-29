import { describe, expect, it } from "vitest";
import { getRows, openLibraryDb, putRows, syncLibrary } from "../../desktop/library-db";
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
    const db = openLibraryDb(":memory:");
    let f = folder([item(1), item(2), item(3)]);
    expect(syncLibrary(db, f.keys, f.read, [], true)).toEqual({ took: true, whole: true, read: 3 });
    expect(getRows(db, [item(2).hash]).get(item(2).hash)!.rec!.file).toBe("library/images/p2.png");
    // Unchanged parts are not read again.
    expect(syncLibrary(db, f.keys, f.read, [], true)).toEqual({ took: false, whole: true, read: 0 });
    // Here: item 1 renamed. There: item 1 and item 2 renamed, item 3 erased.
    const one = getRows(db, [item(1).hash]).get(item(1).hash)!;
    putRows(db, [{ entry: { ...one.entry, name: "mine.png" } }]);
    f = folder([item(1, { name: "theirs.png" }), item(2, { name: "two.png" })]);
    const r = syncLibrary(db, f.keys, f.read, [], true);
    expect(r.took).toBe(true);
    const rows = getRows(db, [item(1).hash, item(2).hash, item(3).hash]);
    expect(rows.get(item(1).hash)!.entry.name).toBe("mine.png");
    expect(rows.get(item(2).hash)!.entry.name).toBe("two.png");
    expect(rows.get(item(3).hash)!.entry.state).toBe("deleted");
  });

  it("erases nothing when a part is missing or damaged, or deletions are off (hidden items locked)", () => {
    const db = openLibraryDb(":memory:");
    const f = folder([item(1), item(2)]);
    syncLibrary(db, f.keys, f.read, [], true);
    expect(syncLibrary(db, [...f.keys, "ff"], (k) => (k === "ff" ? Buffer.from("{oops") : null), [], true).whole).toBe(false);
    expect(getRows(db, [item(1).hash]).get(item(1).hash)!.entry.state).toBe("active");
    const g = folder([item(2)]);
    syncLibrary(db, g.keys, g.read, [], false);
    expect(getRows(db, [item(1).hash]).get(item(1).hash)!.entry.state).toBe("active");
  });
});
