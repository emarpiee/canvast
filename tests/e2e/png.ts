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
