import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/assets/sha256";
import { externalFolder, folderFileName } from "../../src/storage/external-folder";
import type { Dir } from "../../src/storage/external-folder";
import { HASH_NAMING } from "../../src/storage/external-folder";
import { WORKSPACE_NAMING, isSafeRelativePath, libraryPath, safeBase } from "../../src/storage/workspace-names";

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
});
