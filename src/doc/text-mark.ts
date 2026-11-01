/**
 * An invisible watermark in a text: the same encrypted words as a picture's mark (doc/invisible-mark.ts), written as zero-width characters
 * (two bits each) spread after the spaces of the text. They are not seen and do not change the layout; they go with the words when the text
 * is copied, as long as the app it is pasted into keeps them (some take them out).
 */
import { MAX_MARK_TEXT_BYTES, crc32 } from "./invisible-mark";

/** The four characters that carry two bits each. */
const SYMBOLS = ["​", "‌", "‍", "⁠"];
const SYMBOL_RE = /[​‌‍⁠]/g;
/** Where a mark starts: a run no text of one would make by chance. */
const SYNC = [3, 0, 3, 1, 2, 0, 1, 3];
const MAGIC = [0x63, 0x77];

/** The text without any mark in it. */
export const unmarked = (s: string): string => s.replace(SYMBOL_RE, "");

const sealWith = async (key: CryptoKey, b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CTR", counter: new Uint8Array(16), length: 64 }, key, b as Uint8Array<ArrayBuffer>));

/** `s` with `words` hidden in it (any mark it had is taken out first). Throws for words longer than a mark holds. */
export async function markText(s: string, words: string, key: CryptoKey): Promise<string> {
  const t = new TextEncoder().encode(words);
  if (t.length > MAX_MARK_TEXT_BYTES) throw new RangeError(`the text is more than ${MAX_MARK_TEXT_BYTES} bytes`);
  const plain = new Uint8Array(2 + t.length);
  plain.set(MAGIC);
  plain.set(t, 2);
  const sealed = await sealWith(key, plain);
  const bytes = new Uint8Array(1 + sealed.length + 4);
  bytes[0] = sealed.length;
  bytes.set(sealed, 1);
  new DataView(bytes.buffer).setUint32(1 + sealed.length, crc32(bytes.subarray(0, 1 + sealed.length)));
  const syms = [...SYNC];
  for (const b of bytes) for (let k = 6; k >= 0; k -= 2) syms.push((b >> k) & 3);
  const code = syms.map((v) => SYMBOLS[v]).join("");
  const base = unmarked(s);
  // Spread over the spaces (a few characters after each), the rest after the last one; a text without spaces carries it at its end.
  const spaces = [...base.matchAll(/ /g)].map((m) => m.index!);
  if (!spaces.length) return base + code;
  const per = Math.ceil(code.length / spaces.length);
  let out = "", from = 0, at = 0;
  for (const i of spaces) {
    out += base.slice(from, i + 1) + code.slice(at, at + per);
    from = i + 1;
    at += per;
  }
  return out + base.slice(from);
}

/** What a mark in `s` holds: the words (null when `key` is not the one it was hidden with), or none found. */
export async function readText(s: string, key: CryptoKey): Promise<{ found: "yes"; words: string } | { found: "locked" } | { found: "no" }> {
  const syms = [...s.matchAll(SYMBOL_RE)].map((m) => SYMBOLS.indexOf(m[0]));
  for (let start = 0; start + SYNC.length <= syms.length; start++) {
    if (!SYNC.every((v, i) => syms[start + i] === v)) continue;
    const at = start + SYNC.length;
    const byte = (i: number): number => ((syms[at + i * 4]! << 6) | (syms[at + i * 4 + 1]! << 4) | (syms[at + i * 4 + 2]! << 2) | syms[at + i * 4 + 3]!) & 0xff;
    const n = byte(0);
    const total = 1 + n + 4;
    if (n < 2 || at + total * 4 > syms.length) continue;
    const bytes = Uint8Array.from({ length: total }, (_, i) => byte(i));
    if (crc32(bytes.subarray(0, 1 + n)) !== new DataView(bytes.buffer).getUint32(1 + n)) continue;
    const plain = await sealWith(key, bytes.subarray(1, 1 + n));
    if (plain[0] !== MAGIC[0] || plain[1] !== MAGIC[1]) return { found: "locked" };
    return { found: "yes", words: new TextDecoder().decode(plain.subarray(2)) };
  }
  return { found: "no" };
}
