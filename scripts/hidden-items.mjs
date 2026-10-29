#!/usr/bin/env node
// The hidden items of a desktop workspace folder, without the app (the format is in the README, "Hidden items: the file format"):
//   node scripts/hidden-items.mjs decrypt <workspace folder> <output folder>
//       writes every hidden item's file into the output folder under its name in the library, with hidden-items.json (their names,
//       tags, notes and fields) beside them. Nothing in the workspace is changed.
//   node scripts/hidden-items.mjs encrypt <workspace folder> <file>…
//       seals each file into .hidden/ and adds it to the sealed index, so the app lists it as a hidden item. A file that came out of
//       `decrypt` (a hidden-items.json beside it names it) gets its name, tags, note and fields back; any other file must be a PNG or
//       JPEG picture (its size is read from it). For other kinds, put the file in .hidden/ while the app runs with the Hidden items
//       open: the app reads it and encrypts it. Close the app on that workspace first; the workspace needs a Hidden password.
// Both ask for the Hidden items password (or read it from stdin when it is piped). Needs only Node.js 20 or later (its built-in
// WebCrypto): PBKDF2-SHA-256 stretches the password into a key that unwraps (AES-KW) the data key; the data key opens each file and
// the index (AES-256-GCM).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { subtle } = globalThis.crypto;
const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const b64 = (b) => Buffer.from(b).toString("base64");
const HIDDEN_JSON = ".canvast/hidden.json";
const HIDDEN_FILE_RE = /^\.hidden\/[0-9a-f]{32}\.bin$/;

/** The vault of `hidden.json`: its record and data key for a password. Throws on a wrong password or a file that is not one. */
async function openVault(workspace, password) {
  const path = join(workspace, HIDDEN_JSON);
  if (!existsSync(path)) throw new Error(`no ${HIDDEN_JSON}: this workspace has no Hidden items password`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (record?.format !== "canvast-hidden" || record.version !== 1 || record.kdf?.name !== "PBKDF2" || record.kdf.hash !== "SHA-256") throw new Error(`${HIDDEN_JSON} is not a canvast vault (format canvast-hidden, version 1)`);
  const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const kek = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(record.kdf.salt), iterations: record.kdf.iterations }, base, { name: "AES-KW", length: 256 }, false, ["unwrapKey"]);
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

/** Decrypt every hidden item of `workspace` into `out`. Returns how many were written. */
export async function decryptHidden(workspace, out, password) {
  const { record, key } = await openVault(workspace, password);
  const index = await readIndex(record, key);
  mkdirSync(out, { recursive: true });
  const taken = new Set(), written = [];
  for (const item of index) {
    if (!HIDDEN_FILE_RE.test(item.file ?? "")) continue;
    const sealed = join(workspace, item.file);
    if (!existsSync(sealed)) {
      console.warn(`missing: ${item.file} (${item.name})`);
      continue;
    }
    const name = freeName(out, item.name, taken);
    writeFileSync(join(out, name), await open(key, new Uint8Array(readFileSync(sealed))));
    written.push({ ...item, writtenAs: name });
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
    // A file from `decrypt`: its entry, as it was (the same content, so the same hash).
    const listPath = join(dirname(path), "hidden-items.json");
    const before = existsSync(listPath) ? JSON.parse(readFileSync(listPath, "utf8")).find((i) => i.hash === hash) : undefined;
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

