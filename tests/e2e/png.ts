import { crc32, deflateSync } from "node:zlib";

/**
 * Minimal RGBA PNG encoder for deterministic test fixtures (no binary files
 * in the repository). `pixel(x, y)` returns [r, g, b, a].
 */
export function makePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 8×6 image of distinct coloured blocks: low resolution, so deep zoom shows pixels. */
export function blockyFixture(): Buffer {
  const palette: Array<[number, number, number, number]> = [
    [220, 60, 50, 255],
    [40, 140, 220, 255],
    [250, 200, 40, 255],
    [60, 170, 90, 255],
  ];
  return makePng(8, 6, (x, y) => palette[(x + y * 3) % palette.length]!);
}

/**
 * A Photoshop file: 8 bits, RGB, its merged picture stored as it is (`rgb` for every pixel), and with `thumbnail` (JPEG bytes) the small
 * picture it keeps for previews (image resource 1036).
 */
export function makePsd(w: number, h: number, rgb: readonly [number, number, number], thumbnail?: Uint8Array): Buffer {
  const head = Buffer.alloc(26);
  head.write("8BPS", 0, "latin1");
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(3, 12);
  head.writeUInt32BE(h, 14);
  head.writeUInt32BE(w, 18);
  head.writeUInt16BE(8, 22);
  head.writeUInt16BE(3, 24);
  let resources = Buffer.alloc(0);
  if (thumbnail) {
    const data = Buffer.concat([Buffer.alloc(28), Buffer.from(thumbnail)]);
    const block = Buffer.alloc(12);
    block.write("8BIM", 0, "latin1");
    block.writeUInt16BE(1036, 4); // (an empty name: two bytes)
    block.writeUInt32BE(data.length, 8);
    resources = Buffer.concat([block, data, Buffer.alloc(data.length % 2)]);
  }
  const len = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
  };
  const planes = Buffer.concat(rgb.map((c) => Buffer.alloc(w * h, c)));
  return Buffer.concat([head, len(0), len(resources.length), resources, len(0), Buffer.from([0, 0]), planes]);
}
