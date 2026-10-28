/**
 * The key of the hidden items in a workspace folder (ADR 0177, "Hidden items: the design"): a random AES-GCM data key encrypts
 * each hidden original and the index of the hidden items; the Hidden password, stretched with PBKDF2, wraps that key (AES-KW).
 * A wrong password fails to unwrap, so unwrapping is also the check; a new password wraps the same key again, so no file is
 * encrypted again. WebCrypto only; nothing here touches storage.
 */
export const VAULT_FORMAT = "canvast-hidden";
export const VAULT_ITERATIONS = 600_000;
/** A sealed file is this much longer than the original: the IV in front, the GCM tag at the end. */
export const SEAL_OVERHEAD = 12 + 16;

export interface VaultRecord {
  format: typeof VAULT_FORMAT;
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  /** The data key, wrapped by the password's key (AES-KW), base64. */
  key: string;
  /** The hidden items' entries (JSON), sealed with the data key. */
  index?: Sealed;
}

export interface Sealed {
  iv: string;
  data: string;
}

const enc = new TextEncoder();
const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

async function wrap(dataKey: CryptoKey, password: string, iterations: number): Promise<VaultRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await passwordKey(password, salt, iterations);
  const key = new Uint8Array(await crypto.subtle.wrapKey("raw", dataKey, kek, "AES-KW"));
  return { format: VAULT_FORMAT, version: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: b64(salt) }, key: b64(key) };
}

/** The data key, or null when the password is wrong or the record damaged. `extractable` only to wrap it again. */
async function unwrap(record: VaultRecord, password: string, extractable: boolean): Promise<CryptoKey | null> {
  try {
    const kek = await passwordKey(password, unb64(record.kdf.salt), record.kdf.iterations);
    return await crypto.subtle.unwrapKey("raw", unb64(record.key), kek, "AES-KW", { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

/** A new vault for a password: its record (to keep in the folder) and the data key (kept in memory only, not extractable). */
export async function createVault(password: string, iterations = VAULT_ITERATIONS): Promise<{ record: VaultRecord; key: CryptoKey }> {
  const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const record = await wrap(fresh, password, iterations);
  return { record, key: (await unwrap(record, password, false))! };
}

/** The data key for a password, or null when it is not the password. */
export const openVault = (record: VaultRecord, password: string): Promise<CryptoKey | null> => unwrap(record, password, false);

/** The same data key under a new password (null when `oldPassword` is wrong). The sealed index and files stay as they are. */
export async function rewrapVault(record: VaultRecord, oldPassword: string, newPassword: string, iterations = record.kdf.iterations): Promise<VaultRecord | null> {
  const key = await unwrap(record, oldPassword, true);
  if (!key) return null;
  return { ...(await wrap(key, newPassword, iterations)), ...(record.index ? { index: record.index } : {}) };
}

/** Bytes sealed with the data key: a random IV, then the AES-GCM ciphertext and tag. */
export async function sealBytes(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

/** The bytes of a sealed file, or null when it was not sealed with this key or was changed. */
export async function openBytes(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (sealed.length < SEAL_OVERHEAD) return null;
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, 12) }, key, sealed.subarray(12)));
  } catch {
    return null;
  }
}

export async function sealText(key: CryptoKey, text: string): Promise<Sealed> {
  const sealed = await sealBytes(key, enc.encode(text));
  return { iv: b64(sealed.subarray(0, 12)), data: b64(sealed.subarray(12)) };
}

export async function openText(key: CryptoKey, sealed: Sealed): Promise<string | null> {
  try {
    const iv = unb64(sealed.iv);
    const data = unb64(sealed.data);
    if (iv.length !== 12) return null;
    const all = new Uint8Array(12 + data.length);
    all.set(iv);
    all.set(data, 12);
    const bytes = await openBytes(key, all);
    return bytes ? new TextDecoder().decode(bytes) : null;
  } catch {
    return null;
  }
}

/** A vault record read from `.canvast/hidden.json`, checked, or null when it is not one. */
export function readVault(text: string): VaultRecord | null {
  try {
    const r = JSON.parse(text) as Partial<VaultRecord>;
    const k = r.kdf;
    const ok =
      r.format === VAULT_FORMAT &&
      r.version === 1 &&
      !!k && k.name === "PBKDF2" && k.hash === "SHA-256" &&
      Number.isInteger(k.iterations) && k.iterations >= 100_000 && k.iterations <= 10_000_000 &&
      typeof k.salt === "string" && B64_RE.test(k.salt) &&
      typeof r.key === "string" && B64_RE.test(r.key) && r.key.length <= 64 &&
      (r.index === undefined || (typeof r.index.iv === "string" && B64_RE.test(r.index.iv) && typeof r.index.data === "string" && B64_RE.test(r.index.data)));
    return ok ? (r as VaultRecord) : null;
  } catch {
    return null;
  }
}

/** A new name for a hidden file: random, so it says nothing about the item. */
export function hiddenFileName(): string {
  return `.hidden/${Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("")}.bin`;
}
