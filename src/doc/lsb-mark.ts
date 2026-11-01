/**
 * A text hidden in the lowest bit of a picture's red, green and blue (LSB), pixel by pixel from the top left, each byte highest bit first, the
 * text in UTF-8 ended by a zero byte: the plain layout common LSB tools read, so they show it too. With a password the text is encrypted first
 * and written as `canvast-locked:` and base64 (other tools then show that, not the words). It holds a lot, but anything that changes the
 * pixels (a JPEG save, a resize, an adjustment) erases it: the picture is kept as a PNG.
 */
import type { Pixels } from "./invisible-mark";

const LOCKED = "canvast-locked:";
const MAGIC = [0x63, 0x77];
/** At most this many characters (and never more than the picture holds). */
export const MAX_LSB_TEXT = 10_000;

/** How many bytes `p` holds, the ending zero byte included. */
export const lsbCapacity = (p: { width: number; height: number }): number => Math.floor((p.width * p.height * 3) / 8);

const crypt = async (key: CryptoKey, b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CTR", counter: new Uint8Array(16), length: 64 }, key, b as Uint8Array<ArrayBuffer>));

const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The bytes to write for `text` (encrypted when `key` is given). */
export async function lsbBytes(text: string, key: CryptoKey | null): Promise<Uint8Array> {
  let words = text;
  if (key) {
    const t = new TextEncoder().encode(text);
    const plain = new Uint8Array(2 + t.length);
    plain.set(MAGIC);
    plain.set(t, 2);
    words = LOCKED + b64(await crypt(key, plain));
  }
  const t = new TextEncoder().encode(words);
  const out = new Uint8Array(t.length + 1); // (the ending zero)
  out.set(t);
  return out;
}

/** Write `bytes` into the lowest bits of `p` (in place). False when they do not fit, or `p` has see-through pixels (their colours are not kept exactly). */
export function hideLsb(p: Pixels, bytes: Uint8Array): boolean {
  if (bytes.length > lsbCapacity(p)) return false;
  const d = p.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false;
  for (let k = 0; k < bytes.length * 8; k++) {
    const bit = (bytes[k >> 3]! >> (7 - (k & 7))) & 1;
    const at = Math.floor(k / 3) * 4 + (k % 3);
    d[at] = (d[at]! & 0xfe) | bit;
  }
  return true;
}

const printable = (s: string): boolean => /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u.test(s);

/** The text in the lowest bits of `p`, the locked one opened with `key`: a text, "locked" (it needs its password), or null (none). */
export async function readLsb(p: Pixels, key: CryptoKey): Promise<string | "locked" | null> {
  const d = p.data;
  const max = Math.min(lsbCapacity(p), MAX_LSB_TEXT * 4 + LOCKED.length + 64);
  const bytes: number[] = [];
  for (let n = 0; n < max; n++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      const k = n * 8 + j;
      b = (b << 1) | (d[Math.floor(k / 3) * 4 + (k % 3)]! & 1);
    }
    if (b === 0) break;
    bytes.push(b);
  }
  // (a few letters ended by a zero byte, all of them readable: the lowest bits of a picture without a text almost never look like that)
  if (bytes.length < 4 || bytes.length >= max) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
  if (!printable(text)) return null;
  if (!text.startsWith(LOCKED)) return text;
  try {
    const plain = await crypt(key, unb64(text.slice(LOCKED.length)));
    return plain[0] === MAGIC[0] && plain[1] === MAGIC[1] ? new TextDecoder().decode(plain.subarray(2)) : "locked";
  } catch {
    return null;
  }
}
