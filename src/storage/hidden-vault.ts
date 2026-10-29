/**
 * The key of the hidden items in a workspace folder (ADR 0177, "Hidden items: the design"): a random AES-GCM data key encrypts
 * each hidden original and the index of the hidden items; the Hidden password, stretched with PBKDF2, wraps that key (AES-KW).
 * A wrong password fails to unwrap, so unwrapping is also the check; a new password wraps the same key again, so no file is
 * encrypted again. WebCrypto only; nothing here touches storage.
 */
export const VAULT_FORMAT = "canvast-hidden";
/** PBKDF2 rounds of a version 1 vault (read, and upgraded to scrypt when opened). */
export const VAULT_ITERATIONS = 600_000;
/** scrypt for a new or upgraded vault: N = 2^17, r = 8 (128 MiB of memory per guess, eight times rclone's default), about 0.7 s natively. */
export const SCRYPT_DEFAULT = { N: 131_072, r: 8, p: 1 } as const;
/** A sealed file is this much longer than the original: the IV in front, the GCM tag at the end. */
export const SEAL_OVERHEAD = 12 + 16;

/** How the password is stretched: PBKDF2 (version 1) or scrypt (version 2, memory-hard). */
export type Kdf =
  | { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string }
  | { name: "scrypt"; N: number; r: number; p: number; salt: string };
/** The stretching a new wrap uses (its salt is made then). */
export type KdfChoice = { name: "PBKDF2"; iterations: number } | { name: "scrypt"; N: number; r: number; p: number };
const SCRYPT: KdfChoice = { name: "scrypt", ...SCRYPT_DEFAULT };

/** scrypt, where it is done: natively, in the desktop app's main process (WebCrypto has no memory-hard function). */
export type Scrypt = (password: string, salt: Uint8Array, N: number, r: number, p: number) => Promise<Uint8Array>;
let scrypt: Scrypt | null = null;
/** Set where scrypt is done (the desktop bridge; Node's in tests). */
export function useScrypt(fn: Scrypt | null): void {
  scrypt = fn;
}

export interface VaultRecord {
  format: typeof VAULT_FORMAT;
  /** 1: PBKDF2; 2: scrypt. */
  version: 1 | 2;
  kdf: Kdf;
  /** The data key, wrapped by the password's key (AES-KW), base64. */
  key: string;
  /** The hidden items' entries (JSON), sealed with the data key. */
  index?: Sealed;
  /** A known text sealed with the data key: whether a key is this record's, without the password (records of 0.50.46 and before have none). */
  check?: Sealed;
  /** The hidden library folders (Hide folder), sealed: their names are nowhere else in the workspace folder. */
  folders?: Sealed;
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

/** The key-encryption key a password and a vault's stretching give. */
async function passwordKey(password: string, kdf: Kdf): Promise<CryptoKey> {
  const salt = unb64(kdf.salt);
  if (kdf.name === "scrypt") {
    if (!scrypt) throw new Error("scrypt is not available here");
    const raw = new Uint8Array(await scrypt(password, salt, kdf.N, kdf.r, kdf.p));
    try {
      return await crypto.subtle.importKey("raw", raw, "AES-KW", false, ["wrapKey", "unwrapKey"]);
    } finally {
      raw.fill(0);
    }
  }
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: kdf.iterations }, base, { name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

async function wrap(dataKey: CryptoKey, password: string, choice: KdfChoice): Promise<VaultRecord> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const kdf: Kdf = choice.name === "PBKDF2" ? { name: "PBKDF2", hash: "SHA-256", iterations: choice.iterations, salt } : { ...choice, salt };
  const kek = await passwordKey(password, kdf);
  const key = new Uint8Array(await crypto.subtle.wrapKey("raw", dataKey, kek, "AES-KW"));
  return { format: VAULT_FORMAT, version: kdf.name === "scrypt" ? 2 : 1, kdf, key: b64(key) };
}

/** The data key, or null when the password is wrong or the record damaged (scrypt not being available throws). */
async function unwrap(record: VaultRecord, password: string, extractable: boolean): Promise<CryptoKey | null> {
  const kek = await passwordKey(password, record.kdf);
  try {
    return await crypto.subtle.unwrapKey("raw", unb64(record.key), kek, "AES-KW", { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

/** Whether a vault still stretches its password with PBKDF2 (version 1): it is wrapped again with scrypt once opened. */
export const needsUpgrade = (record: VaultRecord): boolean => record.kdf.name !== "scrypt";

/**
 * A new vault for a password: its record (to keep in the folder) and the data key, kept in memory only and not extractable (no
 * code in the page can read it out; on disk it is only ever wrapped).
 */
export async function createVault(password: string, choice: KdfChoice = SCRYPT): Promise<{ record: VaultRecord; key: CryptoKey }> {
  const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const record = { ...(await wrap(made, password, choice)), check: await keyCheck(made) };
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", made));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return { record, key };
}

/** The data key for a password (not extractable), or null when it is not the password. */
export const openVault = (record: VaultRecord, password: string): Promise<CryptoKey | null> => unwrap(record, password, false);

/**
 * The same data key under a new password, given the current one (the key in memory cannot be read out to wrap again). The sealed
 * index and files stay as they are. Null when `password` is not the current password.
 */
export async function rewrapVault(record: VaultRecord, password: string, newPassword: string, choice: KdfChoice = SCRYPT): Promise<VaultRecord | null> {
  const key = await unwrap(record, password, true);
  if (!key) return null;
  return { ...(await wrap(key, newPassword, choice)), ...(record.index ? { index: record.index } : {}), ...(record.folders ? { folders: record.folders } : {}), check: await keyCheck(key) };
}

/** Whether two data keys are the same key, without reading either out: what one seals, the other opens. */
export async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  return (await openBytes(b, await sealBytes(a, new Uint8Array([1])))) !== null;
}

const CHECK_TEXT = VAULT_FORMAT;
/** The record's `check` for a data key. */
export const keyCheck = (key: CryptoKey): Promise<Sealed> => sealText(key, CHECK_TEXT);

/**
 * Whether `key` is the record's data key, told by what the key opens (its check, else its index); null when the record has
 * neither (a record of an earlier version with nothing hidden yet: only its password can tell).
 */
export async function holdsKey(record: VaultRecord, key: CryptoKey): Promise<boolean | null> {
  if (record.check) return (await openText(key, record.check)) === CHECK_TEXT;
  if (record.index) return (await openText(key, record.index)) !== null;
  return null;
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
    const k = r.kdf as (Partial<Kdf> & Record<string, unknown>) | undefined;
    const int = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
    const kdfOk =
      !!k &&
      ((r.version === 1 && k.name === "PBKDF2" && k["hash"] === "SHA-256" && int(k["iterations"], 100_000, 10_000_000)) ||
        (r.version === 2 && k.name === "scrypt" && int(k["N"], 16_384, 1_048_576) && Number.isInteger(Math.log2(k["N"] as number)) && int(k["r"], 8, 16) && int(k["p"], 1, 4)));
    const ok =
      r.format === VAULT_FORMAT &&
      kdfOk &&
      typeof k!.salt === "string" && B64_RE.test(k!.salt) &&
      typeof r.key === "string" && B64_RE.test(r.key) && r.key.length <= 64 &&
      [r.index, r.check, r.folders].every((x) => x === undefined || (typeof x.iv === "string" && B64_RE.test(x.iv) && typeof x.data === "string" && B64_RE.test(x.data)));
    return ok ? (r as VaultRecord) : null;
  } catch {
    return null;
  }
}

/**
 * A hidden file of version 2 (0.50.53) starts with this. It stands on its own: after the magic come its header's IV (12 bytes), the
 * header's sealed length (u32, little-endian) and the sealed header (AES-GCM, the magic as associated data): JSON with the item it holds
 * (name, type, folder path, tags…), the chunk size and a random 7-byte nonce prefix. Then the file's bytes in chunks (1 MiB), each
 * sealed on its own (STREAM: nonce = prefix, chunk number as u32 big-endian, 1 on the last chunk else 0), so a cut-off, reordered or
 * swapped chunk does not open, and a file of any size is never held sealed whole. Version 1 files (IV, then one AES-GCM ciphertext)
 * are still read.
 */
export const FILE_MAGIC = "CVSTHID2";
const MAGIC = enc.encode(FILE_MAGIC);
export const FILE_CHUNK = 1 << 20;

/** Whether sealed bytes are a version 2 hidden file. */
export const isFileV2 = (b: Uint8Array): boolean => b.length >= MAGIC.length && MAGIC.every((v, i) => b[i] === v);

function streamNonce(prefix: Uint8Array, i: number, last: boolean): Uint8Array<ArrayBuffer> {
  const n = new Uint8Array(12);
  n.set(prefix);
  new DataView(n.buffer).setUint32(7, i, false);
  n[11] = last ? 1 : 0;
  return n;
}

/** Seal a file's bytes with what it holds (`item`: any JSON object), as a version 2 hidden file. */
export async function sealFile(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, item: object, chunk = FILE_CHUNK): Promise<Uint8Array<ArrayBuffer>> {
  const prefix = crypto.getRandomValues(new Uint8Array(7));
  const hiv = crypto.getRandomValues(new Uint8Array(12));
  const header = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: hiv, additionalData: MAGIC }, key, enc.encode(JSON.stringify({ v: 2, chunk, prefix: b64(prefix), item }))));
  const n = Math.max(1, Math.ceil(bytes.length / chunk));
  const start = MAGIC.length + 12 + 4 + header.length;
  const out = new Uint8Array(start + bytes.length + 16 * n);
  out.set(MAGIC);
  out.set(hiv, MAGIC.length);
  new DataView(out.buffer).setUint32(MAGIC.length + 12, header.length, true);
  out.set(header, MAGIC.length + 16);
  let at = start;
  for (let i = 0; i < n; i++) {
    const part = bytes.subarray(i * chunk, Math.min(bytes.length, (i + 1) * chunk));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: streamNonce(prefix, i, i === n - 1) }, key, part));
    out.set(ct, at);
    at += ct.length;
  }
  return out;
}

/** A version 2 file's header (what it holds, its chunking, where its chunks start), or null when it does not open with `key`. */
async function fileHeader(key: CryptoKey, b: Uint8Array<ArrayBuffer>): Promise<{ item: Record<string, unknown> | null; chunk: number; prefix: Uint8Array; start: number } | null> {
  if (!isFileV2(b) || b.length < MAGIC.length + 16) return null;
  const len = new DataView(b.buffer, b.byteOffset).getUint32(MAGIC.length + 12, true);
  const start = MAGIC.length + 16 + len;
  if (len < 16 || start > b.length) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(MAGIC.length, MAGIC.length + 12), additionalData: MAGIC }, key, b.subarray(MAGIC.length + 16, start));
    const h = JSON.parse(new TextDecoder().decode(plain)) as { v?: unknown; chunk?: unknown; prefix?: unknown; item?: unknown };
    if (h.v !== 2 || !Number.isInteger(h.chunk) || (h.chunk as number) < 1024 || (h.chunk as number) > 1 << 26 || typeof h.prefix !== "string") return null;
    const prefix = unb64(h.prefix);
    if (prefix.length !== 7) return null;
    return { item: h.item && typeof h.item === "object" ? (h.item as Record<string, unknown>) : null, chunk: h.chunk as number, prefix, start };
  } catch {
    return null;
  }
}

/**
 * A hidden file's bytes, and what it holds (version 2; null for version 1), or null when it does not open with `key` (another key,
 * or changed: a chunk that does not open fails the whole file).
 */
export async function openFile(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>): Promise<{ bytes: Uint8Array<ArrayBuffer>; item: Record<string, unknown> | null } | null> {
  if (!isFileV2(sealed)) {
    const bytes = await openBytes(key, sealed);
    return bytes && { bytes, item: null };
  }
  const h = await fileHeader(key, sealed);
  if (!h) return null;
  const rest = sealed.length - h.start;
  const whole = h.chunk + 16;
  const n = Math.max(1, Math.ceil(rest / whole));
  if (rest < 16 || rest - 16 * n < 0) return null;
  const out = new Uint8Array(rest - 16 * n);
  for (let i = 0, at = h.start, put = 0; i < n; i++) {
    const end = Math.min(sealed.length, at + whole);
    try {
      const part = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: streamNonce(h.prefix, i, i === n - 1) }, key, sealed.subarray(at, end)));
      out.set(part, put);
      put += part.length;
    } catch {
      return null;
    }
    at = end;
  }
  return { bytes: out, item: h.item };
}

/** A hidden item's file: `.hidden/<32 random hex>.bin`. */
export const HIDDEN_FILE_RE = /^\.hidden\/[0-9a-f]{32}\.bin$/;
export const isHiddenFile = (file: string | null | undefined): boolean => !!file && HIDDEN_FILE_RE.test(file);
/** A sealed file under another name: a sync tool's copy of one (`<32 hex> (1).bin`, `<32 hex>.sync-conflict-….bin`…). Never sealed again. */
export const SEALED_COPY_RE = /^\.hidden\/[0-9a-f]{32}[^/]*\.bin$/i;

/** A new name for a hidden file: random, so it says nothing about the item. */
export function hiddenFileName(): string {
  return `.hidden/${Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("")}.bin`;
}
