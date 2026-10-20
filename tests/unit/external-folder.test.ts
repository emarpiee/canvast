import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/assets/sha256";
import { externalFolder } from "../../src/storage/external-folder";
import type { Dir } from "../../src/storage/external-folder";

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
});
