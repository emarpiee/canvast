/**
 * The workspace as a folder for file managers (ADR 0184, WebDAV class 1): `/dav/Library/…` is the workspace's `library/` with its
 * folders; `/dav/Hidden/…` the hidden items, decrypted a part at a time as they are read, for this computer itself, or a device whose
 * login may see them, and only while the app has them open. Each device signs in as itself (its own login and rights: add, edit, move,
 * delete, see hidden items); the shared password, when on, only reads. Deleting puts a file in the workspace's `.trash/`.
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface DavEntry {
  /** Its path under its root, `/`-separated, no leading slash. */
  path: string;
  size: number;
  /** Last change, ms. */
  at?: number;
}
/** What a root can change: present only on one that can be written. */
export interface DavWrites {
  put(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Into the workspace's trash. */
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
}
/** One root of the folder: the files under it, and a part of one of them. */
export interface DavRoot {
  list(): Promise<DavEntry[]>;
  read(path: string, from: number, to: number): Promise<Uint8Array | null>;
  /** The hidden items: for this computer itself, or a login allowed to see them. */
  hidden?: boolean;
  writes?: DavWrites;
  /** Its list changed (a write): read it again. */
  changed?(): void;
}

export interface DavRights {
  add: boolean;
  edit: boolean;
  move: boolean;
  delete: boolean;
  hidden: boolean;
}
/** A device's own login. */
export interface DavLogin {
  id: string;
  name: string;
  user: string;
  password: string;
  rights: DavRights;
  added: number;
}
export const READ_ONLY: DavRights = { add: false, edit: false, move: false, delete: false, hidden: false };

/** Who may sign in: each device's login, and the shared password (read only) when it is on. */
export interface DavAuth {
  logins(): readonly DavLogin[];
  shared(): string | null;
}

const MAX_PART = 16 * 1024 * 1024;
/** The biggest file a device can put in one go (it is held in memory once). */
const MAX_PUT = 256 * 1024 * 1024;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const href = (parts: readonly string[], dir: boolean): string => `/dav/${parts.map(encodeURIComponent).join("/")}${dir && parts.length ? "/" : ""}`;
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", txt: "text/plain", md: "text/markdown" };
const typeOf = (name: string): string => TYPES[/\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Whether a request comes from this computer. */
export const isLocal = (req: IncomingMessage): boolean => /^(?:127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? "");

/** What the folder tells the host: a sign-in that failed, a request, a file opened, a change made (with the login's name). */
export type DavSeen = (req: IncomingMessage, who: string | null, what: "wrong password" | "request" | "opened" | "changed", detail?: string) => void;

/** The login a request signs in with: a device's own, or the shared password's (read only); null when none. */
/** The user name and password a request signs in with (Basic), or null. */
function basic(req: IncomingMessage): { user: string; pw: string } | null {
  const given = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (!given) return null;
  const text = Buffer.from(given, "base64").toString("utf8");
  const at = text.indexOf(":");
  return { user: at < 0 ? "" : text.slice(0, at), pw: at < 0 ? text : text.slice(at + 1) };
}

export function signIn(req: IncomingMessage, auth: DavAuth): { name: string; rights: DavRights } | null {
  const b = basic(req);
  if (!b?.pw) return null;
  const { pw } = b;
  const user = b.user.toLowerCase();
  const login = auth.logins().find((l) => l.user.toLowerCase() === user);
  if (login) return same(pw, login.password) ? { name: login.name, rights: login.rights } : null;
  const shared = auth.shared();
  return shared && same(pw, shared) ? { name: "Shared password", rights: READ_ONLY } : null;
}

/** Why a sign-in was refused, for the activity: the user name tried, never the password. */
export function refusedWhy(req: IncomingMessage, auth: DavAuth): string {
  const user = basic(req)?.user ?? "";
  const login = auth.logins().find((l) => l.user.toLowerCase() === user.toLowerCase());
  // (a login's user name is checked against its own password only, never the shared one)
  if (login) return `wrong password for ${login.name}'s login (user name “${user}”)`;
  return `user name “${user.slice(0, 40)}” is no device's login, and the password is not the shared one${auth.shared() ? "" : " (turned off)"}`;
}

/** The parts of a `/dav/…` path; null when it tries to leave it. */
function partsOf(pathname: string): string[] | null {
  const parts = pathname.replace(/^\/dav\/?/, "").split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  return parts.some((p) => p === ".." || p === "." || p.includes("\0") || p.includes("\\")) ? null : parts;
}

const body = (req: IncomingMessage, max: number): Promise<Uint8Array> =>
  new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (b: Buffer) => {
      size += b.length;
      if (size > max) {
        fail(new Error("too big"));
        req.destroy();
      } else parts.push(b);
    });
    req.on("end", () => ok(new Uint8Array(Buffer.concat(parts))));
    req.on("error", fail);
  });

/** Handle a request under `/dav/`. */
export async function davHandle(req: IncomingMessage, res: ServerResponse, roots: Readonly<Record<string, DavRoot>>, auth: DavAuth, seen: DavSeen = () => {}): Promise<void> {
  const me = signIn(req, auth);
  if (!me) {
    if (req.headers.authorization) seen(req, null, "wrong password", refusedWhy(req, auth)); // (a first request without one is how every client asks which sign-in it needs)
    res.writeHead(401, { "www-authenticate": 'Basic realm="canvast", charset="UTF-8"' });
    return void res.end();
  }
  seen(req, me.name, "request");
  const url = new URL(req.url ?? "/", "https://x");
  const parts = partsOf(url.pathname);
  if (!parts) return void res.writeHead(400).end();
  const local = isLocal(req);
  const shown = Object.entries(roots).filter(([, r]) => !r.hidden || local || me.rights.hidden);
  const method = req.method ?? "GET";
  const canWrite = me.rights.add || me.rights.edit || me.rights.move || me.rights.delete;
  if (method === "OPTIONS") {
    res.writeHead(200, { dav: "1", allow: `OPTIONS, PROPFIND, GET, HEAD${canWrite ? ", PUT, MKCOL, DELETE, MOVE, COPY" : ""}`, "ms-author-via": "DAV" });
    return void res.end();
  }
  const refuse = (why: string): void => void res.writeHead(403, { "content-type": "text/plain" }).end(why);

  // What the path names: the top, a root, a folder in it, or a file.
  const rootName = parts[0];
  const root = rootName ? shown.find(([n]) => n === rootName)?.[1] : undefined;
  if (rootName && !root) return void res.writeHead(404).end();
  const under = parts.slice(1).join("/");
  const entries = root ? await root.list() : [];
  const file = root && under ? entries.find((e) => e.path === under) : undefined;
  const isDir = !rootName || (!file && (under === "" || entries.some((e) => e.path.startsWith(`${under}/`))));

  // Changes: each with its own right; never at the top or a root itself, never a name starting with a dot, never in a root that cannot be written.
  if (["PUT", "MKCOL", "DELETE", "MOVE", "COPY"].includes(method)) {
    const w = root?.writes;
    if (!w || !under) return refuse("This folder is read-only here.");
    if (parts.some((p) => p.startsWith("."))) return refuse("Names starting with a dot are not kept.");
    const done = (status: number): void => {
      root!.changed?.();
      res.writeHead(status).end();
    };
    if (method === "PUT") {
      if (isDir && !file) return refuse("That is a folder.");
      if (!(file ? me.rights.edit : me.rights.add)) return refuse(file ? "This device may not change files." : "This device may not add files.");
      await w.put(under, await body(req, MAX_PUT));
      seen(req, me.name, "changed", `${file ? "replaced" : "added"} ${rootName}/${under}`);
      return done(file ? 204 : 201);
    }
    if (method === "MKCOL") {
      if (!me.rights.add) return refuse("This device may not add folders.");
      if (file || isDir) return void res.writeHead(405).end();
      await w.mkdir(under);
      seen(req, me.name, "changed", `added folder ${rootName}/${under}`);
      return done(201);
    }
    if (method === "DELETE") {
      if (!me.rights.delete) return refuse("This device may not delete.");
      if (!file && !isDir) return void res.writeHead(404).end();
      await w.remove(under);
      seen(req, me.name, "changed", `deleted ${rootName}/${under} (into the trash)`);
      return done(204);
    }
    // MOVE and COPY: to a place in the same root.
    const dest = partsOf(new URL(String(req.headers.destination ?? ""), "https://x").pathname);
    if (!dest || dest[0] !== rootName || dest.length < 2 || dest.some((p) => p.startsWith("."))) return refuse("Only to another place in the same folder.");
    const to = dest.slice(1).join("/");
    const taken = entries.some((e) => e.path === to || e.path.startsWith(`${to}/`));
    if (taken && req.headers.overwrite === "F") return void res.writeHead(412).end();
    if (taken && !me.rights.edit) return refuse("This device may not replace files.");
    if (method === "MOVE") {
      if (!me.rights.move) return refuse("This device may not move or rename.");
      if (!file && !isDir) return void res.writeHead(404).end();
      if (taken) await w.remove(to);
      await w.move(under, to);
      seen(req, me.name, "changed", `moved ${rootName}/${under} to ${rootName}/${to}`);
      return done(taken ? 204 : 201);
    }
    if (!me.rights.add) return refuse("This device may not add files.");
    if (!file) return refuse("Only a file can be copied here.");
    if (file.size > MAX_PUT) return refuse("Too big to copy here.");
    const bytes = await root!.read(under, 0, file.size);
    if (!bytes) return void res.writeHead(404).end();
    await w.put(to, bytes);
    seen(req, me.name, "changed", `copied ${rootName}/${under} to ${rootName}/${to}`);
    return done(taken ? 204 : 201);
  }
  if (method !== "PROPFIND" && method !== "GET" && method !== "HEAD") return refuse("Not something this folder does.");
  if (!isDir && !file) return void res.writeHead(404).end();

  if (method === "PROPFIND") {
    const depth = req.headers.depth === "0" ? 0 : 1;
    const row = (p: readonly string[], dir: boolean, size = 0, at = 0): string =>
      `<d:response><d:href>${esc(href(p, dir))}</d:href><d:propstat><d:prop><d:displayname>${esc(p.at(-1) ?? "canvast")}</d:displayname>${dir ? "<d:resourcetype><d:collection/></d:resourcetype>" : `<d:resourcetype/><d:getcontentlength>${size}</d:getcontentlength><d:getcontenttype>${typeOf(p.at(-1) ?? "")}</d:getcontenttype>`}${at ? `<d:getlastmodified>${new Date(at).toUTCString()}</d:getlastmodified>` : ""}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    const rows = [file ? row(parts, false, file.size, file.at) : row(parts, true)];
    if (depth === 1 && isDir) {
      if (!rootName) for (const [n] of shown) rows.push(row([n], true));
      else {
        const prefix = under ? `${under}/` : "";
        const names = new Set<string>();
        for (const e of entries) {
          if (!e.path.startsWith(prefix)) continue;
          const rest = e.path.slice(prefix.length).split("/");
          const name = rest[0]!;
          if (names.has(name)) continue;
          names.add(name);
          rows.push(rest.length > 1 ? row([...parts, name], true) : row([...parts, name], false, e.size, e.at));
        }
      }
    }
    res.writeHead(207, { "content-type": 'application/xml; charset="utf-8"' });
    return void res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${rows.join("")}</d:multistatus>`);
  }
  if (!file) return void res.writeHead(405, { allow: "PROPFIND, OPTIONS" }).end();
  // GET / HEAD, a range at a time.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let from = 0;
  let to = file.size; // (exclusive)
  if (range) {
    if (range[1] === "" && range[2] !== "") from = Math.max(0, file.size - Number(range[2]));
    else {
      from = Number(range[1]);
      if (range[2] !== "") to = Math.min(file.size, Number(range[2]) + 1);
    }
    if (from >= file.size || from >= to) {
      res.writeHead(416, { "content-range": `bytes */${file.size}` });
      return void res.end();
    }
  }
  const head = { "content-type": typeOf(file.path), "accept-ranges": "bytes", "content-length": to - from, ...(range ? { "content-range": `bytes ${from}-${to - 1}/${file.size}` } : {}) };
  res.writeHead(range ? 206 : 200, head);
  if (method === "HEAD") return void res.end();
  if (from === 0) seen(req, me.name, "opened", `${rootName}/${file.path}`); // (a file read from its start: one opening, not each part of it)
  for (let at = from; at < to; ) {
    const part = await root!.read(file.path, at, Math.min(to, at + MAX_PART));
    if (!part?.length) break;
    if (!res.write(part)) await new Promise((r) => res.once("drain", r));
    at += part.length;
  }
  res.end();
}
