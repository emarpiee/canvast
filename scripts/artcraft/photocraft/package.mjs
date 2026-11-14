// PhotoCraft (https://github.com/storytold/photocraft, MIT OR Apache-2.0) inside the single file: its released web build, as it is.
// Nothing of it is built or changed here. This helper downloads the zip named in release.json (once, into node_modules/.cache), checks
// its SHA-256, and hands the build what the app needs to start it in a frame of its own (src/artcraft/photocraft/): the page's style and body,
// its wasm-bindgen code (made into one inline module: the few lines it imports from snippets/ are put in front of it), and its
// WebAssembly as the release ships it (gzip, base64). Anything in the release this does not recognise stops the build with what changed,
// so a new release is looked at (npm run photocraft:check) before it can reach the app.
//   CANVAST_PHOTOCRAFT=off: build without it (the app then says PhotoCraft is not in this build).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

export const RELEASE_FILE = "scripts/artcraft/photocraft/release.json";

export async function releaseInfo(root) {
  return JSON.parse(await readFile(resolve(root, RELEASE_FILE), "utf8"));
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Downloads `url` (following redirects), trying a few times. */
export async function download(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
  throw new Error(`PhotoCraft: could not download ${url}: ${last?.message ?? last}`);
}

/** The release zip, from the cache or downloaded, checked against its SHA-256. */
export async function releaseZip(root, info) {
  const cached = resolve(root, "node_modules/.cache/artcraft/photocraft", `photocraft-web-${info.version}.zip`);
  const have = await readFile(cached).catch(() => null);
  if (have && sha256(have) === info.sha256) return have;
  const got = await download(info.zip);
  const sum = sha256(got);
  if (sum !== info.sha256) throw new Error(`PhotoCraft: ${info.zip} has SHA-256 ${sum}, release.json says ${info.sha256}`);
  await mkdir(dirname(cached), { recursive: true });
  await writeFile(cached, got);
  return got;
}

/** The files of a zip (stored or deflated), by path. */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("PhotoCraft: the release is not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("PhotoCraft: a damaged zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`PhotoCraft: ${name} is packed in a way this helper does not read (method ${method})`);
  }
  return files;
}

/** The web build's files without the release's top folder (`photocraft-web-<version>/`). */
export function webFiles(zip) {
  const out = new Map();
  for (const [name, data] of zip) {
    const i = name.indexOf("/");
    out.set(i >= 0 ? name.slice(i + 1) : name, data);
  }
  return out;
}

/**
 * The wasm-bindgen code made into one inline module: each `import … from './snippets/…'` becomes the snippet's functions defined in
 * front of it, and its exports become one global the frame calls (`__photocraftInit`). What it cannot place is an error.
 */
export function inlineGlue(glue, readSnippet) {
  const modules = new Map(); // path -> variable
  let head = "";
  const varFor = (path) => {
    if (modules.has(path)) return modules.get(path);
    const text = readSnippet(path.replace(/^\.\//, ""));
    if (text == null) throw new Error(`PhotoCraft: the code imports ${path}, which is not in the release`);
    const names = [...text.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
    const rest = text.replace(/^export function /gm, "function ");
    if (/^\s*(export|import)\b/m.test(rest)) throw new Error(`PhotoCraft: ${path} exports or imports in a way this helper does not read`);
    const v = `__photocraftSnippet${modules.size}`;
    head += `const ${v} = (() => {\n${rest}\nreturn { ${names.join(", ")} };\n})();\n`;
    modules.set(path, v);
    return v;
  };
  let out = glue
    .replace(/^import \{([^}]*)\} from ['"](\.\/snippets\/[^'"]+)['"];?$/gm, (_m, names, path) => `const {${names.replace(/\bas\b/g, ":")}} = ${varFor(path)};`)
    .replace(/^import \* as (\w+) from ['"](\.\/snippets\/[^'"]+)['"];?$/gm, (_m, name, path) => `const ${name} = ${varFor(path)};`);
  const exportLine = /^export \{ initSync, __wbg_init as default \};?$/m;
  if (!exportLine.test(out)) throw new Error("PhotoCraft: the code's exports changed (export { initSync, __wbg_init as default } not found)");
  out = out.replace(exportLine, "globalThis.__photocraftInit = __wbg_init;");
  if (/^\s*(import|export)\b/m.test(out)) throw new Error("PhotoCraft: the code imports or exports something this helper does not place");
  return head + out;
}

/** The page's own style and the body the app looks for (its canvas, loading and stopped messages). */
export function pageParts(indexHtml) {
  const style = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)?.[1];
  const body = /<body>([\s\S]*?)<\/body>/.exec(indexHtml)?.[1];
  if (!style || !body) throw new Error("PhotoCraft: its index.html has no <style> or <body> where this helper looks");
  for (const id of ["photocraft_canvas", "photocraft_loading", "photocraft_stopped"]) {
    if (!body.includes(`id="${id}"`)) throw new Error(`PhotoCraft: its page has no #${id} any more`);
  }
  if (/<script/i.test(body)) throw new Error("PhotoCraft: its page's body has a script now");
  return { style: style.trim(), body: body.trim() };
}

/** The app's WebAssembly as shipped (its gzip parts, joined in order). */
export function wasmGzip(files) {
  const list = files.get("app/parts.txt")?.toString("utf8").trim().split(/\r?\n/);
  if (!list || !/^photocraft-parts 1$/.test(list[0])) throw new Error("PhotoCraft: app/parts.txt is missing or of a new kind");
  const parts = list.slice(1).map((n) => {
    const b = files.get(`app/${n.trim()}`);
    if (!b) throw new Error(`PhotoCraft: part ${n} is missing`);
    return b;
  });
  const gz = Buffer.concat(parts);
  if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error("PhotoCraft: the app's parts are not gzip");
  return gz;
}

/** Everything the frame needs, from the release's files. */
export function payloadOf(files, version) {
  const glueText = files.get("app/photocraft-web.js")?.toString("utf8");
  if (!glueText) throw new Error("PhotoCraft: app/photocraft-web.js is missing");
  const glue = inlineGlue(glueText, (p) => files.get(p)?.toString("utf8") ?? null);
  // (its code fetches nothing by address: a new address in it is looked at before it ships)
  const url = /(?:https?|wss?):\/\/[^\s"'`)]+/.exec(glue);
  if (url) throw new Error(`PhotoCraft: its code names an address now (${url[0]})`);
  const page = pageParts(files.get("index.html")?.toString("utf8") ?? "");
  const wasm = wasmGzip(files).toString("base64");
  const notice = ["NOTICE", "LICENSE-MIT", "LICENSE-APACHE"].map((f) => files.get(f)?.toString("utf8") ?? "").join("\n\n").trim();
  return { version, ...page, glue, wasm, notice };
}

/**
 * For build.mjs: the `<script type="application/json" id="photocraft-data">` block (read by src/artcraft/photocraft/payload.ts when PhotoCraft
 * first opens: it is never run) and the licence text for the notices, or null when built without it.
 */
export async function photocraftBlock(root) {
  if (process.env.CANVAST_PHOTOCRAFT === "off") return null;
  const info = await releaseInfo(root);
  const files = webFiles(unzip(await releaseZip(root, info)));
  const p = payloadOf(files, info.version);
  const json = JSON.stringify({ version: p.version, style: p.style, body: p.body, glue: p.glue, wasm: p.wasm }).replace(/</g, "\\u003c");
  return { version: info.version, notice: p.notice, html: `<script type="application/json" id="photocraft-data">${json}</script>` };
}
