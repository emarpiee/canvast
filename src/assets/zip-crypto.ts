import { CRC_TABLE } from "../storage/zip";

/**
 * The two kinds of password a ZIP can have, for reading only: the old one of PKZIP ("ZipCrypto", weak, but still what many tools make by
 * default) and WinZip's AES (AE-1 and AE-2, 128, 192 or 256 bits, what 7-Zip, WinZip and others make when asked for AES). Each says
 * whether a password is right before anything is unpacked; AES also checks the bytes it decrypted (its authentication code).
 */

export class WrongPassword extends Error {
  constructor() {
    super("That password is not the one.");
  }
}

// ---- the old PKZIP encryption

const crcStep = (c: number, b: number): number => (CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)) >>> 0;

/** Decrypts an entry made with the old PKZIP encryption: its 12-byte header first, which says whether the password is right (`check`, one byte). */
export function zipCryptoDecrypt(data: Uint8Array, password: string, check: number): Uint8Array {
  let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
  const update = (c: number): void => {
    k0 = crcStep(k0, c);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crcStep(k2, k1 >>> 24);
  };
  for (const b of new TextEncoder().encode(password)) update(b);
  if (data.length < 12) throw new Error("damaged encrypted entry");
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const t = (k2 | 2) & 0xffff;
    const c = data[i]! ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
    out[i] = c;
    update(c);
  }
  if (out[11] !== check) throw new WrongPassword();
  return out.subarray(12);
}

// ---- AES, the block cipher alone (WebCrypto's AES-CTR counts big-endian; WinZip's counter is little-endian, so the blocks are made here)

const SBOX = new Uint8Array(256);
const T0 = new Uint32Array(256), T1 = new Uint32Array(256), T2 = new Uint32Array(256), T3 = new Uint32Array(256);
(() => {
  const x2 = (a: number): number => ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0xff;
  // The S-box from the multiplicative inverse in GF(2^8) and the affine map.
  let p = 1, q = 1;
  do {
    p = p ^ x2(p);
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const s = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (s ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i]!, s2 = x2(s), s3 = s2 ^ s;
    const t = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    T0[i] = t;
    T1[i] = ((t >>> 8) | (t << 24)) >>> 0;
    T2[i] = ((t >>> 16) | (t << 16)) >>> 0;
    T3[i] = ((t >>> 24) | (t << 8)) >>> 0;
  }
})();

/** The round keys of an AES key (16, 24 or 32 bytes). */
function expandKey(key: Uint8Array): Uint32Array {
  const nk = key.length / 4, rounds = nk + 6, w = new Uint32Array(4 * (rounds + 1));
  for (let i = 0; i < nk; i++) w[i] = ((key[4 * i]! << 24) | (key[4 * i + 1]! << 16) | (key[4 * i + 2]! << 8) | key[4 * i + 3]!) >>> 0;
  let rcon = 1;
  for (let i = nk; i < w.length; i++) {
    let t = w[i - 1]!;
    if (i % nk === 0) {
      t = ((SBOX[(t >>> 16) & 0xff]! << 24) | (SBOX[(t >>> 8) & 0xff]! << 16) | (SBOX[t & 0xff]! << 8) | SBOX[t >>> 24]!) ^ (rcon << 24);
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 0xff;
    } else if (nk > 6 && i % nk === 4) t = (SBOX[t >>> 24]! << 24) | (SBOX[(t >>> 16) & 0xff]! << 16) | (SBOX[(t >>> 8) & 0xff]! << 8) | SBOX[t & 0xff]!;
    w[i] = (w[i - nk]! ^ t) >>> 0;
  }
  return w;
}

/** One block encrypted, from `inp` (4 words) into `out` (16 bytes). */
function encryptBlock(w: Uint32Array, s0: number, s1: number, s2: number, s3: number, out: Uint8Array): void {
  const rounds = w.length / 4 - 1;
  s0 ^= w[0]!; s1 ^= w[1]!; s2 ^= w[2]!; s3 ^= w[3]!;
  let k = 4;
  for (let r = 1; r < rounds; r++, k += 4) {
    const t0 = T0[s0 >>> 24]! ^ T1[(s1 >>> 16) & 0xff]! ^ T2[(s2 >>> 8) & 0xff]! ^ T3[s3 & 0xff]! ^ w[k]!;
    const t1 = T0[s1 >>> 24]! ^ T1[(s2 >>> 16) & 0xff]! ^ T2[(s3 >>> 8) & 0xff]! ^ T3[s0 & 0xff]! ^ w[k + 1]!;
    const t2 = T0[s2 >>> 24]! ^ T1[(s3 >>> 16) & 0xff]! ^ T2[(s0 >>> 8) & 0xff]! ^ T3[s1 & 0xff]! ^ w[k + 2]!;
    const t3 = T0[s3 >>> 24]! ^ T1[(s0 >>> 16) & 0xff]! ^ T2[(s1 >>> 8) & 0xff]! ^ T3[s2 & 0xff]! ^ w[k + 3]!;
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
  }
  const last = (a: number, b: number, c: number, d: number, kw: number, o: number): void => {
    out[o] = SBOX[a >>> 24]! ^ (kw >>> 24);
    out[o + 1] = SBOX[(b >>> 16) & 0xff]! ^ ((kw >>> 16) & 0xff);
    out[o + 2] = SBOX[(c >>> 8) & 0xff]! ^ ((kw >>> 8) & 0xff);
    out[o + 3] = SBOX[d & 0xff]! ^ (kw & 0xff);
  };
  last(s0, s1, s2, s3, w[k]!, 0);
  last(s1, s2, s3, s0, w[k + 1]!, 4);
  last(s2, s3, s0, s1, w[k + 2]!, 8);
  last(s3, s0, s1, s2, w[k + 3]!, 12);
}

/** AES in counter mode as WinZip uses it: the counter little-endian, from 1. The same both ways. */
export function aesCtrLE(key: Uint8Array, data: Uint8Array): Uint8Array {
  const w = expandKey(key), out = new Uint8Array(data.length), ks = new Uint8Array(16);
  const swap = (v: number): number => (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24)) >>> 0;
  for (let i = 0, n = 1; i < data.length; i += 16, n++) {
    // The counter block's bytes are n little-endian (low word first, then the high word), the rest zero.
    encryptBlock(w, swap(n >>> 0), swap(Math.floor(n / 2 ** 32)), 0, 0, ks);
    const end = Math.min(16, data.length - i);
    for (let j = 0; j < end; j++) out[i + j] = data[i + j]! ^ ks[j]!;
  }
  return out;
}

// ---- WinZip AES

/** What a WinZip AES entry says of itself (its 0x9901 extra field): AE-1 or AE-2, the key's length in bytes, the method under it. */
export interface AesInfo {
  version: 1 | 2;
  keyBytes: 16 | 24 | 32;
  method: number;
}

export function aesInfo(field: DataView | null): AesInfo | null {
  if (!field || field.byteLength < 7) return null;
  const strength = field.getUint8(4);
  const keyBytes = strength === 1 ? 16 : strength === 2 ? 24 : strength === 3 ? 32 : 0;
  const version = field.getUint16(0, true);
  if (!keyBytes || (version !== 1 && version !== 2)) return null;
  return { version, keyBytes, method: field.getUint16(5, true) } as AesInfo;
}

const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

/** Decrypts a WinZip AES entry (salt, password check, data, 10-byte authentication code): wrong password and damaged bytes both refused. */
export async function winZipAesDecrypt(data: Uint8Array, password: string, keyBytes: 16 | 24 | 32): Promise<Uint8Array> {
  const saltLen = keyBytes / 2 + 4;
  if (data.length < saltLen + 2 + 10) throw new Error("damaged encrypted entry");
  const salt = data.subarray(0, saltLen);
  const check = data.subarray(saltLen, saltLen + 2);
  const body = data.subarray(saltLen + 2, data.length - 10);
  const code = data.subarray(data.length - 10);
  const base = await crypto.subtle.importKey("raw", buf(new TextEncoder().encode(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: buf(salt), iterations: 1000, hash: "SHA-1" }, base, (2 * keyBytes + 2) * 8));
  if (bits[2 * keyBytes] !== check[0] || bits[2 * keyBytes + 1] !== check[1]) throw new WrongPassword();
  const mac = await crypto.subtle.importKey("raw", buf(bits.subarray(keyBytes, 2 * keyBytes)), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", mac, buf(body)));
  for (let i = 0; i < 10; i++) if (sig[i] !== code[i]) throw new Error("this entry is damaged (its authentication code does not match)");
  return aesCtrLE(bits.subarray(0, keyBytes), body);
}
