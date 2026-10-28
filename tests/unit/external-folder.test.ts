import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/assets/sha256";
import { externalFolder, folderFileName } from "../../src/storage/external-folder";
import type { Dir } from "../../src/storage/external-folder";
import { HASH_NAMING } from "../../src/storage/external-folder";
import { WORKSPACE_NAMING, fitsPlace, isSafeRelativePath, libraryDir, libraryPath, placeTree, safeBase } from "../../src/storage/workspace-names";
import { itemOf, libraryJsonText, readItem } from "../../src/storage/library-mirror";
import type { CatalogEntry } from "../../src/assets/asset-catalog";

/** An in-memory directory; `tamper` changes what a file reads back as, `perm` is what the browser answers about permission. */
function fakeDir(): Dir & { files: Map<string, Blob>; tamper: boolean; perm: PermissionState } {
  const d = {
    name: "lib",
    files: new Map<string, Blob>(),
    tamper: false,
    perm: "granted" as PermissionState,
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!d.files.has(name)) {
        if (!o?.create) throw new DOMException("none", "NotFoundError");
        d.files.set(name, new Blob([]));
      }
      return {
        getFile: async () => (d.tamper ? new File([new Uint8Array([1, 2, 3])], name) : new File([d.files.get(name)!], name)),
        createWritable: async () => ({
          write: async (b: Blob) => void d.files.set(name, b),
          close: async () => undefined,
        }),
      };
    },
    async removeEntry(name: string) {
      if (!d.files.delete(name)) throw new DOMException("none", "NotFoundError");
    },
    queryPermission: async () => d.perm,
    requestPermission: async () => d.perm,
  };
  return d;
}

const bytes = new Uint8Array([9, 8, 7, 6, 5]);
const hashOf = (): Promise<string> => sha256Hex(bytes.buffer);

describe("library folder", () => {
  let dir: ReturnType<typeof fakeDir>;
  beforeEach(async () => {
    dir = fakeDir();
    await externalFolder.use(dir);
  });

  it("writes a file named by its hash, reads it back at its size, and removes it", async () => {
    const hash = await hashOf();
    await externalFolder.write(hash, new Blob([bytes]));
    expect(externalFolder.state).toBe("ready");
    expect(await externalFolder.read(hash, bytes.length)).not.toBeNull();
    expect(await externalFolder.read(hash, bytes.length + 1)).toBeNull(); // a changed file is missing, not wrong
    // A file of the folder has no extension, so no type; the original's is put back (an SVG shows only with image/svg+xml).
    expect((await externalFolder.read(hash, bytes.length, "image/svg+xml"))!.type).toBe("image/svg+xml");
    await externalFolder.remove(hash);
    expect(await externalFolder.has(hash, bytes.length)).toBe(false);
    await externalFolder.remove(hash); // already gone: no error
  });

  it("names a file by its hash and its own extension (from its name, else its type, else bin) and keeps to those names", async () => {
    const h = "a".repeat(64);
    expect(folderFileName(h, "Photo.PNG", "image/png")).toBe(`${h}.png`);
    expect(folderFileName(h, "", "image/jpeg")).toBe(`${h}.jpg`);
    expect(folderFileName(h, "x", "image/svg+xml")).toBe(`${h}.svg`);
    expect(folderFileName(h, "model", "application/octet-stream")).toBe(`${h}.bin`);
    await expect(externalFolder.write(h, new Blob([bytes]), `${h}.png`)).rejects.toThrow(/did not read back/); // (the bytes are not this hash)
    expect(dir.files.size).toBe(0); // ... and the bad file is not left
    const hash = await hashOf();
    await externalFolder.write(hash, new Blob([bytes]), `${hash}.png`);
    expect(dir.files.has(`${hash}.png`)).toBe(true);
    expect(await externalFolder.read(hash, bytes.length, "", `${hash}.png`)).not.toBeNull();
    expect(await externalFolder.read(hash, bytes.length)).toBeNull(); // the bare name is another file
    await expect(externalFolder.write(hash, new Blob([bytes]), "../x.png")).rejects.toThrow(/not available/);
    await expect(externalFolder.write(hash, new Blob([bytes]), `${"b".repeat(64)}.png`)).rejects.toThrow(/not available/); // not this hash
    await externalFolder.remove(hash, `${hash}.png`);
    expect(dir.files.size).toBe(0);
  });

  it("refuses a write that does not read back the same, and a name that is not a hash", async () => {
    const hash = await hashOf();
    dir.tamper = true;
    await expect(externalFolder.write(hash, new Blob([bytes]))).rejects.toThrow(/did not read back/);
    await expect(externalFolder.write("../evil", new Blob([bytes]))).rejects.toThrow(/not available/);
    expect(await externalFolder.read("../evil", 1)).toBeNull();
  });

  it("reads nothing while the browser wants permission, and again after reconnecting", async () => {
    const hash = await hashOf();
    await externalFolder.write(hash, new Blob([bytes]));
    dir.perm = "prompt";
    await externalFolder.use(dir);
    expect(externalFolder.state).toBe("needs-permission");
    expect(await externalFolder.read(hash, bytes.length)).toBeNull();
    dir.perm = "granted";
    await externalFolder.reconnect();
    expect(externalFolder.state).toBe("ready");
    expect(await externalFolder.has(hash, bytes.length)).toBe(true);
  });

  it("in a workspace folder (desktop): readable names in the naming convention, numbered on a clash, only safe paths under library/", async () => {
    expect(safeBase("Hand Study (Loomis)")).toBe("hand_study-loomis");
    expect(safeBase("Sternocleidomastoid — Form, Figure Drawing")).toBe("sternocleidomastoid-form-figure_drawing");
    expect(safeBase('a<b>c:d"e/f\\g|h?i*j')).toBe("abc-defg-hij"); // (":" and "|" separate parts; the rest of what systems forbid is dropped)
    expect(safeBase("  ..hidden  ")).toBe("hidden");
    expect(safeBase("CON")).toBe("con_file");
    expect(safeBase("???")).toBe("file");
    expect(safeBase("x".repeat(300)).length).toBe(100);
    const taken = new Set(["library/images/ref.png", "library/images/ref-2.png"]);
    expect(await libraryPath("Ref.PNG", "image/png", async (p) => taken.has(p))).toBe("library/images/ref-3.png");
    expect(await libraryPath("Inter Regular", "font/woff2", async () => false)).toBe("library/fonts/inter_regular.woff2");
    expect(await libraryPath("notes.txt", "text/plain", async () => false)).toBe("library/documents/notes.txt");
    for (const bad of ["", "/etc/passwd", "library/../x", "library//x", "library/./x", "a\\b", "a\0b"]) expect(isSafeRelativePath(bad)).toBe(false);

    const hash = await hashOf();
    externalFolder.naming = WORKSPACE_NAMING;
    try {
      const file = await externalFolder.fileFor(hash, "Hand Study.png", "image/png");
      expect(file).toBe("library/images/hand_study.png");
      await externalFolder.write(hash, new Blob([bytes]), file);
      expect(await externalFolder.read(hash, bytes.length, "image/png", file)).not.toBeNull();
      expect(await externalFolder.fileFor(hash, "Hand Study.png", "image/png")).toBe("library/images/hand_study-2.png");
      await expect(externalFolder.write(hash, new Blob([bytes]), "../x.png")).rejects.toThrow(/not available/);
      await expect(externalFolder.write(hash, new Blob([bytes]), ".canvast/x.png")).rejects.toThrow(/not available/); // not under library/
    } finally {
      externalFolder.naming = HASH_NAMING;
    }
  });

  it("boards are folders of .canvast/boards/ and canvases .cvst files by their safe names: unique per level without case", () => {
    const c = (id: string, name: string) => ({ id, name });
    const placed = placeTree([
      { id: "b1", name: "Sketches", canvases: [c("c1", "Characters"), c("c2", "characters"), c("c3", "")] },
      { id: "b2", name: "sketches", canvases: [c("c4", "Characters")] },
      { id: "b3", name: "Library", canvases: [] },
    ]);
    expect(placed.map((b) => b.folder)).toEqual([".canvast/boards/sketches", ".canvast/boards/sketches-2", ".canvast/boards/library"]);
    expect(placed[0]!.canvases.map((x) => x.file)).toEqual([".canvast/boards/sketches/characters.cvst", ".canvast/boards/sketches/characters-2.cvst", ".canvast/boards/sketches/file.cvst"]);
    expect(placed[1]!.canvases[0]!.file).toBe(".canvast/boards/sketches-2/characters.cvst");
    expect(placeTree([{ id: "b", name: ".canvast", canvases: [] }])[0]!.folder).toBe(".canvast/boards/canvast"); // (no leading dot: safeBase drops it)
  });

  it("a library item's place: its folder path by safe names (else its kind folder), and a numbered file still fits its name", () => {
    expect(libraryDir(["Refs", "Hands?"], "image/png", "x.png")).toBe("library/refs/hands");
    expect(libraryDir([], "image/png", "x.png")).toBe("library/images");
    expect(libraryDir(["Images"], "video/mp4", "x.mp4")).toBe("library/images"); // (a folder named like a kind folder shares it)
    expect(libraryDir(Array(40).fill("a long folder name here"), "image/png", "x.png")).toBe("library/images"); // too deep: by kind
    expect(fitsPlace("library/images/hand.png", "library/images", "hand", "png")).toBe(true);
    expect(fitsPlace("library/images/hand-2.png", "library/images", "hand", "png")).toBe(true);
    expect(fitsPlace("library/images/hand-1.png", "library/images", "hand", "png")).toBe(false);
    expect(fitsPlace("library/images/hand-loomis.png", "library/images", "hand", "png")).toBe(false);
    expect(fitsPlace("library/refs/hand.png", "library/images", "hand", "png")).toBe(false);
    expect(fitsPlace("library/images/hand.jpg", "library/images", "hand", "png")).toBe(false);
  });

  it("library.json items: read back the same as written, damaged ones and bad paths refused", () => {
    const e: CatalogEntry = { hash: "a".repeat(64), name: "Hand (Loomis).png", type: "image/png", size: 10, pixelW: 3, pixelH: 2, importedAt: 5, state: "active", deletedAt: null, tags: ["hands"], favorite: true, folderIds: ["f1"], note: "n", fields: [{ key: "by", value: "L" }] };
    const item = itemOf(e, { hash: e.hash, type: e.type, size: 10, name: e.name, pixelW: 3, pixelH: 2, blob: new Blob([]), importedAt: 5, ext: 1, file: "library/refs/hand-loomis.png", duration: 2 });
    const text = libraryJsonText([{ id: "f1", name: "Refs", parentId: null }], [item]);
    const back = JSON.parse(text) as { format: string; items: unknown[] };
    expect(back.format).toBe("canvast-library");
    expect(JSON.stringify(readItem(back.items[0]))).toBe(JSON.stringify(item));
    expect(readItem({ ...item, hash: "x" })).toBeNull();
    expect(readItem({ ...item, file: "../outside.png" })!.file).toBeNull();
    expect(readItem({ ...item, file: ".canvast/workspace.json" })!.file).toBeNull();
    expect(readItem({ ...item, tags: Array(200).fill("t").map((t, i) => t + i) })).toBeNull();
  });
});
