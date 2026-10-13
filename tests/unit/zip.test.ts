import { describe, expect, it } from "vitest";
import { crc32 as zlibCrc32 } from "node:zlib";
import { ZipError, crc32, crc32Blob, readZip, verifyEntry, writeZip } from "../../src/storage/zip";
import { archiveFileName } from "../../src/storage/archive";
import { rng } from "./rng";

const bytes = (n: number, seed: number): Uint8Array<ArrayBuffer> => {
  const r = rng(seed);
  return Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
};

async function sample(): Promise<{ blob: Blob; a: Uint8Array<ArrayBuffer>; b: Uint8Array<ArrayBuffer> }> {
  const a = bytes(70_000, 1);
  const b = bytes(3, 2);
  const blob = await writeZip([
    { name: "manifest.json", data: new Blob(['{"ok":true}']) },
    { name: "assets/ä-ünïcode", data: new Blob([a]) },
    { name: "empty", data: new Blob([]) },
    { name: "b", data: new Blob([b]) },
  ]);
  return { blob, a, b };
}

/** Flip one byte of a Blob. */
async function patch(blob: Blob, at: number, value: (old: number) => number): Promise<Blob> {
  const u = new Uint8Array(await blob.arrayBuffer());
  u[at] = value(u[at]!);
  return new Blob([u]);
}

describe("crc32", () => {
  it("matches zlib for random data, in one piece and in chunks", async () => {
    for (const n of [0, 1, 7, 1000, 65_537]) {
      const d = bytes(n, n + 11);
      expect(crc32(d)).toBe(zlibCrc32(d));
      expect(crc32(d.subarray(n >> 1), crc32(d.subarray(0, n >> 1)))).toBe(zlibCrc32(d));
      expect(await crc32Blob(new Blob([d]))).toBe(zlibCrc32(d));
    }
  });
});

describe("zip", () => {
  it("round-trips names (UTF-8), sizes and bytes, and verifies every entry", async () => {
    const { blob, a, b } = await sample();
    const m = await readZip(blob);
    expect([...m.keys()]).toEqual(["manifest.json", "assets/ä-ünïcode", "empty", "b"]);
    expect(await m.get("manifest.json")!.data.text()).toBe('{"ok":true}');
    expect(new Uint8Array(await m.get("assets/ä-ünïcode")!.data.arrayBuffer())).toEqual(a);
    expect(new Uint8Array(await m.get("b")!.data.arrayBuffer())).toEqual(b);
    expect(m.get("empty")!.size).toBe(0);
    for (const e of m.values()) await verifyEntry(e);
  });

  it("detects a flipped data byte through the checksum", async () => {
    const { blob } = await sample();
    const m = await readZip(blob);
    const e = m.get("assets/ä-ünïcode")!;
    // Data of entry 2 starts after its local header; find it by content.
    const whole = new Uint8Array(await blob.arrayBuffer());
    const first = new Uint8Array(await e.data.slice(0, 16).arrayBuffer());
    const at = whole.findIndex((_, i) => first.every((v, k) => whole[i + k] === v)) + 5;
    const bad = await readZip(await patch(blob, at, (v) => v ^ 0xff));
    await expect(verifyEntry(bad.get("assets/ä-ünïcode")!)).rejects.toThrow(/checksum mismatch/);
    await verifyEntry(bad.get("b")!); // other entries are still intact
  });

  it("rejects non-archives, truncation, compressed and duplicate entries", async () => {
    await expect(readZip(new Blob(["hello"]))).rejects.toThrow(ZipError);
    await expect(readZip(new Blob([new Uint8Array(5000)]))).rejects.toThrow(/end-of-directory/);
    const { blob } = await sample();
    await expect(readZip(blob.slice(0, blob.size - 30))).rejects.toThrow(ZipError);
    // Central directory entry 1: method field at offset 10 → 8 (deflate).
    const u = new Uint8Array(await blob.arrayBuffer());
    const cd = u.findIndex((_, i) => u[i] === 0x50 && u[i + 1] === 0x4b && u[i + 2] === 1 && u[i + 3] === 2);
    await expect(readZip(await patch(blob, cd + 10, () => 8))).rejects.toThrow(/compressed/);
    const dup = await writeZip([
      { name: "x", data: new Blob(["1"]) },
      { name: "x", data: new Blob(["2"]) },
    ]);
    await expect(readZip(dup)).rejects.toThrow(/twice/);
  });

  it("rejects an entry whose size runs past the data", async () => {
    const { blob } = await sample();
    const u = new Uint8Array(await blob.arrayBuffer());
    const cd = u.findIndex((_, i) => u[i] === 0x50 && u[i + 1] === 0x4b && u[i + 2] === 1 && u[i + 3] === 2);
    // Grow entry 1's sizes (both fields) beyond the file.
    const v = new DataView(u.buffer);
    v.setUint32(cd + 20, 10_000_000, true);
    v.setUint32(cd + 24, 10_000_000, true);
    await expect(readZip(new Blob([u]))).rejects.toThrow(/past the end/);
  });
});

describe("archiveFileName", () => {
  it("keeps letters and digits in any script and replaces the rest", () => {
    const d = new Date(2026, 9, 13);
    expect(archiveFileName("My workspace", d)).toBe("My-workspace-2026-10-13.canvast");
    expect(archiveFileName("Board 1-Canvas 2", d)).toBe("Board-1-Canvas-2-2026-10-13.canvast");
    expect(archiveFileName("../../etc/passwd", d)).toBe("etc-passwd-2026-10-13.canvast");
    expect(archiveFileName("スケッチ", d)).toBe("スケッチ-2026-10-13.canvast");
    expect(archiveFileName("///", d)).toBe("canvast-2026-10-13.canvast");
  });
});
