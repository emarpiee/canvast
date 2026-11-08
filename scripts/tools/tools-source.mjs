#!/usr/bin/env node
// canvast tools: what you can do with a canvast workspace folder, or any folder, without the app. One file; needs only Node.js 20 or later.
//   node canvast-tools.mjs                      a menu: pick what to do, drag folders in, answer in plain words
//   node canvast-tools.mjs decrypt <workspace> <output folder> [--flat]
//   node canvast-tools.mjs encrypt <workspace> <file>…
//   node canvast-tools.mjs share <folder> [--hidden] [--write] [--devices | --only-devices] [--port N] [--password P] [--dotfiles]
//   node canvast-tools.mjs devices              the saved devices that may sign in to a shared folder
// ⚠️ This is the tools' SOURCE: it needs the rest of the repository and does not run on its own. The file to run (or give anyone) is
// the built one, dist-tools/canvast-tools.mjs (`npm run build:tools`), or canvast-tools.mjs from a release.
// The released file is built from this one and the app's own code (desktop/share-dav.ts, desktop/self-cert.ts) by
// scripts/tools/build-tools.mjs; decrypting and encrypting are scripts/hidden-items.mjs's.
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { homedir, networkInterfaces, platform } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { davHandle, READ_ONLY } from "../../desktop/share-dav.ts";
import { makeSelfCert } from "../../desktop/self-cert.ts";
import { askPassword, decryptHidden, encryptHidden, hiddenFolder } from "../hidden-items.mjs";

// ---- where the tools keep their own things: the saved devices and the certificate (never in a shared folder) ----
export const configDir = () =>
  process.env.CANVAST_TOOLS_HOME ??
  (platform() === "win32" ? join(process.env.APPDATA ?? homedir(), "canvast-tools") : platform() === "darwin" ? join(homedir(), "Library", "Application Support", "canvast-tools") : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "canvast-tools"));
/** Written whole or not at all, readable by this user only. */
function keep(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}
const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
export const loadDevices = () => readJson(join(configDir(), "devices.json"), { devices: [] }).devices ?? [];
export const saveDevices = (devices) => keep(join(configDir(), "devices.json"), { devices });
const newPassword = () => randomBytes(9).toString("base64url");
/** A device's own login: its user name from its name, unique among `devices`. */
export function newDevice(name, devices, rights = { add: false, edit: false, move: false, delete: false, hidden: false }) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "device";
  let user = base;
  for (let k = 2; devices.some((d) => d.user === user); k++) user = `${base}-${k}`;
  return { id: randomBytes(8).toString("hex"), name: name.trim().slice(0, 60), user, password: newPassword(), rights, added: Date.now() };
}
const rightsWords = (r) => [r.add && "add", r.edit && "edit", r.move && "move", r.delete && "delete (into .trash)", r.hidden && "see hidden items"].filter(Boolean).join(", ") || "read only";

// ---- a folder, as the folder for file managers reads and changes it ----
const TMP = /(?:^|\/)\.tmp-[0-9a-f-]{36}$/;
/**
 * A folder on disk as one root of the shared folder: its files (in its folders; never a link, never what leaves it, and names starting
 * with a dot only with `dotfiles`), any part of one, and, with `write`, the changes a device may make (deleting moves into `trash`).
 */
export function folderRoot(dir, { write = false, dotfiles = false, trash = join(dir, ".trash") } = {}) {
  dir = resolve(dir);
  let at = 0;
  let last = Promise.resolve([]);
  const walk = async () => {
    const out = [];
    const go = async (full, rel) => {
      for (const e of await readdir(full, { withFileTypes: true }).catch(() => [])) {
        if (e.name === ".trash" || TMP.test(e.name) || (!dotfiles && e.name.startsWith("."))) continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await go(join(full, e.name), p);
        else if (e.isFile()) {
          const s = await stat(join(full, e.name)).catch(() => null);
          if (s) out.push({ path: p, size: s.size, at: s.mtimeMs });
        }
      }
    };
    await go(dir, "");
    return out;
  };
  const inside = (p) => {
    const full = resolve(dir, ...p.split("/"));
    if (full !== dir && !full.startsWith(dir + sep)) throw new Error("outside the shared folder");
    return full;
  };
  const root = {
    list: () => {
      if (Date.now() - at > 3000) (at = Date.now()), (last = walk());
      return last;
    },
    read: async (p, from, to) => {
      const full = inside(p);
      if (lstatSync(full, { throwIfNoEntry: false })?.isFile() !== true) return null;
      const fd = openSync(full, "r");
      try {
        const b = Buffer.alloc(Math.max(0, to - from));
        return new Uint8Array(b.subarray(0, readSync(fd, b, 0, b.length, from)));
      } finally {
        closeSync(fd);
      }
    },
    changed: () => void (at = 0),
  };
  if (write)
    root.writes = {
      put: async (p, bytes) => {
        const full = inside(p);
        await mkdir(dirname(full), { recursive: true });
        const tmp = join(dirname(full), `.tmp-${randomUUID()}`);
        await writeFile(tmp, bytes);
        await rename(tmp, full);
      },
      mkdir: async (p) => void (await mkdir(inside(p), { recursive: true })),
      remove: async (p) => {
        const to = join(trash, `${new Date().toISOString().replace(/[:.]/g, "-")}-${basename(inside(p))}`);
        await mkdir(trash, { recursive: true });
        await rename(inside(p), to);
      },
      move: async (from, to) => {
        await mkdir(dirname(inside(to)), { recursive: true });
        await rename(inside(from), inside(to));
      },
    };
  return root;
}

/** A canvast workspace folder (its `.canvast/workspace.json`), or the folder of `.hidden` and a loose `hidden.json`. */
const isWorkspace = (dir) => existsSync(join(dir, ".canvast", "workspace.json"));
const hasHidden = (dir) => existsSync(join(dir, ".hidden")) && (existsSync(join(dir, ".canvast", "hidden.json")) || existsSync(join(dir, "hidden.json")));

const addresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);

/**
 * Share `folder` with other devices as a folder for file managers (WebDAV over HTTPS, the app's own code). A workspace gives
 * *Library*, and *Hidden* when `hiddenPassword` opens its hidden items (each decrypted only as it is read); any other folder is
 * shared as it is. Who signs in: one login for this run (`password`, or a new one) and, with `devices`, the saved devices.
 */
export async function shareFolder(folder, { hiddenPassword = null, write = false, port = 8484, password = null, devices = false, runLogin = true, dotfiles = false, host = "0.0.0.0", log = console.log } = {}) {
  folder = resolve(folder);
  const own = resolve(configDir());
  if (own === folder || own.startsWith(folder + sep)) throw new Error("This folder holds the tools' own settings (saved devices): share another one.");
  const roots = {};
  if (isWorkspace(folder)) {
    roots.Library = folderRoot(join(folder, "library"), { write, dotfiles, trash: join(folder, ".trash") });
    if (hiddenPassword !== null) {
      const hidden = await hiddenFolder(folder, hiddenPassword);
      roots.Hidden = { hidden: true, list: async () => hidden.list(), read: hidden.read };
    }
  } else {
    if (hiddenPassword !== null && hasHidden(folder)) {
      const hidden = await hiddenFolder(folder, hiddenPassword);
      roots.Hidden = { hidden: true, list: async () => hidden.list(), read: hidden.read };
    }
    roots[basename(folder) || "Folder"] = folderRoot(folder, { write, dotfiles });
  }
  const rights = { ...(write ? { add: true, edit: true, move: true, delete: true } : READ_ONLY), hidden: hiddenPassword !== null };
  const run = runLogin ? { id: "run", name: "canvast", user: "canvast", password: password ?? newPassword(), rights, added: Date.now() } : null;
  const logins = () => [...(run ? [run] : []), ...(devices ? loadDevices() : [])];
  // (the same certificate every run, so a device trusts it once)
  const certFile = join(configDir(), "certificate.json");
  let cert = readJson(certFile, null);
  if (!cert?.key || !cert?.cert) keep(certFile, (cert = makeSelfCert("canvast tools", 10, addresses())));
  const seenBy = new Set();
  const seen = (req, who, what, detail) => {
    const from = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    const app = (req.headers["user-agent"] ?? "a WebDAV app").split(/[ /(]/)[0];
    const at = new Date().toLocaleTimeString();
    if (what === "wrong password") return log(`${at}  not signed in (${from}, ${app}): ${detail ?? "wrong user name or password"}`);
    if (what === "request" && !seenBy.has(`${from}|${who}`)) (seenBy.add(`${from}|${who}`), log(`${at}  ${who} signed in from ${from} (${app})`));
    if (what === "opened" || what === "changed") log(`${at}  ${who}: ${what === "opened" ? "opened " : ""}${detail}`);
  };
  const server = createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    const path = new URL(req.url ?? "/", "https://x").pathname;
    if (path === "/" || path === "/dav") return void res.writeHead(301, { location: "/dav/" }).end();
    if (!path.startsWith("/dav/")) return void res.writeHead(404).end();
    davHandle(req, res, roots, { logins, shared: () => null }, seen).catch((e) => {
      log(`error: ${e.message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const listen = (p) =>
    new Promise((ok, fail) => {
      server.once("error", fail);
      server.listen(p, host, () => (server.off("error", fail), ok(server.address().port)));
    });
  const at = await listen(port).catch((e) => (e.code === "EADDRINUSE" && port !== 0 ? listen(0) : Promise.reject(e)));
  return { port: at, run, roots: Object.keys(roots), fingerprint: cert.fingerprint, urls: addresses().map((a) => `https://${a}:${at}/dav/`), close: () => new Promise((ok) => server.close(() => ok())) };
}

// ---- talking with a person ----
/** A path as a terminal gives it when a folder or file is dragged in: quotes, `\ `, a file:// address. */
export function cleanPath(s) {
  let p = s.trim();
  if (/^(['"]).*\1$/.test(p)) p = p.slice(1, -1);
  if (p.startsWith("file://")) p = fileURLToPath(p);
  return resolve(p.replace(/\\ /g, " "));
}
/** The folder this tool is in (kept there to work on that folder: Enter picks it). */
export const toolFolder = () => dirname(fileURLToPath(import.meta.url));
/** Several dragged paths on one line. */
export const cleanPaths = (s) => [...s.matchAll(/'([^']*)'|"([^"]*)"|((?:\\ |\S)+)/g)].map((m) => cleanPath(m[1] ?? m[2] ?? m[3]));

function terminal() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  let muted = false;
  const write = rl._writeToOutput?.bind(rl);
  if (write) rl._writeToOutput = (s) => (muted ? s.includes("\n") && write("\n") : write(s));
  const ask = async (q, fallback = "") => ((await rl.question(q)).trim() || fallback);
  const yes = async (q, def = false) => {
    const a = (await ask(`${q} ${def ? "(Y/n)" : "(y/N)"} `)).toLowerCase();
    return a ? a.startsWith("y") : def;
  };
  const secret = async (q) => {
    process.stdout.write(q);
    muted = true;
    try {
      return await rl.question("");
    } finally {
      muted = false;
    }
  };
  /** A folder: dragged in, or this tool's own folder with Enter when it fits (the tool kept in the folder it works on); `b` goes back. */
  const folder = async (q, ok, why) => {
    const here = toolFolder();
    const fits = existsSync(here) && ok(here);
    for (;;) {
      const a = await ask(`${q}${fits ? `\n  (or press Enter for this tool's own folder: ${here})` : ""}\n  (b to go back)\n> `);
      if (a.toLowerCase() === "b" || (!a && !fits)) return null;
      const p = a ? cleanPath(a) : here;
      if (existsSync(p) && ok(p)) return p;
      console.log(`  ${existsSync(p) ? why : "That folder is not there."} Try again, or b to go back.`);
    }
  };
  return { rl, ask, yes, secret, folder };
}

async function decryptFlow(t) {
  console.log("\nOpen your hidden items: they are decrypted into a new folder. Nothing in the workspace is changed.");
  const ws = await t.folder("Drag the workspace folder (or the folder with .hidden and hidden.json) here, then press Enter.", hasHidden, "No hidden items there (a .hidden folder and hidden.json).");
  if (!ws) return;
  const out = cleanPath(await t.ask(`Where to put them [${ws}-decrypted]: `, `${ws}-decrypted`));
  console.log(`\n  From: ${ws}\n  To:   ${out}`);
  if (!(await t.yes("Go?", true))) return;
  for (;;) {
    const pw = await t.secret("Hidden items password: ");
    try {
      const n = await decryptHidden(ws, out, pw);
      return console.log(`\n✓ ${n} hidden item${n === 1 ? "" : "s"} written to ${out}\n  They are readable there: delete the folder when you are done.`);
    } catch (e) {
      console.log(`✗ ${/wrong password/.test(e.message) ? "Wrong password." : e.message}`);
      if (!(await t.yes("Try again?", true))) return;
    }
  }
}

async function encryptFlow(t) {
  console.log("\nHide files into a workspace: each is encrypted into its .hidden folder and listed with its hidden items.\n  Close canvast on that workspace first. The files you pick stay where they are: delete them yourself after.");
  const ws = await t.folder("Drag the workspace folder here, then press Enter.", isWorkspace, "That is not a canvast workspace (no .canvast/workspace.json).");
  if (!ws) return;
  const files = cleanPaths(await t.ask("Drag the files to hide (one or more), then press Enter: ")).filter((f) => existsSync(f));
  if (!files.length) return console.log("  No files found.");
  console.log(`\n  Into: ${ws}\n  ${files.length} file${files.length === 1 ? "" : "s"}: ${files.map((f) => basename(f)).join(", ")}`);
  if (!(await t.yes("Go?", true))) return;
  const pw = await t.secret("Hidden items password: ");
  try {
    const n = await encryptHidden(ws, files, pw);
    console.log(`\n✓ ${n} file${n === 1 ? "" : "s"} hidden. Open canvast to see them in hidden mode.`);
  } catch (e) {
    console.log(`✗ ${/wrong password/.test(e.message) ? "Wrong password." : e.message}`);
  }
}

function printShare(s, folder, write) {
  console.log(`\nSharing ${folder}\n  as: ${s.roots.join(", ")}${write ? " (other devices can change files; deleted ones go to .trash)" : " (read only)"}`);
  console.log(`\n  On another device (a WebDAV server, https):\n${s.urls.map((u) => `    ${u}`).join("\n") || "    (no network found)"}\n  On this computer: davs://127.0.0.1:${s.port}/dav/`);
  if (s.run) console.log(`\n  User name: ${s.run.user}\n  Password:  ${s.run.password}   (this run only${s.run.rights.hidden ? "; sees the hidden items" : ""})`);
  const saved = loadDevices();
  if (saved.length && s.devices) console.log(`  Saved devices that can sign in too: ${saved.map((d) => `${d.name} (${d.user})`).join(", ")}`);
  console.log(`\n  The device asks once to trust this computer's certificate: ${s.fingerprint}\n  Press Ctrl+C to stop sharing.\n`);
}

async function shareFlow(t) {
  console.log("\nShare a folder with another device on this network (a phone, a laptop), as a folder its file manager opens.");
  const folder = await t.folder("Drag the folder to share here, then press Enter.", (p) => lstatSync(p).isDirectory(), "That is a file, not a folder.");
  if (!folder) return;
  let hiddenPassword = null;
  if (hasHidden(folder) && (await t.yes(`This ${isWorkspace(folder) ? "workspace" : "folder"} has hidden items. Share them too (decrypted as they are read, for devices allowed to)?`))) {
    for (;;) {
      const pw = await t.secret("Hidden items password: ");
      try {
        await hiddenFolder(folder, pw);
        hiddenPassword = pw;
        break;
      } catch (e) {
        console.log(`✗ ${/wrong password/.test(e.message) ? "Wrong password." : e.message}`);
        if (!(await t.yes("Try again?", true))) break;
      }
    }
  }
  const write = await t.yes("Let other devices change files (add, edit, move, delete into .trash)?");
  const saved = loadDevices();
  let devices = false, runLogin = true;
  if (saved.length) {
    const who = await t.ask(`Who signs in?\n  1) one login for this run (shown below)\n  2) your saved devices (${saved.length}), each with its own rights\n  3) both\nChoose [1]: `, "1");
    devices = who === "2" || who === "3";
    runLogin = who !== "2";
  }
  const s = await shareFolder(folder, { hiddenPassword, write, devices, runLogin });
  printShare({ ...s, devices }, folder, write);
  t.rl.close();
  await new Promise(() => {}); // (until Ctrl+C)
}

async function devicesFlow(t) {
  for (;;) {
    const list = loadDevices();
    console.log(`\nSaved devices (they sign in to a shared folder with their own user name and password; kept in ${configDir()}):`);
    console.log(list.length ? list.map((d, i) => `  ${i + 1}) ${d.name}: user ${d.user}, password ${d.password}; may ${rightsWords(d.rights)}`).join("\n") : "  none yet");
    const a = (await t.ask("\n  a) add a device   r) rename   p) new password   e) change rights   d) delete   Enter) back\nChoose: ")).toLowerCase();
    if (!a) return;
    if (a === "a") {
      const name = await t.ask("Its name (Phone, Laptop…): ");
      if (!name) continue;
      const d = newDevice(name, list);
      d.rights = await askRights(t, d.rights);
      saveDevices([...list, d]);
      console.log(`✓ Added: user name ${d.user}, password ${d.password}`);
      continue;
    }
    const n = Number(await t.ask("Which one (its number): ")) - 1;
    const d = list[n];
    if (!d) continue;
    if (a === "r") d.name = (await t.ask(`New name for ${d.name}: `, d.name)).slice(0, 60);
    if (a === "p") (d.password = newPassword()), console.log(`✓ New password for ${d.name}: ${d.password}`);
    if (a === "e") d.rights = await askRights(t, d.rights);
    if (a === "d" && (await t.yes(`Delete ${d.name}? It can no longer sign in.`))) list.splice(n, 1);
    saveDevices(list);
  }
}
async function askRights(t, r) {
  console.log("What may it do? (it can always look and download)");
  return {
    add: await t.yes("  Add files and folders?", r.add),
    edit: await t.yes("  Replace a file's contents?", r.edit),
    move: await t.yes("  Move and rename?", r.move),
    delete: await t.yes("  Delete (into .trash, never for good)?", r.delete),
    hidden: await t.yes("  See hidden items (when a share opens them)?", r.hidden),
  };
}

const HELP = `canvast tools: your canvast workspace (or any folder) without the app. Run it with nothing after it for a menu.
  decrypt <workspace> <output folder> [--flat]   the hidden items, readable, into a new folder (the workspace is not changed)
  encrypt <workspace> <file>…                    files hidden into the workspace (close canvast on it first)
  share <folder> [options]                       the folder for other devices on this network (WebDAV over https), until Ctrl+C
      --hidden         a workspace's hidden items too, decrypted as they are read (asks for the password)
      --write          other devices may add, edit, move and delete (into .trash); read only without it
      --devices        your saved devices may sign in too; --only-devices: only they
      --port N         the port (8484, or a free one); --password P: this run's password (a new one without it)
      --dotfiles       names starting with a dot are shared too
  devices                                        add, rename, change or delete the saved devices`;

async function main(args) {
  const [mode, ...rest] = args;
  const flag = (f) => (rest.includes(f) ? (rest.splice(rest.indexOf(f), 1), true) : false);
  const value = (f) => (rest.includes(f) ? rest.splice(rest.indexOf(f), 2)[1] : undefined);
  if (mode === "--help" || mode === "-h" || mode === "help") return console.log(HELP);
  if (mode === "decrypt" || mode === "encrypt") {
    const flat = flag("--flat");
    const [ws, ...files] = rest;
    if (!ws || !files.length || (mode === "decrypt" && files.length !== 1)) return (console.error(HELP), process.exit(2));
    const pw = await askPassword();
    const n = mode === "decrypt" ? await decryptHidden(resolve(ws), resolve(files[0]), pw, { flat }) : await encryptHidden(resolve(ws), files.map((f) => resolve(f)), pw);
    return console.log(mode === "decrypt" ? `${n} hidden item${n === 1 ? "" : "s"} written to ${resolve(files[0])}` : `${n} file${n === 1 ? "" : "s"} hidden into ${resolve(ws)}`);
  }
  if (mode === "share") {
    const o = { hidden: flag("--hidden"), write: flag("--write"), devices: flag("--devices"), only: flag("--only-devices"), dotfiles: flag("--dotfiles"), port: value("--port"), password: value("--password") };
    const [folder] = rest;
    if (!folder) return (console.error(HELP), process.exit(2));
    const hiddenPassword = o.hidden ? await askPassword() : null;
    const s = await shareFolder(folder, { hiddenPassword, write: o.write, devices: o.devices || o.only, runLogin: !o.only, dotfiles: o.dotfiles, port: o.port ? Number(o.port) : 8484, password: o.password ?? null });
    printShare({ ...s, devices: o.devices || o.only }, resolve(folder), o.write);
    return new Promise(() => {});
  }
  const t = terminal();
  if (mode === "devices") return (await devicesFlow(t), t.rl.close());
  if (mode) return (console.error(HELP), process.exit(2));
  for (;;) {
    console.log("\ncanvast tools\n  1) Open my hidden items (decrypt them into a folder)\n  2) Hide files into a workspace (encrypt)\n  3) Share a folder with another device (phone, laptop)\n  4) Saved devices for sharing\n  5) Help\n  0) Quit");
    const c = await t.ask("Choose: ");
    if (c === "0" || c === "q") return t.rl.close();
    if (c === "1") await decryptFlow(t);
    if (c === "2") await encryptFlow(t);
    if (c === "3") await shareFlow(t);
    if (c === "4") await devicesFlow(t);
    if (c === "5") console.log(`\n${HELP}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((e) => {
    console.error(`canvast tools: ${e.message}`);
    process.exit(1);
  });
