/**
 * An animated GIF decoder with frame-index access (ADR 0042): `<img>` cannot step or seek by frame. The file is
 * indexed once (sizes, delays, disposal, where each frame's data is); a frame is decoded and composed on demand,
 * and stepping forward costs one frame. Pure (bytes in, RGBA out), so it runs in tests without a browser.
 */
export interface GifFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Seconds this frame is shown (a delay of 0 or 1/100 s is shown for 0.1 s, as browsers do). */
  delay: number;
  /** 0 or 1: leave; 2: clear to transparent; 3: restore what was there before. */
  disposal: number;
  transparent: number;
  interlaced: boolean;
  palette: Uint8Array;
  /** Offset of the LZW minimum code size byte. */
  data: number;
}

export class GifError extends Error {}

export class GifFrames {
  readonly width: number;
  readonly height: number;
  readonly frames: GifFrame[] = [];
  private readonly canvas: Uint8ClampedArray;
  private saved: Uint8ClampedArray | null = null;
  private at = -1;

  constructor(private readonly bytes: Uint8Array) {
    const b = bytes;
    if (b.length < 13 || String.fromCharCode(...b.subarray(0, 3)) !== "GIF") throw new GifError("not a GIF");
    const u16 = (o: number): number => b[o]! | (b[o + 1]! << 8);
    this.width = u16(6);
    this.height = u16(8);
    if (!this.width || !this.height || this.width * this.height > 2 ** 26) throw new GifError("bad GIF size");
    this.canvas = new Uint8ClampedArray(this.width * this.height * 4);
    let p = 13;
    let global: Uint8Array = new Uint8Array(0);
    if (b[10]! & 0x80) {
      const n = 3 << ((b[10]! & 7) + 1);
      global = b.subarray(p, p + n);
      p += n;
    }
    let gc = { delay: 0.1, disposal: 0, transparent: -1 };
    const skip = (): void => {
      while (p < b.length && b[p]! !== 0) p += b[p]! + 1;
      p++;
    };
    while (p < b.length && b[p] !== 0x3b) {
      if (b[p] === 0x21) {
        const label = b[p + 1];
        if (label === 0xf9 && b[p + 2] === 4) {
          const f = b[p + 3]!;
          const d = u16(p + 4);
          gc = { delay: d <= 1 ? 0.1 : d / 100, disposal: (f >> 2) & 7, transparent: f & 1 ? b[p + 6]! : -1 };
        }
        p += 2;
        skip();
      } else if (b[p] === 0x2c) {
        const x = u16(p + 1);
        const y = u16(p + 3);
        const w = u16(p + 5);
        const h = u16(p + 7);
        const f = b[p + 9]!;
        p += 10;
        let palette: Uint8Array = global;
        if (f & 0x80) {
          const n = 3 << ((f & 7) + 1);
          palette = b.subarray(p, p + n);
          p += n;
        }
        if (!w || !h || x + w > this.width || y + h > this.height || !palette.length) throw new GifError("bad GIF frame");
        this.frames.push({ x, y, w, h, ...gc, interlaced: !!(f & 0x40), palette, data: p });
        gc = { delay: 0.1, disposal: 0, transparent: -1 };
        p++; // minimum code size
        skip();
      } else throw new GifError("bad GIF block");
    }
    if (!this.frames.length) throw new GifError("GIF without frames");
  }

  get count(): number {
    return this.frames.length;
  }

  /** Total length in seconds. */
  get duration(): number {
    return this.frames.reduce((a, f) => a + f.delay, 0);
  }

  /** The composed picture after frame `i` (RGBA, straight alpha); a fresh copy. */
  frame(i: number): Uint8ClampedArray<ArrayBuffer> {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) throw new RangeError(`no frame ${i}`);
    if (i < this.at) {
      this.canvas.fill(0);
      this.saved = null;
      this.at = -1;
    }
    while (this.at < i) this.advance();
    return new Uint8ClampedArray(this.canvas);
  }

  private advance(): void {
    const W = this.width;
    const prev = this.frames[this.at];
    if (prev) {
      if (prev.disposal === 3 && this.saved) this.canvas.set(this.saved);
      else if (prev.disposal === 2) this.clear(prev);
    }
    const f = this.frames[this.at + 1]!;
    this.saved = f.disposal === 3 ? this.canvas.slice() : null;
    const idx = this.indices(f);
    let k = 0;
    for (let row = 0; row < f.h; row++) {
      const y = f.y + this.rowOf(f, row);
      for (let col = 0; col < f.w; col++, k++) {
        const c = idx[k]!;
        if (c === f.transparent) continue;
        const o = (y * W + f.x + col) * 4;
        this.canvas[o] = f.palette[c * 3]!;
        this.canvas[o + 1] = f.palette[c * 3 + 1]!;
        this.canvas[o + 2] = f.palette[c * 3 + 2]!;
        this.canvas[o + 3] = 255;
      }
    }
    this.at++;
  }

  private clear(f: GifFrame): void {
    for (let row = 0; row < f.h; row++) this.canvas.fill(0, ((f.y + row) * this.width + f.x) * 4, ((f.y + row) * this.width + f.x + f.w) * 4);
  }

  /** The picture row a stored row `r` belongs to (GIF interlacing: rows 0/8, 4/8, 2/4, 1/2 in four passes). */
  private rowOf(f: GifFrame, r: number): number {
    if (!f.interlaced) return r;
    const passes = [[0, 8], [4, 8], [2, 4], [1, 2]] as const;
    for (const [start, step] of passes) {
      const n = f.h > start ? Math.ceil((f.h - start) / step) : 0;
      if (r < n) return start + r * step;
      r -= n;
    }
    return r;
  }

  /** The palette indices of a frame (LZW, variable code size). */
  private indices(f: GifFrame): Uint8Array {
    const b = this.bytes;
    let p = f.data;
    const min = b[p++]!;
    if (min < 2 || min > 8) throw new GifError("bad LZW code size");
    const data: number[] = [];
    while (p < b.length && b[p] !== 0) {
      for (let i = 1; i <= b[p]!; i++) data.push(b[p + i]!);
      p += b[p]! + 1;
    }
    const out = new Uint8Array(f.w * f.h);
    const clear = 1 << min;
    const end = clear + 1;
    const prefix = new Int16Array(4096);
    const suffix = new Uint8Array(4096);
    const stack = new Uint8Array(4097);
    let size = min + 1;
    let next = end + 1;
    let prev = -1;
    let first = 0;
    let acc = 0;
    let bits = 0;
    let o = 0;
    let di = 0;
    for (let i = 0; i < clear; i++) suffix[i] = i;
    while (o < out.length) {
      while (bits < size && di < data.length) {
        acc |= data[di++]! << bits;
        bits += 8;
      }
      if (bits < size) break;
      let code = acc & ((1 << size) - 1);
      acc >>= size;
      bits -= size;
      if (code === clear) {
        size = min + 1;
        next = end + 1;
        prev = -1;
        continue;
      }
      if (code === end) break;
      if (prev === -1) {
        out[o++] = suffix[code]!;
        prev = code;
        first = code;
        continue;
      }
      const incoming = code;
      let sp = 0;
      if (code >= next) {
        stack[sp++] = first;
        code = prev;
      }
      while (code >= clear) {
        stack[sp++] = suffix[code]!;
        code = prefix[code]!;
      }
      first = suffix[code]!;
      stack[sp++] = first;
      if (next < 4096) {
        prefix[next] = prev;
        suffix[next] = first;
        next++;
        if ((next & (next - 1)) === 0 && next < 4096) size++;
      }
      prev = incoming;
      while (sp > 0 && o < out.length) out[o++] = stack[--sp]!;
    }
    return out;
  }
}
