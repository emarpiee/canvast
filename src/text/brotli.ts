/**
 * A Brotli decoder (RFC 7932), so a WOFF2 font opens in any browser: not every browser's `DecompressionStream` knows "brotli". It reads
 * the whole stream at once into one buffer. The static dictionary (data in brotli-data.ts) is unpacked with the browser's `deflate` the
 * first time a stream is decoded.
 */
import { CONTEXT_LOOKUP, DICTIONARY_DEFLATED, TRANSFORMS } from "./brotli-data";

export class BrotliError extends Error {}
const bad = (what = "damaged"): never => {
  throw new BrotliError(`The compressed data is ${what}.`);
};

const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const CONTEXT = b64(CONTEXT_LOOKUP);

let dictionary: Uint8Array | null = null;
/** Unpack the static dictionary (once). */
export async function loadDictionary(): Promise<void> {
  if (dictionary) return;
  const z = b64(DICTIONARY_DEFLATED);
  dictionary = new Uint8Array(await new Response(new Blob([z as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  if (dictionary.length !== 122784) bad("the dictionary");
}
/** Use an already unpacked dictionary (tests that have no `DecompressionStream`). */
export const setDictionary = (d: Uint8Array): void => {
  dictionary = d;
};

class Bits {
  p = 0;
  bit = 0;
  constructor(readonly b: Uint8Array) {}
  readBit(): number {
    if (this.p >= this.b.length) bad("cut short");
    const v = (this.b[this.p]! >> this.bit) & 1;
    if (++this.bit === 8) {
      this.bit = 0;
      this.p++;
    }
    return v;
  }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v |= this.readBit() << i;
    return v >>> 0;
  }
  /** The next `n` bits without taking them (the ones beyond the end read as 0). */
  peek(n: number): number {
    const p = this.p, bit = this.bit;
    let v = 0;
    for (let i = 0; i < n; i++) v |= (this.p < this.b.length ? this.readBit() : 0) << i;
    this.p = p;
    this.bit = bit;
    return v;
  }
  align(): void {
    if (this.bit) {
      this.bit = 0;
      this.p++;
    }
  }
}

class Huff {
  private readonly count = new Uint16Array(16);
  private readonly symbols: Uint16Array;
  /** A code of one symbol takes no bits: the symbol, else -1. */
  private zero = -1;
  constructor(lengths: ArrayLike<number>, n: number) {
    for (let i = 0; i < n; i++) this.count[lengths[i]!]!++;
    this.symbols = new Uint16Array(n);
    const offs = new Uint16Array(17);
    this.count[0] = 0;
    for (let l = 1; l < 16; l++) offs[l + 1] = offs[l]! + this.count[l]!;
    for (let i = 0; i < n; i++) if (lengths[i]) this.symbols[offs[lengths[i]!]!++] = i;
  }
  static single(symbol: number): Huff {
    const h = new Huff([], 0);
    h.zero = symbol;
    return h;
  }
  decode(br: Bits): number {
    if (this.zero >= 0) return this.zero;
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= br.readBit();
      const count = this.count[len]!;
      if (code - count < first) return this.symbols[index + (code - first)]!;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    return bad();
  }
}

const CL_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const CL_LEN = [2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 4];
const CL_VAL = [0, 4, 3, 2, 0, 4, 3, 1, 0, 4, 3, 2, 0, 4, 3, 5];

function readPrefixCode(br: Bits, alphabet: number): Huff {
  const hskip = br.read(2);
  if (hskip === 1) {
    const nsym = br.read(2) + 1;
    let bits = 0;
    while (1 << bits < alphabet) bits++;
    const syms: number[] = [];
    for (let i = 0; i < nsym; i++) {
      const s = br.read(bits);
      if (s >= alphabet || syms.includes(s)) bad();
      syms.push(s);
    }
    if (nsym === 1) return Huff.single(syms[0]!);
    const lens = new Uint8Array(alphabet);
    const sorted = (a: number[]): number[] => [...a].sort((x, y) => x - y);
    if (nsym === 2) sorted(syms).forEach((s) => (lens[s] = 1));
    else if (nsym === 3) {
      lens[syms[0]!] = 1;
      sorted(syms.slice(1)).forEach((s) => (lens[s] = 2));
    } else if (br.readBit() === 0) sorted(syms).forEach((s) => (lens[s] = 2));
    else {
      lens[syms[0]!] = 1;
      lens[syms[1]!] = 2;
      sorted(syms.slice(2)).forEach((s) => (lens[s] = 3));
    }
    return new Huff(lens, alphabet);
  }
  // a complex code: the lengths of the codes that spell out the code lengths, then the code lengths
  const cl = new Uint8Array(18);
  let space = 32;
  let numCodes = 0;
  for (let i = hskip; i < 18; i++) {
    const idx = br.peek(4); // (only as many bits as the code uses are taken)
    br.read(CL_LEN[idx]!);
    const v = CL_VAL[idx]!;
    cl[CL_ORDER[i]!] = v;
    if (v) {
      space -= 32 >> v;
      numCodes++;
      if (space <= 0) break;
    }
  }
  if (!(numCodes === 1 || space === 0)) bad();
  const clCode = numCodes === 1 ? Huff.single(cl.findIndex((x) => x !== 0)) : new Huff(cl, 18);
  const lengths = new Uint8Array(alphabet);
  let symbol = 0, prev = 8, repeat = 0, repeatLen = 0, sp = 32768;
  while (symbol < alphabet && sp > 0) {
    const c = clCode.decode(br);
    if (c < 16) {
      repeat = 0;
      lengths[symbol++] = c;
      if (c) {
        prev = c;
        sp -= 32768 >> c;
      }
    } else {
      const extra = c === 16 ? 2 : 3;
      const newLen = c === 16 ? prev : 0;
      if (repeatLen !== newLen) {
        repeat = 0;
        repeatLen = newLen;
      }
      const old = repeat;
      if (repeat > 0) {
        repeat -= 2;
        repeat <<= extra;
      }
      repeat += br.read(extra) + 3;
      const delta = repeat - old;
      if (symbol + delta > alphabet) bad();
      for (let k = 0; k < delta; k++) lengths[symbol++] = repeatLen;
      if (repeatLen) sp -= delta << (15 - repeatLen);
    }
  }
  if (sp !== 0) bad();
  return new Huff(lengths, alphabet);
}

const varLen = (br: Bits): number => {
  if (!br.readBit()) return 1;
  const n = br.read(3);
  return n === 0 ? 2 : br.read(n) + (1 << n) + 1;
};

const BLOCK_LEN_BASE = [1, 5, 9, 13, 17, 25, 33, 41, 49, 65, 81, 97, 113, 145, 177, 209, 241, 305, 369, 497, 753, 1265, 2289, 4337, 8433, 16625];
const BLOCK_LEN_BITS = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24];
const INSERT_BASE = [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114, 6210, 22594];
const INSERT_BITS = [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24];
const COPY_BASE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 18, 22, 30, 38, 54, 70, 102, 134, 198, 326, 582, 1094, 2118];
const COPY_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24];
const INSERT_RANGE = [0, 0, 8, 8, 0, 16, 8, 16, 16];
const COPY_RANGE = [0, 8, 0, 8, 16, 0, 16, 8, 16];
const NDBITS = [0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5];
const DICT_OFFSET: number[] = (() => {
  const o = [0, 0, 0, 0, 0];
  for (let l = 4; l < 24; l++) o.push(o[l]! + l * (1 << NDBITS[l]!));
  return o;
})();

interface Block {
  n: number;
  type: number;
  last: number;
  before: number;
  left: number;
  typeCode: Huff | null;
  lenCode: Huff | null;
}

function readBlockHeader(br: Bits): Block {
  const n = varLen(br);
  const b: Block = { n, type: 0, last: 0, before: 1, left: 1 << 28, typeCode: null, lenCode: null };
  if (n >= 2) {
    b.typeCode = readPrefixCode(br, n + 2);
    b.lenCode = readPrefixCode(br, 26);
    b.left = readBlockLen(br, b);
  }
  return b;
}

function readBlockLen(br: Bits, b: Block): number {
  const s = b.lenCode!.decode(br);
  return BLOCK_LEN_BASE[s]! + br.read(BLOCK_LEN_BITS[s]!);
}

function nextBlock(br: Bits, b: Block): void {
  if (!b.typeCode) {
    b.left = 1 << 28;
    return;
  }
  const code = b.typeCode.decode(br);
  let t = code === 0 ? b.before : code === 1 ? b.last + 1 : code - 2;
  if (t >= b.n) t -= b.n;
  b.before = b.last;
  b.last = t;
  b.type = t;
  b.left = readBlockLen(br, b);
}

function contextMap(br: Bits, size: number, trees: number): Uint8Array {
  const map = new Uint8Array(size);
  if (trees < 2) return map;
  const rleMax = br.readBit() ? br.read(4) + 1 : 0;
  const code = readPrefixCode(br, trees + rleMax);
  for (let i = 0; i < size; ) {
    const s = code.decode(br);
    if (s === 0) map[i++] = 0;
    else if (s <= rleMax) {
      const run = (1 << s) + br.read(s);
      if (i + run > size) bad();
      i += run;
    } else map[i++] = s - rleMax;
  }
  if (br.readBit()) {
    const mtf = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 0; i < size; i++) {
      const idx = map[i]!;
      const v = mtf[idx]!;
      map[i] = v;
      mtf.splice(idx, 1);
      mtf.unshift(v);
    }
  }
  return map;
}

/** Decompress a Brotli stream. */
export async function brotliDecode(input: Uint8Array): Promise<Uint8Array> {
  await loadDictionary(); // (a few milliseconds: the dictionary is 122,784 bytes once unpacked)
  return decode(input);
}

function decode(input: Uint8Array): Uint8Array {
  const br = new Bits(input);
  let wbits = 16;
  if (br.readBit()) {
    const n = br.read(3);
    if (n) wbits = 17 + n;
    else {
      const m = br.read(3);
      if (m === 1) bad("a format this decoder does not read");
      wbits = m === 0 ? 17 : 8 + m;
    }
  }
  const windowSize = (1 << wbits) - 16;
  let out = new Uint8Array(Math.max(1024, input.length * 4));
  let n = 0;
  const ensure = (extra: number): void => {
    if (n + extra <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, n + extra));
    bigger.set(out.subarray(0, n));
    out = bigger;
  };
  const ring = [16, 15, 11, 4]; // the last distances, the newest last
  for (;;) {
    const last = br.readBit();
    if (last && br.readBit()) break;
    const nibbles = [4, 5, 6, 0][br.read(2)]!;
    if (nibbles === 0) {
      // a block of metadata: skipped
      if (br.readBit()) bad();
      const skipBytes = br.read(2);
      let skip = 0;
      for (let i = 0; i < skipBytes; i++) skip |= br.read(8) << (8 * i);
      if (skipBytes) skip += 1;
      br.align();
      br.p += skip;
      if (br.p > input.length) bad("cut short");
      if (last) break;
      continue;
    }
    const mlen = br.read(nibbles * 4) + 1;
    if (!last && br.readBit()) {
      // stored as it is
      br.align();
      if (br.p + mlen > input.length) bad("cut short");
      ensure(mlen);
      out.set(input.subarray(br.p, br.p + mlen), n);
      n += mlen;
      br.p += mlen;
      continue;
    }
    const L = readBlockHeader(br), I = readBlockHeader(br), D = readBlockHeader(br);
    const npostfix = br.read(2);
    const ndirect = br.read(4) << npostfix;
    const modes: number[] = [];
    for (let i = 0; i < L.n; i++) modes.push(br.read(2));
    const ntreesL = varLen(br);
    const lmap = contextMap(br, 64 * L.n, ntreesL);
    const ntreesD = varLen(br);
    const dmap = contextMap(br, 4 * D.n, ntreesD);
    const literal = Array.from({ length: ntreesL }, () => readPrefixCode(br, 256));
    const command = Array.from({ length: I.n }, () => readPrefixCode(br, 704));
    const distance = Array.from({ length: ntreesD }, () => readPrefixCode(br, 16 + ndirect + (48 << npostfix)));
    const end = n + mlen;
    ensure(mlen + 64);
    let p1 = n > 0 ? out[n - 1]! : 0;
    let p2 = n > 1 ? out[n - 2]! : 0;
    while (n < end) {
      if (I.left === 0) nextBlock(br, I);
      I.left--;
      const cmd = command[I.type]!.decode(br);
      let insertCode: number, copyCode: number, implicit = false;
      if (cmd < 128) {
        implicit = true;
        insertCode = (cmd >> 3) & 7;
        copyCode = (cmd & 7) + (cmd >= 64 ? 8 : 0);
      } else {
        const cell = (cmd >> 6) - 2;
        insertCode = INSERT_RANGE[cell]! + ((cmd >> 3) & 7);
        copyCode = COPY_RANGE[cell]! + (cmd & 7);
      }
      const insertLen = INSERT_BASE[insertCode]! + br.read(INSERT_BITS[insertCode]!);
      const copyLen = COPY_BASE[copyCode]! + br.read(COPY_BITS[copyCode]!);
      if (n + insertLen > end) bad();
      for (let i = 0; i < insertLen; i++) {
        if (L.left === 0) nextBlock(br, L);
        L.left--;
        const m = modes[L.type]! * 512;
        const ctx = CONTEXT[m + p1]! | CONTEXT[m + 256 + p2]!;
        // (the signed mode combines the two tables the same way as UTF8: by their bits, which the tables keep apart)
        const tree = lmap[L.type * 64 + ctx]!;
        const byte = literal[tree]!.decode(br);
        out[n++] = byte;
        p2 = p1;
        p1 = byte;
      }
      if (n >= end) break;
      let dcode = 0;
      if (!implicit) {
        if (D.left === 0) nextBlock(br, D);
        D.left--;
        const tree = dmap[D.type * 4 + (copyLen > 4 ? 3 : copyLen - 2)]!;
        dcode = distance[tree]!.decode(br);
      }
      let dist: number;
      if (dcode === 0) dist = ring[3]!;
      else if (dcode < 16) {
        const base = [ring[3]!, ring[2]!, ring[1]!, ring[0]!][dcode < 4 ? dcode : dcode < 10 ? 0 : 1]!;
        const delta = dcode < 4 ? 0 : [-1, 1, -2, 2, -3, 3][(dcode - 4) % 6]!;
        dist = base + delta;
        if (dist <= 0) bad();
      } else if (dcode < 16 + ndirect) dist = dcode - 15;
      else {
        const c = dcode - ndirect - 16;
        const ndist = 1 + (c >> (npostfix + 1));
        const hcode = c >> npostfix;
        const lcode = c & ((1 << npostfix) - 1);
        const offset = ((2 + (hcode & 1)) << ndist) - 4;
        dist = ((offset + br.read(ndist)) << npostfix) + lcode + ndirect + 1;
      }
      const maxDist = Math.min(windowSize, n);
      if (dist <= maxDist) {
        if (dcode !== 0) {
          ring.shift();
          ring.push(dist);
        }
        if (n + copyLen > end) bad();
        ensure(copyLen);
        for (let i = 0; i < copyLen; i++) out[n + i] = out[n + i - dist]!;
        n += copyLen;
        p1 = out[n - 1]!;
        p2 = out[n - 2] ?? 0;
      } else {
        // a word of the static dictionary, transformed
        if (copyLen < 4 || copyLen > 24 || !dictionary) bad(dictionary ? undefined : "using the dictionary, which is not loaded");
        const id = dist - maxDist - 1;
        const nb = NDBITS[copyLen]!;
        const word = dictionary!.subarray(DICT_OFFSET[copyLen]! + (id & ((1 << nb) - 1)) * copyLen, DICT_OFFSET[copyLen]! + ((id & ((1 << nb) - 1)) + 1) * copyLen);
        const t = id >> nb;
        if (t >= TRANSFORMS.length) bad();
        const bytes = transform(word, t);
        if (n + bytes.length > end) bad();
        ensure(bytes.length);
        out.set(bytes, n);
        n += bytes.length;
        p1 = out[n - 1]!;
        p2 = out[n - 2] ?? 0;
      }
    }
    if (n !== end) bad();
    if (last) break;
  }
  return out.slice(0, n);
}

const latin1 = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

function transform(word: Uint8Array, id: number): Uint8Array {
  const [prefix, type, suffix] = TRANSFORMS[id]!;
  let w = Array.from(word);
  if (type >= 1 && type <= 9) w = w.slice(0, Math.max(0, w.length - type));
  else if (type >= 12) w = w.slice(Math.min(w.length, type - 11));
  const upper = (at: number): number => {
    // capitalise the UTF-8 letter that starts at `at`, and say how many bytes it is
    const c = w[at]!;
    if (c < 0xc0) {
      if (c >= 97 && c <= 122) w[at] = c ^ 32;
      return 1;
    }
    if (c < 0xe0) {
      if (at + 1 < w.length) w[at + 1] = w[at + 1]! ^ 32;
      return 2;
    }
    if (at + 2 < w.length) w[at + 2] = w[at + 2]! ^ 5;
    return 3;
  };
  if (type === 10 && w.length) upper(0);
  else if (type === 11) for (let i = 0; i < w.length; ) i += upper(i);
  return Uint8Array.from([...latin1(prefix), ...w, ...latin1(suffix)]);
}
