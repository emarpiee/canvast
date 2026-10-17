import { describe, expect, it } from "vitest";
import { ZipError, readZip, verifyEntry, writeZip } from "../../src/storage/zip";

const text = (s: string): Blob => new Blob([s]);

describe("ZIP64 (ADR 0115)", () => {
  it("a small archive is plain ZIP: no ZIP64 records", async () => {
    const z = await writeZip([{ name: "a.txt", data: text("hello") }]);
    const bytes = new Uint8Array(await z.arrayBuffer());
    const has = (sig: number): boolean => bytes.some((_, i) => i + 3 < bytes.length && bytes[i] === (sig & 255) && bytes[i + 1] === ((sig >> 8) & 255) && bytes[i + 2] === ((sig >> 16) & 255) && bytes[i + 3] === ((sig >>> 24) & 255));
    expect(has(0x06064b50)).toBe(false);
    expect((await readZip(z)).get("a.txt")!.size).toBe(5);
  });

  it("with ZIP64 records every entry reads back the same, names, sizes and bytes included", async () => {
    const z = await writeZip([{ name: "a.txt", data: text("hello") }, { name: "dir/b.bin", data: text("") }, { name: "日本.txt", data: text("x".repeat(70000)) }], new Date(), true);
    const dir = await readZip(z);
    expect([...dir.keys()]).toEqual(["a.txt", "dir/b.bin", "日本.txt"]);
    for (const e of dir.values()) await verifyEntry(e);
    expect(await dir.get("a.txt")!.data.text()).toBe("hello");
    expect(dir.get("日本.txt")!.size).toBe(70000);
  });

  it("more than 65,535 entries are written and read", async () => {
    const n = 66000;
    const entries = Array.from({ length: n }, (_, i) => ({ name: `f/${i}`, data: new Blob([]) }));
    const z = await writeZip(entries);
    const dir = await readZip(z);
    expect(dir.size).toBe(n);
    expect(dir.has("f/65999")).toBe(true);
  }, 120_000);

  it("a damaged ZIP64 locator or record is refused, never followed", async () => {
    const z = await writeZip([{ name: "a.txt", data: text("hi") }], new Date(), true);
    const bytes = new Uint8Array(await z.arrayBuffer());
    const broken = bytes.slice();
    broken[broken.length - 22 - 20] = 0; // (the locator's signature) // the locator's signature
    await expect(readZip(new Blob([broken]))).rejects.toBeInstanceOf(ZipError);
    const wild = bytes.slice();
    new DataView(wild.buffer).setBigUint64(wild.length - 22 - 20 + 8, 1n << 40n, true); // points far outside the file
    await expect(readZip(new Blob([wild]))).rejects.toBeInstanceOf(ZipError);
  });
});
