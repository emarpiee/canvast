/**
 * The password that guards the Hidden list (a gate, not encryption: the hidden files are stored as they are). Only a salted PBKDF2 hash is kept,
 * as "pbkdf2$iterations$salt$hash" (base64), so the password itself is never stored. WebCrypto works offline from `file://`.
 */
const ITERATIONS = 200_000;
const enc = new TextEncoder();

const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256));
}

/** The text to keep for a password. */
export async function makeLock(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`;
}

/** Whether `password` is the one `stored` was made from (a damaged value never matches). */
export async function checkLock(stored: string, password: string): Promise<boolean> {
  const [kind, it, salt, hash] = stored.split("$");
  const iterations = Number(it);
  if (kind !== "pbkdf2" || !salt || !hash || !Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;
  try {
    const got = await derive(password, unb64(salt), iterations);
    const want = unb64(hash);
    return got.length === want.length && got.every((v, i) => v === want[i]);
  } catch {
    return false;
  }
}
