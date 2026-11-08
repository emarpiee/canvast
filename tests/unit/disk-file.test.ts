import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/assets/sha256";
import { DiskFile, Sha256, asBlob, hashOf, joined, writeProven, type FileStream } from "../../src/storage/disk-file";
import { FILE_CHUNK, chunkDigests, openFile, openFileAt, sameChunks, sealFile, sealFileTo } from "../../src/storage/hidden-vault";
import { readZip, verifyEntry, writeZip } from "../../src/storage/zip";

const bytesOf = (n: number, seed = 7): Uint8Array<ArrayBuffer> => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed + (i >> 8)) & 255);
const onDisk = (b: Uint8Array): DiskFile => new DiskFile(async (from, to) => b.slice(from, to), b.length);
const key = (): Promise<CryptoKey> => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const sealedTo = async (k: CryptoKey, src: Uint8Array, item: object, chunk?: number): Promise<Uint8Array<ArrayBuffer>> => {
  const parts: Uint8Array[] = [];
  await sealFileTo(k, onDisk(src), item, async (b) => void parts.push(b), chunk);
  return new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
};

describe("a file too big for the page", () => {
  it("SHA-256 a part at a time is the browser's, however it is cut", async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const b = bytesOf(n);
      const want = await sha256Hex(b.slice().buffer);
      const whole = new Sha256();
      whole.update(b);
      expect(whole.hex(), `${n}`).toBe(want);
      const cut = new Sha256();
      for (let p = 0, step = 1; p < n; p += step, step = (step * 3) % 97 || 1) cut.update(b.subarray(p, p + step));
      expect(cut.hex(), `${n} cut`).toBe(want);
    }
    expect(await hashOf(onDisk(bytesOf(70_000)))).toBe(await sha256Hex(bytesOf(70_000).buffer));
  });

  it("a sealed copy is proven chunk by chunk against what was sealed (the platform's SHA-256), and one changed byte fails it", async () => {
    const k = await key();
    for (const [n, chunk] of [[0, 1024], [1, 1024], [1024, 1024], [1025, 1024], [5000, 1024], [70_000, 4096]] as const) {
      const src = bytesOf(n, n);
      const digests = chunkDigests();
      const parts: Uint8Array[] = [];
      await sealFileTo(k, onDisk(src), { hash: "x" }, async (b) => void parts.push(b), chunk, digests.seen);
      const sealed = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
      const opened = (await openFileAt(k, onDisk(sealed)))!;
      const all = await digests.all();
      expect(await sameChunks(opened.file, all, chunk), `${n}`).toBe(true);
      // (what was sealed, read from another source of the same length but one byte off: not the same)
      if (n) {
        const other = src.slice();
        other[Math.floor(n / 2)]! ^= 1;
        expect(await sameChunks(onDisk(other), all, chunk), `${n} changed`).toBe(false);
      }
      expect(await sameChunks(onDisk(src.slice(0, Math.max(0, n - chunk))), all, chunk), `${n} short`).toBe(n === 0);
    }
  });

  it("stands in for a Blob, and refuses to become one", async () => {
    const b = bytesOf(1000);
    const f = onDisk(b);
    expect([...new Uint8Array(await f.slice(10, 20).slice(2, 5).arrayBuffer())]).toEqual([...b.subarray(12, 15)]);
    expect(f.slice(990, 5000).size).toBe(10);
    expect(() => new Blob([f as unknown as BlobPart])).toThrow();
    const short = new DiskFile(async () => new Uint8Array(0), 10);
    await expect(short.arrayBuffer()).rejects.toThrow();
  });

  it("a ZIP with one in it holds the same bytes, is read back and checked, and tells a changed byte", async () => {
    const big = bytesOf(70_000);
    const zip = await writeZip([{ name: "a.txt", data: new Blob(["hello"]) }, { name: "big.bin", data: asBlob(onDisk(big)) }, { name: "z.txt", data: new Blob(["end"]) }]);
    expect(zip instanceof Blob).toBe(false);
    const same = await writeZip([{ name: "a.txt", data: new Blob(["hello"]) }, { name: "big.bin", data: new Blob([big]) }, { name: "z.txt", data: new Blob(["end"]) }], new Date(0));
    expect(zip.size).toBe(same.size);
    const entries = await readZip(zip);
    for (const e of entries.values()) await verifyEntry(e);
    expect(await hashOf(entries.get("big.bin")!.data)).toBe(await sha256Hex(big.slice().buffer));
    expect(await entries.get("z.txt")!.data.text()).toBe("end");
    const bad = big.slice();
    bad[40_000] = bad[40_000]! ^ 1;
    const changed = await writeZip([{ name: "big.bin", data: asBlob(onDisk(big)) }]);
    const raw = new Uint8Array(await changed.slice(0, changed.size).arrayBuffer());
    raw[raw.indexOf(big[0]!, 40) + 40_000]! ^= 1;
    await expect(verifyEntry((await readZip(new Blob([raw]))).get("big.bin")!)).rejects.toThrow();
    expect((await joined([new Blob(["ab"]), new Blob(["cd"])]).slice(1, 3).text())).toBe("bc");
  });

  it("sealed a part at a time it is the same kind of file: each way opens the other's, whatever the size", async () => {
    const k = await key();
    const chunk = 1024;
    for (const n of [0, 1, chunk - 1, chunk, chunk + 1, chunk * 3, chunk * 20 + 7]) {
      const plain = bytesOf(n);
      const streamed = await sealedTo(k, plain, { hash: "x" }, chunk);
      const opened = await openFile(k, streamed);
      expect(opened?.item, `${n}`).toEqual({ hash: "x" });
      expect(opened!.bytes.length).toBe(n);
      expect(await sha256Hex(opened!.bytes.slice().buffer)).toBe(await sha256Hex(plain.slice().buffer));
      const at = await openFileAt(k, onDisk(await sealFile(k, plain, { hash: "y" }, chunk)));
      expect(at?.item).toEqual({ hash: "y" });
      expect(at!.file.size).toBe(n);
      expect(await hashOf(at!.file)).toBe(await sha256Hex(plain.slice().buffer));
    }
    // (more than a window of chunks at a time, across a real chunk size)
    const large = bytesOf(FILE_CHUNK * 3 + 11);
    const atLarge = await openFileAt(k, onDisk(await sealedTo(k, large, {})));
    expect(await hashOf(atLarge!.file)).toBe(await sha256Hex(large.slice().buffer));
  });

  it("opened where it lies, any range reads right, and a cut, changed or swapped file fails rather than gives wrong bytes", async () => {
    const k = await key();
    const chunk = 1024;
    const plain = bytesOf(chunk * 5 + 100);
    const sealed = await sealedTo(k, plain, {}, chunk);
    const at = (await openFileAt(k, onDisk(sealed)))!;
    for (const [a, b] of [[0, 1], [1000, 1050], [chunk, chunk * 2], [chunk * 2 - 1, chunk * 4 + 1], [chunk * 5 + 99, chunk * 5 + 100]] as const) {
      expect([...new Uint8Array(await at.file.slice(a, b).arrayBuffer())], `${a}-${b}`).toEqual([...plain.subarray(a, b)]);
    }
    expect(await openFileAt(await key(), onDisk(sealed))).toBeNull();
    // (cut at a chunk: the new last chunk was not sealed as the last)
    const whole = chunk + 16;
    const start = sealed.length - (plain.length + 6 * 16);
    const cut = (await openFileAt(k, onDisk(sealed.slice(0, start + whole * 3))))!;
    await expect(hashOf(cut.file)).rejects.toThrow();
    const changed = sealed.slice();
    changed[start + whole + 5]! ^= 1;
    await expect(hashOf((await openFileAt(k, onDisk(changed)))!.file)).rejects.toThrow();
    const swapped = sealed.slice();
    swapped.set(sealed.subarray(start, start + whole), start + whole);
    swapped.set(sealed.subarray(start + whole, start + whole * 2), start);
    await expect(hashOf((await openFileAt(k, onDisk(swapped)))!.file)).rejects.toThrow();
  });

  it("a write that does not read back the same never reaches its place", async () => {
    const calls: string[] = [];
    const stream: FileStream = {
      append: async () => void calls.push("append"),
      read: async () => new Uint8Array(0),
      finish: async () => ({ hash: "wrong", size: 5 }),
      commit: async () => (calls.push("commit"), "there"),
      abort: async () => void calls.push("abort"),
    };
    await expect(writeProven(stream, "id", new Blob(["hello"]), "right")).rejects.toThrow();
    expect(calls).toEqual(["append", "abort"]);
    expect(await writeProven(stream, "id", new Blob(["hello"]), "wrong")).toBe("there");
    expect(calls.at(-1)).toBe("commit");
  });
});
