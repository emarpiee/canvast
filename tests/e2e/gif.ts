/** A small GIF encoder for fixtures (standard variable-width LZW, minimum code size 8), so tests carry no binary files. */
export interface GifFrameIn {
  /** Palette indices, row by row (picture order even when `interlaced`). */
  pixels: number[];
  w: number;
  h: number;
  x?: number;
  y?: number;
  /** In 1/100 s. */
  delay?: number;
  disposal?: number;
  transparent?: number;
  interlaced?: boolean;
}

export function encodeGif(width: number, height: number, palette: number[][], frames: GifFrameIn[]): Uint8Array {
  const out: number[] = [...Buffer.from("GIF89a")];
  const u16 = (v: number): void => void out.push(v & 255, v >> 8);
  u16(width);
  u16(height);
  out.push(0xf7, 0, 0); // global table of 256 colours
  for (let i = 0; i < 256; i++) out.push(...(palette[i] ?? [0, 0, 0]));
  out.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, ((f.disposal ?? 0) << 2) | (f.transparent !== undefined ? 1 : 0));
    u16(f.delay ?? 10);
    out.push(f.transparent ?? 0, 0);
    out.push(0x2c);
    u16(f.x ?? 0);
    u16(f.y ?? 0);
    u16(f.w);
    u16(f.h);
    out.push(f.interlaced ? 0x40 : 0);
    out.push(8);
    // Stored row order: interlaced files list rows 0/8, 4/8, 2/4, 1/2.
    const rows = [...Array(f.h).keys()];
    const order = f.interlaced ? [[0, 8], [4, 8], [2, 4], [1, 2]].flatMap(([s, st]) => rows.filter((r) => r >= s! && (r - s!) % st! === 0)) : rows;
    const px = order.flatMap((r) => f.pixels.slice(r * f.w, (r + 1) * f.w));
    const bytes = lzw(px);
    for (let i = 0; i < bytes.length; i += 255) out.push(Math.min(255, bytes.length - i), ...bytes.slice(i, i + 255));
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

/** Standard GIF LZW: codes grow from 9 to 12 bits, the table is cleared when full. */
function lzw(px: number[]): number[] {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  let size = 9;
  const put = (code: number): void => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(acc & 255);
      acc >>= 8;
      bits -= 8;
    }
  };
  let table = new Map<string, number>();
  let next = 258;
  put(256);
  let cur = "";
  for (const v of px) {
    const k = cur + String.fromCharCode(v);
    if (k.length === 1 || table.has(k)) {
      cur = k;
      continue;
    }
    put(cur.length === 1 ? cur.charCodeAt(0) : table.get(cur)!);
    table.set(k, next++);
    if (next - 1 === 1 << size && size < 12) size++; // the entry just added needs one more bit from the next code on
    if (next === 4096) {
      put(256);
      table = new Map();
      next = 258;
      size = 9;
    }
    cur = String.fromCharCode(v);
  }
  if (cur) put(cur.length === 1 ? cur.charCodeAt(0) : table.get(cur)!);
  put(257);
  if (bits) bytes.push(acc & 255);
  return bytes;
}
