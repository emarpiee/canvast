#!/usr/bin/env node
// The hidden items of a desktop workspace folder, without the app (the format is in the README, "Hidden items: the file format"):
//   node scripts/hidden-items.mjs decrypt <workspace folder> <output folder> [--flat]
//       writes every hidden item's file into the output folder under its name in the library, in the library folders it was in (each
//       file's own encrypted header names them: the tree comes back from the files alone), with hidden-items.json (their names, tags,
//       notes and fields, and where each was written) at the top, and hidden custom thumbnails in thumbnails/<hash>.webp (an item's
//       `thumb` names its own). --flat: every file at the top, as before. Nothing in the workspace is changed. Copies of hidden.json beside it (a sync tool's, when
//       two devices wrote it at once) are read too, each with the same password, and a sealed file in .hidden/ that no entry names (its
//       entry lost, or a sync tool's copy) is written as recovered-<hash>.<ext> when the password opens it. With hidden.json lost, the
//       spare of its key (.canvast/keys/hidden.json) opens the files, all as recovered-<hash>.<ext>.
//   node scripts/hidden-items.mjs encrypt <workspace folder> <file>…
//       seals each file into .hidden/ and adds it to the sealed index, so the app lists it as a hidden item. A file that came out of
//       `decrypt` (a hidden-items.json beside it names it) gets its name, tags, note and fields back; any other file must be a PNG or
//       JPEG picture (its size is read from it). For other kinds, put the file in .hidden/ while the app runs with the Hidden items
//       open: the app reads it and encrypts it. Close the app on that workspace first; the workspace needs a Hidden password.
// Both ask for the Hidden items password (or read it from stdin when it is piped). Needs only Node.js 20 or later, nothing installed:
// scrypt (version 2) or PBKDF2-SHA-256 (version 1) stretches the password into a key that unwraps (AES-KW) the data key; the data key
// opens each file and the index (AES-256-GCM).
import { createHash, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { subtle } = globalThis.crypto;
const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const b64 = (b) => Buffer.from(b).toString("base64");
const HIDDEN_JSON = ".canvast/hidden.json";
/** The spare of the vault's key (no index), kept beside it by the app. */
const KEY_SPARE = ".canvast/keys/hidden.json";
const HIDDEN_FILE_RE = /^\.hidden\/[0-9a-f]{32}\.bin$/;
/** A sealed file under any name a sync tool gives a copy of one. */
const SEALED_COPY_RE = /^[0-9a-f]{32}[^/]*\.bin$/i;
/** Copies of hidden.json beside it (`hidden (1).json`, `hidden.sync-conflict-….json`, or the app's own when hidden.json held another key). */
const hiddenCopies = (workspace) => {
  const dir = join(workspace, ".canvast");
  return existsSync(dir) ? readdirSync(dir).filter((n) => /^hidden[^/]*\.json$/i.test(n) && n !== "hidden.json" && !n.includes(".tmp-")).map((n) => `.canvast/${n}`) : [];
};

/** The vault of `hidden.json`: its record and data key for a password. Throws on a wrong password or a file that is not one. */
async function openVault(workspace, password, file = HIDDEN_JSON) {
  const path = join(workspace, file);
  if (!existsSync(path)) throw new Error(`no ${file}: this workspace has no Hidden items password`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  const v1 = record?.version === 1 && record.kdf?.name === "PBKDF2" && record.kdf.hash === "SHA-256";
  const v2 = record?.version === 2 && record.kdf?.name === "scrypt";
  if (record?.format !== "canvast-hidden" || !(v1 || v2)) throw new Error(`${file} is not a canvast vault (format canvast-hidden, version 1 or 2)`);
  let kek;
  if (v2) {
    // scrypt (RFC 7914), as the app does it.
    const { N, r, p, salt } = record.kdf;
    const raw = scryptSync(Buffer.from(password, "utf8"), Buffer.from(unb64(salt)), 32, { N, r, p, maxmem: 256 * N * r + 2 ** 24 });
    kek = await subtle.importKey("raw", raw, "AES-KW", false, ["unwrapKey"]);
    raw.fill(0);
  } else {
    const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    kek = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(record.kdf.salt), iterations: record.kdf.iterations }, base, { name: "AES-KW", length: 256 }, false, ["unwrapKey"]);
  }
  try {
    return { record, key: await subtle.unwrapKey("raw", unb64(record.key), kek, "AES-KW", { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) };
  } catch {
    throw new Error("wrong password");
  }
}

/** Sealed bytes: a random 12-byte IV, then the AES-GCM ciphertext with its 16-byte tag. */
async function seal(key, bytes) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Buffer.concat([iv, new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, bytes))]);
}
const open = async (key, sealed) => new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, 12) }, key, sealed.subarray(12)));

// A hidden file of version 2 (the README, "Hidden items: the file format"): the magic, the sealed header (the item it holds, its
// chunking), then its bytes in chunks sealed on their own (STREAM nonces). Version 1 is one sealed piece (`open` above).
const MAGIC = Buffer.from("CVSTHID2");
const CHUNK = 1 << 20;
const nonce = (prefix, i, last) => {
  const n = Buffer.alloc(12);
  Buffer.from(prefix).copy(n);
  n.writeUInt32BE(i, 7);
  n[11] = last ? 1 : 0;
  return n;
};
/** A version 2 hidden file of `bytes`, holding `item`. */
async function sealFile(key, bytes, item) {
  const prefix = globalThis.crypto.getRandomValues(new Uint8Array(7));
  const hiv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const header = Buffer.from(await subtle.encrypt({ name: "AES-GCM", iv: hiv, additionalData: MAGIC }, key, Buffer.from(JSON.stringify({ v: 2, chunk: CHUNK, prefix: b64(prefix), item }))));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length);
  const parts = [MAGIC, hiv, len, header];
  const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
  for (let i = 0; i < n; i++) parts.push(Buffer.from(await subtle.encrypt({ name: "AES-GCM", iv: nonce(prefix, i, i === n - 1) }, key, bytes.subarray(i * CHUNK, (i + 1) * CHUNK))));
  return Buffer.concat(parts);
}
/** A hidden file's bytes and the item it holds (null for version 1); throws when it does not open with `key`. */
async function openFile(key, sealed) {
  if (!Buffer.from(sealed.subarray(0, 8)).equals(MAGIC)) return { bytes: await open(key, sealed), item: null };
  const len = Buffer.from(sealed).readUInt32LE(20);
  const start = 24 + len;
  const h = JSON.parse(new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(8, 20), additionalData: MAGIC }, key, sealed.subarray(24, start))));
  const prefix = unb64(h.prefix), whole = h.chunk + 16, rest = sealed.length - start, n = Math.max(1, Math.ceil(rest / whole));
  const parts = [];
  for (let i = 0, at = start; i < n; i++, at += whole) parts.push(Buffer.from(await subtle.decrypt({ name: "AES-GCM", iv: nonce(prefix, i, i === n - 1) }, key, sealed.subarray(at, Math.min(sealed.length, at + whole)))));
  return { bytes: new Uint8Array(Buffer.concat(parts)), item: h.item ?? null };
}

/** The hidden items' index: the library entries of the hidden items (as in library.json), sealed in hidden.json. */
async function readIndex(record, key) {
  if (!record.index) return [];
  const all = Buffer.concat([unb64(record.index.iv), unb64(record.index.data)]);
  const list = JSON.parse(new TextDecoder().decode(await open(key, all)));
  return Array.isArray(list) ? list : [];
}

/** A name safe to write: its last part only, with no path separators or control characters; `-2`, `-3`… before the extension on a clash. */
function freeName(dir, name, taken, sub = "") {
  const clean = safePart(name, "untitled");
  const dot = clean.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? clean : `${stem}-${n}${ext}`;
    const key = sub ? `${sub}/${candidate}` : candidate;
    if (!taken.has(key) && !existsSync(join(dir, candidate))) {
      taken.add(key);
      return candidate;
    }
  }
}
/** One part of a path, safe to write: no separators, control characters or leading dots. */
const safePart = (name, fallback) => basename(String(name || fallback)).replace(/[\u0000-\u001f/\\]/g, "_").replace(/^\.+/, "") || fallback;
/** Where a file goes under the output folder: its library folders (from its own header), or the top (`flat`, or none). */
const folderOf = (item, flat) => (flat || !Array.isArray(item?.folderPath) ? "" : item.folderPath.filter((p) => typeof p === "string").map((p) => safePart(p, "Folder")).join("/"));
/** Write `bytes` as `name` in `sub` of `out` (made when missing): the path written, relative to `out`. */
function place(out, sub, name, bytes, taken) {
  const dir = sub ? join(out, ...sub.split("/")) : out;
  mkdirSync(dir, { recursive: true });
  const file = freeName(dir, name, taken, sub);
  writeFileSync(join(dir, file), bytes);
  return sub ? `${sub}/${file}` : file;
}

/** The extension a file's first bytes say it has (as the app names a recovered file), else "bin". */
function extOfBytes(b) {
  const t = (i, n) => Buffer.from(b.subarray(i, i + n)).toString("latin1");
  if (t(0, 4) === "\x89PNG") return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (t(0, 4) === "GIF8") return "gif";
  if (t(0, 4) === "RIFF") return t(8, 4) === "WEBP" ? "webp" : t(8, 4) === "WAVE" ? "wav" : "bin";
  if (t(4, 4) === "ftyp") return /^(avif|avis)/.test(t(8, 4)) ? "avif" : t(8, 2) === "qt" ? "mov" : /^M4A/.test(t(8, 4)) ? "m4a" : "mp4";
  if (t(0, 4) === "\x1aE\xdf\xa3") return "webm";
  if (t(0, 2) === "BM") return "bmp";
  if (t(0, 4) === "%PDF") return "pdf";
  if (t(0, 3) === "ID3" || (b[0] === 0xff && b[1] === 0xfb)) return "mp3";
  if (t(0, 4) === "OggS") return "ogg";
  if (t(0, 4) === "fLaC") return "flac";
  if (t(0, 4) === "wOFF") return "woff";
  if (t(0, 4) === "wOF2") return "woff2";
  if (t(0, 4) === "OTTO") return "otf";
  if (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) return "ttf";
  if (t(0, 4) === "PK\x03\x04") return "zip";
  if (/<svg[\s>]/.test(Buffer.from(b.subarray(0, 1024)).toString("utf8"))) return "svg";
  return "bin";
}

/**
 * Decrypt every hidden item of `workspace` into `out`: those of hidden.json and of each copy beside it the password opens, then every
 * sealed file of .hidden/ no entry named that one of their keys opens (as recovered-<hash>.<ext>). Returns how many were written.
 */
export async function decryptHidden(workspace, out, password, { flat = false } = {}) {
  const vaults = [];
  let failed = null;
  // hidden.json, the copies a sync tool left beside it, and the spare of its key (when hidden.json is lost: files then come out as recovered-…).
  for (const file of [HIDDEN_JSON, ...hiddenCopies(workspace), KEY_SPARE]) {
    if (!existsSync(join(workspace, file))) continue;
    try {
      vaults.push(await openVault(workspace, password, file));
    } catch (e) {
      failed ??= e;
      if (file !== KEY_SPARE) console.warn(`${file}: ${e.message}`);
    }
  }
  if (!vaults.length) throw failed ?? new Error(`no ${HIDDEN_JSON}: this workspace has no Hidden items password`);
  const tryOpen = async (sealed) => {
    for (const v of vaults) {
      try {
        return await openFile(v.key, sealed);
      } catch {
        // another key
      }
    }
    return null;
  };
  mkdirSync(out, { recursive: true });
  const taken = new Set(), written = [], hashes = new Set(), files = new Set();
  for (const v of vaults) {
    for (const item of await readIndex(v.record, v.key)) {
      if (!HIDDEN_FILE_RE.test(item.file ?? "") || hashes.has(item.hash)) continue;
      const sealed = join(workspace, item.file);
      if (!existsSync(sealed)) {
        console.warn(`missing: ${item.file} (${item.name})`);
        continue;
      }
      const opened = await tryOpen(new Uint8Array(readFileSync(sealed)));
      if (!opened) {
        console.warn(`does not open: ${item.file} (${item.name})`);
        continue;
      }
      const name = place(out, folderOf(opened.item, flat), item.name, opened.bytes, taken);
      written.push({ ...item, writtenAs: name });
      hashes.add(item.hash);
      files.add(item.file);
    }
  }
  // Sealed files no entry names: their entries were lost (or each is a sync tool's copy of one written above, then skipped by its content).
  const dir = join(workspace, ".hidden");
  for (const n of existsSync(dir) ? readdirSync(dir).filter((n) => SEALED_COPY_RE.test(n)).sort() : []) {
    if (files.has(`.hidden/${n}`)) continue;
    const opened = await tryOpen(new Uint8Array(readFileSync(join(dir, n))));
    if (!opened) {
      console.warn(`does not open with this password: .hidden/${n}`);
      continue;
    }
    const { bytes, item: own } = opened;
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(hash)) continue;
    // A version 2 file says what it was (its name, folder, tags…); one of version 1 is named by its content.
    const mine = own?.hash === hash && typeof own.name === "string";
    const name = place(out, mine ? folderOf(own, flat) : "", mine ? own.name : `recovered-${hash.slice(0, 12)}.${extOfBytes(bytes)}`, bytes, taken);
    written.push(own?.hash === hash ? { ...own, file: `.hidden/${n}`, hidden: true, writtenAs: name } : { hash, name, file: `.hidden/${n}`, size: bytes.length, recovered: true, writtenAs: name });
    hashes.add(hash);
  }
  // Hidden custom thumbnails (`.hidden/thumbnails/`): each as thumbnails/<hash>.webp, which an item's `thumb` names.
  const thumbDir = join(workspace, ".hidden", "thumbnails");
  for (const n of existsSync(thumbDir) ? readdirSync(thumbDir).filter((x) => x.endsWith(".bin")).sort() : []) {
    const opened = await tryOpen(new Uint8Array(readFileSync(join(thumbDir, n))));
    const h = opened?.item?.kind === "thumbnail" && typeof opened.item.hash === "string" && /^[0-9a-f]{64}$/.test(opened.item.hash) ? opened.item.hash : null;
    if (!h) continue;
    mkdirSync(join(out, "thumbnails"), { recursive: true });
    writeFileSync(join(out, "thumbnails", `${h}.webp`), opened.bytes);
  }
  writeFileSync(join(out, freeName(out, "hidden-items.json", taken)), JSON.stringify(written, null, 1));
  return written.length;
}

/** The pixel size of a PNG or JPEG, with its type, or null for any other file. */
function pictureOf(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString("latin1", 12, 16) === "IHDR") return { type: "image/png", w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1], len = bytes.readUInt16BE(i + 2);
      // (a start of frame: baseline, extended, progressive or lossless, not DHT, JPG or DAC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: "image/jpeg", w: bytes.readUInt16BE(i + 7), h: bytes.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** Seal `files` into `workspace`'s .hidden/ and add them to its index. Returns how many were added (a file already hidden is skipped). */
export async function encryptHidden(workspace, files, password) {
  const { record, key } = await openVault(workspace, password);
  const index = await readIndex(record, key);
  const known = new Set(index.map((i) => i.hash));
  const plans = [];
  for (const path of files) {
    const bytes = readFileSync(path);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (known.has(hash)) {
      console.warn(`already hidden: ${path}`);
      continue;
    }
    // A file from `decrypt`: its entry, as it was (the same content, so the same hash); a recovered one had none.
    // (looked for beside it and in the folders above it: `decrypt` puts it at the top of the folder tree it writes)
    let listPath = dirname(path);
    for (let up = 0; up < 64 && !existsSync(join(listPath, "hidden-items.json")) && dirname(listPath) !== listPath; up++) listPath = dirname(listPath);
    listPath = join(listPath, "hidden-items.json");
    const before = existsSync(listPath) ? JSON.parse(readFileSync(listPath, "utf8")).find((i) => i.hash === hash && !i.recovered) : undefined;
    let entry;
    if (before) {
      const { writtenAs: _w, ...rest } = before;
      entry = rest;
    } else {
      const pic = pictureOf(bytes);
      if (!pic || !pic.w || !pic.h) throw new Error(`${path}: only PNG and JPEG pictures (or files from decrypt) can be encrypted here; put other files in .hidden/ while the app runs`);
      entry = { hash, name: basename(path), type: pic.type, size: bytes.length, pixelW: pic.w, pixelH: pic.h, importedAt: Date.now(), tags: [], favorite: false, folderId: null, note: "", fields: [], state: "active" };
    }
    const file = `.hidden/${Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString("hex")}.bin`;
    const full = { ...entry, hash, size: bytes.length, hidden: true };
    const { folderPath = [], file: _old, ...indexed } = full;
    plans.push({ entry: { ...indexed, file }, sealed: await sealFile(key, bytes, { ...indexed, folderPath }), path });
    known.add(hash);
  }
  if (!plans.length) return 0;
  // The files first (each read back and opened, to prove it), then the index in one write: a stop half-way leaves unlisted files, never a listed file that is not there.
  mkdirSync(join(workspace, ".hidden"), { recursive: true });
  for (const p of plans) {
    const dest = join(workspace, p.entry.file);
    writeFileSync(`${dest}.part`, p.sealed);
    if (!Buffer.from((await openFile(key, new Uint8Array(readFileSync(`${dest}.part`)))).bytes).equals(readFileSync(p.path))) throw new Error(`${p.path}: the sealed copy did not read back`);
    renameSync(`${dest}.part`, dest);
  }
  const text = new TextEncoder().encode(JSON.stringify([...index, ...plans.map((p) => p.entry)]));
  const sealedIndex = await seal(key, text);
  const next = { ...record, index: { iv: b64(sealedIndex.subarray(0, 12)), data: b64(sealedIndex.subarray(12)) } };
  writeFileSync(join(workspace, `${HIDDEN_JSON}.part`), JSON.stringify(next, null, 1));
  renameSync(join(workspace, `${HIDDEN_JSON}.part`), join(workspace, HIDDEN_JSON));
  return plans.length;
}

/** The password, typed without being shown (or read from stdin when it is not a terminal). */
async function askPassword() {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) return (await new Promise((ok) => { let s = ""; stdin.on("data", (d) => (s += d)).on("end", () => ok(s)); })).replace(/\r?\n$/, "");
  stderr.write("Hidden items password: ");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((ok) => {
    let s = "";
    stdin.on("data", function on(d) {
      for (const c of d.toString("utf8")) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", on);
          stderr.write("\n");
          return ok(s);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f") s = s.slice(0, -1);
        else s += c;
      }
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, workspace, ...rest] = process.argv.slice(2);
  const usage = "usage: node scripts/hidden-items.mjs decrypt <workspace folder> <output folder> [--flat]\n       node scripts/hidden-items.mjs encrypt <workspace folder> <file>…";
  const flat = mode === "decrypt" && rest.includes("--flat");
  if (flat) rest.splice(rest.indexOf("--flat"), 1);
  if (!workspace || !rest.length || (mode !== "decrypt" && mode !== "encrypt") || (mode === "decrypt" && rest.length !== 1)) {
    console.error(usage);
    process.exit(2);
  }
  try {
    const password = await askPassword();
    if (mode === "decrypt") {
      const n = await decryptHidden(resolve(workspace), resolve(rest[0]), password, { flat });
      console.log(`${n} hidden item${n === 1 ? "" : "s"} written to ${resolve(rest[0])}`);
    } else {
      const n = await encryptHidden(resolve(workspace), rest.map((f) => resolve(f)), password);
      console.log(`${n} file${n === 1 ? "" : "s"} sealed into ${join(resolve(workspace), ".hidden")} (the readable files are left where they are: delete them yourself)`);
    }
  } catch (e) {
    console.error(`hidden-items: ${e.message}`);
    process.exit(1);
  }
}

