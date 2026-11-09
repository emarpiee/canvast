/**
 * Files too big to read into the page (past `MAX_IMPORT_BYTES`), in the desktop build: read a part at a time, written a part at a time, proven by
 * their SHA-256. `DiskFile` stands in for a Blob where only `size`, `slice`, `arrayBuffer`, `text` and `stream` are used; it is not one, so it can
 * never go into `new Blob([…])` (it refuses to become text) or into storage.
 */
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
/** How much is read or written at a time. */
export const WINDOW = 16 * 1024 * 1024;
/** Most of a DiskFile that may be asked for at once: past this something meant to go part by part is reading it whole. */
const MOST_AT_ONCE = 1024 * 1024 * 1024;

export class DiskFile {
  constructor(
    private readonly read: (from: number, to: number) => Promise<Uint8Array>,
    readonly size: number,
    readonly type = "",
    private readonly at = 0,
  ) {}

  slice(from = 0, to = this.size, type = ""): DiskFile {
    const a = Math.min(this.size, Math.max(0, from));
    const b = Math.min(this.size, Math.max(a, to));
    return new DiskFile(this.read, b - a, type, this.at + a);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.size > MOST_AT_ONCE) throw new Error("this file is too big to read whole");
    const out = new Uint8Array(this.size);
    for (let p = 0; p < this.size; ) {
      const part = await this.read(this.at + p, this.at + Math.min(this.size, p + WINDOW));
      if (!part.length) throw new Error("the file ended early");
      out.set(part, p);
      p += part.length;
    }
    return out.buffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    let p = 0;
    return new ReadableStream({
      pull: async (c) => {
        if (p >= this.size) return c.close();
        const part = await this.read(this.at + p, this.at + Math.min(this.size, p + WINDOW));
        if (!part.length) return c.error(new Error("the file ended early"));
        p += part.length;
        c.enqueue(part as Uint8Array<ArrayBuffer>);
      },
    });
  }

  toString(): string {
    throw new Error("a file on disk is not text: it cannot go into a Blob");
  }
}

export const isDisk = (b: unknown): b is DiskFile => b instanceof DiskFile;
/** A DiskFile where a Blob is asked for, by what it has of one. */
export const asBlob = (d: DiskFile): Blob => d as unknown as Blob;

/** Several parts as one, read as far as is asked: what a ZIP with a big file in it is. */
export function joined(parts: ReadonlyArray<Blob | DiskFile>, type = ""): DiskFile {
  const starts: number[] = [];
  let size = 0;
  for (const p of parts) (starts.push(size), (size += p.size));
  return new DiskFile(
    async (from, to) => {
      const out = new Uint8Array(to - from);
      for (let i = 0, put = 0; i < parts.length && put < out.length; i++) {
        const a = Math.max(from, starts[i]!);
        const b = Math.min(to, starts[i]! + parts[i]!.size);
        if (a >= b) continue;
        out.set(new Uint8Array(await parts[i]!.slice(a - starts[i]!, b - starts[i]!).arrayBuffer()), put);
        put += b - a;
      }
      return out;
    },
    size,
    type,
  );
}

/** Each part of a file in order, a window at a time. */
export async function eachPart(b: Blob | DiskFile, each: (bytes: Uint8Array<ArrayBuffer>) => void | Promise<void>): Promise<void> {
  const reader = (b.stream() as ReadableStream<Uint8Array<ArrayBuffer>>).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    await each(value);
  }
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 a part at a time (the browser's own takes one whole buffer). */
export class Sha256 {
  private readonly h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly w = new Int32Array(64);
  private readonly tail = new Uint8Array(64);
  private held = 0;
  private total = 0;

  private block(b: Uint8Array, at: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++, at += 4) w[i] = (b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!;
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      w[i] = (w[i - 16]! + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i - 7]! + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
    }
    const s = this.h;
    let a = s[0]!, c = s[2]!, d = s[3]!, e = s[4]!, f = s[5]!, g = s[6]!, h = s[7]!, bb = s[1]!;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    s[0] = (s[0]! + a) | 0;
    s[1] = (s[1]! + bb) | 0;
    s[2] = (s[2]! + c) | 0;
    s[3] = (s[3]! + d) | 0;
    s[4] = (s[4]! + e) | 0;
    s[5] = (s[5]! + f) | 0;
    s[6] = (s[6]! + g) | 0;
    s[7] = (s[7]! + h) | 0;
  }

  update(b: Uint8Array): void {
    this.total += b.length;
    let p = 0;
    if (this.held) {
      const take = Math.min(64 - this.held, b.length);
      this.tail.set(b.subarray(0, take), this.held);
      this.held += take;
      p = take;
      if (this.held < 64) return;
      this.block(this.tail, 0);
      this.held = 0;
    }
    for (; p + 64 <= b.length; p += 64) this.block(b, p);
    if (p < b.length) {
      this.tail.set(b.subarray(p), 0);
      this.held = b.length - p;
    }
  }

  hex(): string {
    const bits = this.total * 8;
    const pad = new Uint8Array((this.held < 56 ? 56 : 120) - this.held + 8);
    pad[0] = 0x80;
    const v = new DataView(pad.buffer);
    v.setUint32(pad.length - 8, Math.floor(bits / 2 ** 32));
    v.setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    return Array.from(this.h, (x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
}

/** A file's SHA-256, a window at a time. */
export async function hashOf(b: Blob | DiskFile): Promise<string> {
  const sha = new Sha256();
  await eachPart(b, (bytes) => sha.update(bytes));
  return sha.hex();
}

/** A write in progress (`DesktopBridge.stream`): to a temporary file beside its place; nothing is at its place until `commit`. */
export interface FileStream {
  append(id: string, bytes: Uint8Array): Promise<void>;
  /** The temporary file's bytes, as written. */
  read(id: string, from: number, to: number): Promise<Uint8Array>;
  /** Made sure on the disk, closed, and read back: its SHA-256 and size (`hashIt` false: its size only, for a caller that proves it itself). */
  finish(id: string, hashIt?: boolean): Promise<{ hash: string; size: number }>;
  /** Into its place. Answers where that is. Without `replace`, a file already there is an error and stays. */
  commit(id: string): Promise<string>;
  abort(id: string): Promise<void>;
}

/** Write a file into a stream that has begun: its SHA-256 as read from the disk afterwards, and it waits for commit or abort. */
export async function pipeInto(stream: FileStream, id: string, b: Blob | DiskFile): Promise<{ hash: string; size: number }> {
  try {
    await eachPart(b, (bytes) => stream.append(id, bytes));
    return await stream.finish(id);
  } catch (e) {
    await stream.abort(id).catch(() => undefined);
    throw e;
  }
}

/** Write a file, proven against `hash` when it is known, then put it in its place. Answers where. Whatever fails leaves nothing there. */
export async function writeProven(stream: FileStream, id: string, b: Blob | DiskFile, hash?: string): Promise<string> {
  const got = await pipeInto(stream, id, b);
  if (got.size !== b.size || (hash && got.hash !== hash)) {
    await stream.abort(id).catch(() => undefined);
    throw new Error("the file written did not read back the same");
  }
  return stream.commit(id);
}
