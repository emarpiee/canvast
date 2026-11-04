import { describe, expect, it } from "vitest";
import { artPicture, isArtFile, psdPixels } from "../../src/assets/art-preview";
import { writeZip } from "../../src/storage/zip";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const zipOf = async (entries: Record<string, Uint8Array>): Promise<Blob> => {
  const made = await writeZip(Object.entries(entries).map(([name, data]) => ({ name, data: new Blob([data as BlobPart]) })) as never);
  return made as unknown as Blob;
};
const bytes = async (b: Blob | null): Promise<number[] | null> => (b ? [...new Uint8Array(await b.arrayBuffer())] : null);

function psd(opts: { w: number; h: number; channels: number; depth?: number; mode?: number; thumb?: Uint8Array; rle?: boolean; pixels: number[] }): Blob {
  const parts: number[] = [];
  const u16 = (n: number) => parts.push((n >> 8) & 255, n & 255);
  const u32 = (n: number) => parts.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  parts.push(0x38, 0x42, 0x50, 0x53);
  u16(1);
  parts.push(0, 0, 0, 0, 0, 0);
  u16(opts.channels);
  u32(opts.h);
  u32(opts.w);
  u16(opts.depth ?? 8);
  u16(opts.mode ?? 3);
  u32(0);
  const res: number[] = [];
  if (opts.thumb) {
    res.push(0x38, 0x42, 0x49, 0x4d, 0x04, 0x0c, 0, 0);
    const size = 28 + opts.thumb.length;
    res.push((size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...new Array<number>(28).fill(0), ...opts.thumb);
    if (size % 2) res.push(0);
  }
  u32(res.length);
  parts.push(...res);
  u32(0);
  u16(opts.rle ? 1 : 0);
  if (opts.rle) {
    for (let i = 0; i < opts.h * opts.channels; i++) u16(2);
    for (let i = 0; i < opts.h * opts.channels; i++) parts.push(opts.w - 1, ...opts.pixels.slice(i * opts.w, (i + 1) * opts.w));
  } else parts.push(...opts.pixels);
  return new Blob([new Uint8Array(parts)]);
}

/** A database as Clip Studio keeps one: one row on a leaf page, the rest on an overflow page. */
function clip(png: Uint8Array, pageSize = 512): Blob {
  const db = new Uint8Array(pageSize * 3);
  db.set(new TextEncoder().encode("SQLite format 3\0"));
  db[16] = pageSize >> 8;
  db[17] = pageSize & 255;
  const payload = new Uint8Array(3000);
  payload.set(png, 5);
  const usable = pageSize;
  const least = Math.floor(((usable - 12) * 32) / 255) - 23;
  let local = least + ((payload.length - least) % (usable - 4));
  if (local > usable - 35) local = least;
  const page = pageSize;
  db[page] = 13;
  db[page + 3] = 0;
  db[page + 4] = 1;
  const cell = page + 20;
  db[page + 8] = 0;
  db[page + 9] = 20;
  db[cell] = 0x80 | (payload.length >> 7);
  db[cell + 1] = payload.length & 127;
  db[cell + 2] = 1;
  db.set(payload.subarray(0, local), cell + 3);
  // (a chain of overflow pages, grown as needed)
  const left = payload.length - local;
  const pages = Math.ceil(left / (usable - 4));
  const full = new Uint8Array(pageSize * (2 + pages));
  full.set(db.subarray(0, pageSize * 2));
  const fv = new DataView(full.buffer);
  fv.setUint32(cell + 3 + local, 3);
  let at = local;
  for (let i = 0; i < pages; i++) {
    const start = pageSize * (2 + i);
    fv.setUint32(start, i + 1 < pages ? 4 + i : 0);
    full.set(payload.subarray(at, at + usable - 4), start + 4);
    at += usable - 4;
  }
  const head = new Uint8Array(24);
  head.set(new TextEncoder().encode("CSFCHUNK"));
  const chunk = new Uint8Array(16);
  chunk.set(new TextEncoder().encode("CHNKSQLi"));
  new DataView(chunk.buffer).setBigUint64(8, BigInt(full.length));
  return new Blob([head, chunk, full]);
}

describe("pictures art files keep", () => {
  it("knows its kinds, by name", () => {
    for (const n of ["a.kra", "a.ORA", "a.psd", "a.psb", "a.procreate", "a.sketch", "a.fig", "a.figcraft", "a.clip"]) expect(isArtFile(n), n).toBe(true);
    for (const n of ["a.xcf", "a.ai", "a.png", "kra"]) expect(isArtFile(n), n).toBe(false);
  });
  it("ZIP kinds: the best picture there, nothing when there is none or it is no ZIP", async () => {
    const kra = await zipOf({ "maindoc.xml": new Uint8Array(3), "preview.png": new Uint8Array([9]), "mergedimage.png": PNG });
    expect(await bytes(await artPicture(kra, "a.kra"))).toEqual([...PNG]);
    expect(await bytes(await artPicture(await zipOf({ "preview.png": PNG }), "a.ora"))).toEqual([...PNG]);
    expect(await bytes(await artPicture(await zipOf({ "QuickLook/Thumbnail.png": PNG }), "a.procreate"))).toEqual([...PNG]);
    expect(await bytes(await artPicture(await zipOf({ "previews/preview.png": PNG }), "a.sketch"))).toEqual([...PNG]);
    expect(await bytes(await artPicture(await zipOf({ "thumbnail.png": PNG }), "a.fig"))).toEqual([...PNG]);
    expect(await bytes(await artPicture(await zipOf({ "thumbnail.png": PNG }), "a.figcraft"))).toEqual([...PNG]);
    expect(await artPicture(await zipOf({ "other.txt": PNG }), "a.kra")).toBeNull();
    expect(await artPicture(new Blob(["not a zip at all, whatever its name says"]), "a.kra")).toBeNull();
    expect(await artPicture(new Blob([]), "a.ora")).toBeNull();
  });
  it("a packed entry is unpacked; a corrupt one gives nothing", async () => {
    const packed = new Uint8Array(await new Response(new Blob([PNG]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const name = new TextEncoder().encode("mergedimage.png");
    const local = new Uint8Array(30 + name.length + packed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, PNG.length, true);
    cv.setUint16(28, name.length, true);
    central.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint32(12, central.length, true);
    ev.setUint32(16, local.length, true);
    expect(await bytes(await artPicture(new Blob([local, central, end]), "a.kra"))).toEqual([...PNG]);
    const broken = local.slice();
    broken.fill(0xff, 30 + name.length);
    expect(await artPicture(new Blob([broken, central, end]), "a.kra")).toBeNull();
  });
  it("Photoshop: its thumbnail; its merged pixels, raw and packed; none for what it cannot read", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
    const flat = { w: 1, h: 2, channels: 3, pixels: [10, 20, 30, 40, 50, 60] };
    expect(await bytes(await artPicture(psd({ ...flat, thumb: jpeg }), "a.psd"))).toEqual([...jpeg]);
    expect(await artPicture(psd(flat), "a.psd")).toBeNull();
    expect([...(await psdPixels(psd(flat)))!.rgba]).toEqual([10, 30, 50, 255, 20, 40, 60, 255]);
    expect([...(await psdPixels(psd({ ...flat, rle: true })))!.rgba]).toEqual([10, 30, 50, 255, 20, 40, 60, 255]);
    expect(await psdPixels(psd({ ...flat, depth: 16 }))).toBeNull();
    expect(await psdPixels(psd({ ...flat, mode: 4 }))).toBeNull();
    expect(await psdPixels(psd({ w: 99999, h: 99999, channels: 3, pixels: [] }))).toBeNull();
    expect(await psdPixels(psd({ w: 4, h: 4, channels: 3, pixels: [1, 2] }))).toBeNull();
    expect(await psdPixels(new Blob(["8BPS"]))).toBeNull();
    expect(await artPicture(new Blob(["no"]), "a.psd")).toBeNull();
  });
  it("Photoshop: past the most pixels it is reduced as it is read, each pixel the average of what it stands for; a short file gives nothing", async () => {
    // (4 x 3, three planes; kept at 2 x 2: scale 2, the last row of blocks only one row tall)
    const r = [10, 30, 50, 70, 10, 30, 50, 70, 100, 100, 200, 200];
    const pixels = [...r, ...r.map((v) => v + 1), ...r.map((v) => v + 2)];
    const got = await psdPixels(psd({ w: 4, h: 3, channels: 3, pixels }), 3);
    expect([got!.w, got!.h]).toEqual([2, 2]);
    expect([...got!.rgba]).toEqual([20, 21, 22, 255, 60, 61, 62, 255, 100, 101, 102, 255, 200, 201, 202, 255]);
    expect(await psdPixels(psd({ w: 4, h: 3, channels: 3, rle: true, pixels }), 3)).toEqual(got);
    expect(await psdPixels(psd({ w: 4, h: 3, channels: 3, pixels: pixels.slice(0, -1) }), 3)).toBeNull();
  });

  it("a file read a part at a time, past what is held at once, gives the same; no read is bigger than a window", async () => {
    // (made up as it is asked for: 36 MB of rows, every other one light, three times what is held at once)
    const w = 2000;
    const h = 6000;
    const head = new Uint8Array(await psd({ w, h, channels: 3, pixels: [] }).arrayBuffer());
    const dataAt = head.length;
    const size = dataAt + w * h * 3;
    let most = 0;
    const file = {
      size,
      part: async (from: number, to: number): Promise<Uint8Array> => {
        most = Math.max(most, to - from);
        const out = new Uint8Array(Math.min(to, size) - from);
        for (let i = 0; i < out.length; i++) {
          const at = from + i;
          out[i] = at < dataAt ? head[at]! : Math.floor(((at - dataAt) % (w * h)) / w) % 2 ? 200 : 100;
        }
        return out;
      },
    };
    const got = await psdPixels(file, 1_000_000);
    expect(most).toBeLessThanOrEqual(16 * 2 ** 20);
    expect([got!.w, got!.h]).toEqual([500, 1500]);
    expect([...got!.rgba.subarray(-4)]).toEqual([150, 150, 150, 255]); // (4 rows, of 100 and 200)
  });

  it("ZIP: one entry too big gives way to the next, and a ZIP64 file is read", async () => {
    // (a directory that says mergedimage.png unpacks past the limit; preview.png is there too)
    const name = new TextEncoder().encode("preview.png");
    const big = new TextEncoder().encode("mergedimage.png");
    const local = new Uint8Array(30 + name.length + PNG.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(PNG, 30 + name.length);
    const entry = (n: Uint8Array, usize: number, csize: number, at: number, extra = new Uint8Array(0)): Uint8Array => {
      const e = new Uint8Array(46 + n.length + extra.length);
      const v = new DataView(e.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint32(20, csize, true);
      v.setUint32(24, usize, true);
      v.setUint16(28, n.length, true);
      v.setUint16(30, extra.length, true);
      v.setUint32(42, at, true);
      e.set(n, 46);
      e.set(extra, 46 + n.length);
      return e;
    };
    const dir = new Blob([entry(big, 2 ** 30, 2 ** 30, 0), entry(name, PNG.length, PNG.length, 0)] as BlobPart[]);
    const end = (size: number, at: number): Uint8Array => {
      const e = new Uint8Array(22);
      const v = new DataView(e.buffer);
      v.setUint32(0, 0x06054b50, true);
      v.setUint32(12, size, true);
      v.setUint32(16, at, true);
      return e;
    };
    expect(await bytes(await artPicture(new Blob([local, dir, end(dir.size, local.length)] as BlobPart[]), "a.kra"))).toEqual([...PNG]);
    // (ZIP64: the real numbers in the extra field, and a second end record that a locator points to)
    const extra = new Uint8Array(28);
    const xv = new DataView(extra.buffer);
    xv.setUint16(0, 1, true);
    xv.setUint16(2, 24, true);
    xv.setBigUint64(4, BigInt(PNG.length), true);
    xv.setBigUint64(12, BigInt(PNG.length), true);
    const dir64 = new Blob([entry(name, 0xffffffff, 0xffffffff, 0xffffffff, extra)] as BlobPart[]);
    const end64 = new Uint8Array(56);
    const e64 = new DataView(end64.buffer);
    e64.setUint32(0, 0x06064b50, true);
    e64.setBigUint64(40, BigInt(dir64.size), true);
    e64.setBigUint64(48, BigInt(local.length), true);
    const locator = new Uint8Array(20);
    const lo = new DataView(locator.buffer);
    lo.setUint32(0, 0x07064b50, true);
    lo.setBigUint64(8, BigInt(local.length + dir64.size), true);
    expect(await bytes(await artPicture(new Blob([local, dir64, end64, locator, end(0xffffffff, 0xffffffff)] as BlobPart[]), "a.kra"))).toEqual([...PNG]);
  });

  it("Clip Studio: the PNG in its database, across overflow pages; nothing for a damaged one", async () => {
    expect(await bytes(await artPicture(clip(PNG), "a.clip"))).toEqual([...PNG]);
    expect(await artPicture(new Blob(["CSFCHUNK but nothing of it"]), "a.clip")).toBeNull();
    const whole = new Uint8Array(await clip(PNG).arrayBuffer());
    expect(await artPicture(new Blob([whole.subarray(0, 40)]), "a.clip")).toBeNull();
  });
});
