#!/usr/bin/env node
// The hidden items of a desktop workspace folder, without the app (the format is in the README, "Hidden items: the file format"):
//   node scripts/hidden-items.mjs decrypt <workspace folder> <output folder>
//       writes every hidden item's file into the output folder under its name in the library, with hidden-items.json (their names,
//       tags, notes and fields) beside them. Nothing in the workspace is changed. Copies of hidden.json beside it (a sync tool's, when
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

/** The hidden items' index: the library entries of the hidden items (as in library.json), sealed in hidden.json. */
async function readIndex(record, key) {
  if (!record.index) return [];
  const all = Buffer.concat([unb64(record.index.iv), unb64(record.index.data)]);
  const list = JSON.parse(new TextDecoder().decode(await open(key, all)));
  return Array.isArray(list) ? list : [];
}

/** A name safe to write: its last part only, with no path separators or control characters; `-2`, `-3`… before the extension on a clash. */
function freeName(dir, name, taken) {
  const clean = basename(String(name || "untitled")).replace(/[\u0000-\u001f/\\]/g, "_").replace(/^\.+/, "") || "untitled";
  const dot = clean.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? clean : `${stem}-${n}${ext}`;
    if (!taken.has(candidate) && !existsSync(join(dir, candidate))) {
      taken.add(candidate);
      return candidate;
    }
  }
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
export async function decryptHidden(workspace, out, password) {
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
        return await open(v.key, sealed);
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
      const bytes = await tryOpen(new Uint8Array(readFileSync(sealed)));
      if (!bytes) {
        console.warn(`does not open: ${item.file} (${item.name})`);
        continue;
      }
      const name = freeName(out, item.name, taken);
      writeFileSync(join(out, name), bytes);
      written.push({ ...item, writtenAs: name });
      hashes.add(item.hash);
      files.add(item.file);
    }
  }
  // Sealed files no entry names: their entries were lost (or each is a sync tool's copy of one written above, then skipped by its content).
  const dir = join(workspace, ".hidden");
  for (const n of existsSync(dir) ? readdirSync(dir).filter((n) => SEALED_COPY_RE.test(n)).sort() : []) {
    if (files.has(`.hidden/${n}`)) continue;
    const bytes = await tryOpen(new Uint8Array(readFileSync(join(dir, n))));
    if (!bytes) {
      console.warn(`does not open with this password: .hidden/${n}`);
      continue;
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(hash)) continue;
    const name = freeName(out, `recovered-${hash.slice(0, 12)}.${extOfBytes(bytes)}`, taken);
    writeFileSync(join(out, name), bytes);
    written.push({ hash, name, file: `.hidden/${n}`, size: bytes.length, recovered: true, writtenAs: name });
    hashes.add(hash);
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
    const listPath = join(dirname(path), "hidden-items.json");
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
    plans.push({ entry: { ...entry, hash, size: bytes.length, file, hidden: true }, sealed: await seal(key, bytes), path });
    known.add(hash);
  }
  if (!plans.length) return 0;
  // The files first (each read back and opened, to prove it), then the index in one write: a stop half-way leaves unlisted files, never a listed file that is not there.
  mkdirSync(join(workspace, ".hidden"), { recursive: true });
  for (const p of plans) {
    const dest = join(workspace, p.entry.file);
    writeFileSync(`${dest}.part`, p.sealed);
    if (!Buffer.from(await open(key, new Uint8Array(readFileSync(`${dest}.part`)))).equals(readFileSync(p.path))) throw new Error(`${p.path}: the sealed copy did not read back`);
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
  const usage = "usage: node scripts/hidden-items.mjs decrypt <workspace folder> <output folder>\n       node scripts/hidden-items.mjs encrypt <workspace folder> <file>…";
  if (!workspace || !rest.length || (mode !== "decrypt" && mode !== "encrypt") || (mode === "decrypt" && rest.length !== 1)) {
    console.error(usage);
    process.exit(2);
  }
  try {
    const password = await askPassword();
    if (mode === "decrypt") {
      const n = await decryptHidden(resolve(workspace), resolve(rest[0]), password);
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

