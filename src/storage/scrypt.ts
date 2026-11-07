/**
 * scrypt (RFC 7914) in plain JavaScript, for where it is not done natively: the browser build, which opens the hidden items a desktop
 * backup carries (their key is wrapped by a password stretched with scrypt). PBKDF2-HMAC-SHA256 is WebCrypto's; the memory-hard part
 * (ROMix with Salsa20/8) is here, and gives the page a moment now and then so it stays drawn. N = 2^17, r = 8 takes 128 MiB.
 */

async function pbkdf2(password: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1 }, base, bytes * 8));
}

const rotl = (a: number, b: number): number => (a << b) | (a >>> (32 - b));

/** Salsa20/8 of the 16 words of `b` at `at`, in place (with `x` as room). */
function salsa8(b: Uint32Array, at: number, x: Uint32Array): void {
  for (let i = 0; i < 16; i++) x[i] = b[at + i]!;
  for (let i = 0; i < 8; i += 2) {
    x[4]! ^= rotl(x[0]! + x[12]!, 7); x[8]! ^= rotl(x[4]! + x[0]!, 9); x[12]! ^= rotl(x[8]! + x[4]!, 13); x[0]! ^= rotl(x[12]! + x[8]!, 18);
    x[9]! ^= rotl(x[5]! + x[1]!, 7); x[13]! ^= rotl(x[9]! + x[5]!, 9); x[1]! ^= rotl(x[13]! + x[9]!, 13); x[5]! ^= rotl(x[1]! + x[13]!, 18);
    x[14]! ^= rotl(x[10]! + x[6]!, 7); x[2]! ^= rotl(x[14]! + x[10]!, 9); x[6]! ^= rotl(x[2]! + x[14]!, 13); x[10]! ^= rotl(x[6]! + x[2]!, 18);
    x[3]! ^= rotl(x[15]! + x[11]!, 7); x[7]! ^= rotl(x[3]! + x[15]!, 9); x[11]! ^= rotl(x[7]! + x[3]!, 13); x[15]! ^= rotl(x[11]! + x[7]!, 18);
    x[1]! ^= rotl(x[0]! + x[3]!, 7); x[2]! ^= rotl(x[1]! + x[0]!, 9); x[3]! ^= rotl(x[2]! + x[1]!, 13); x[0]! ^= rotl(x[3]! + x[2]!, 18);
    x[6]! ^= rotl(x[5]! + x[4]!, 7); x[7]! ^= rotl(x[6]! + x[5]!, 9); x[4]! ^= rotl(x[7]! + x[6]!, 13); x[5]! ^= rotl(x[4]! + x[7]!, 18);
    x[11]! ^= rotl(x[10]! + x[9]!, 7); x[8]! ^= rotl(x[11]! + x[10]!, 9); x[9]! ^= rotl(x[8]! + x[11]!, 13); x[10]! ^= rotl(x[9]! + x[8]!, 18);
    x[12]! ^= rotl(x[15]! + x[14]!, 7); x[13]! ^= rotl(x[12]! + x[15]!, 9); x[14]! ^= rotl(x[13]! + x[12]!, 13); x[15]! ^= rotl(x[14]! + x[13]!, 18);
  }
  for (let i = 0; i < 16; i++) b[at + i] = (b[at + i]! + x[i]!) | 0;
}

/** BlockMix of the 32r words of `b` into `y` (even blocks first, then odd ones). */
function blockMix(b: Uint32Array, y: Uint32Array, r: number, t: Uint32Array, x: Uint32Array): void {
  t.set(b.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) t[k]! ^= b[i * 16 + k]!;
    salsa8(t, 0, x);
    y.set(t, ((i & 1) * r + (i >> 1)) * 16);
  }
}

/** scrypt of a password: `bytes` long (32 for a key). Throws on parameters it does not take. */
export async function scryptJs(password: string, salt: Uint8Array, N: number, r: number, p: number, bytes = 32): Promise<Uint8Array> {
  if (!(N > 1 && (N & (N - 1)) === 0 && N <= 2 ** 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) throw new Error("scrypt parameters out of range");
  const pass = new TextEncoder().encode(password); // (as the desktop app's: the text as typed, UTF-8)
  const words = 32 * r;
  const B = await pbkdf2(pass, new Uint8Array(salt), p * 128 * r);
  const b32 = new Uint32Array(B.buffer);
  // (the words of the blocks are little-endian; so is every machine the app runs on, checked once)
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error("scrypt needs a little-endian machine");
  const V = new Uint32Array(N * words);
  const X = new Uint32Array(words), Y = new Uint32Array(words), T = new Uint32Array(16), S = new Uint32Array(16);
  let last = performance.now();
  const breathe = async (): Promise<void> => {
    if (performance.now() - last < 30) return;
    await new Promise((go) => setTimeout(go, 0));
    last = performance.now();
  };
  for (let k = 0; k < p; k++) {
    X.set(b32.subarray(k * words, (k + 1) * words));
    for (let i = 0; i < N; i++) {
      V.set(X, i * words);
      blockMix(X, Y, r, T, S);
      X.set(Y);
      if ((i & 1023) === 0) await breathe();
    }
    for (let i = 0; i < N; i++) {
      const j = X[(2 * r - 1) * 16]! & (N - 1);
      for (let w = 0; w < words; w++) X[w]! ^= V[j * words + w]!;
      blockMix(X, Y, r, T, S);
      X.set(Y);
      if ((i & 1023) === 0) await breathe();
    }
    b32.set(X, k * words);
  }
  V.fill(0);
  const out = await pbkdf2(pass, B, bytes);
  B.fill(0);
  return out;
}
