/**
 * The workspace as a read-only folder for file managers (ADR 0184, WebDAV class 1): `/dav/Library/…` is the workspace's `library/`
 * with its folders; `/dav/Hidden/…` the hidden items, decrypted a part at a time as they are read, only for this computer itself and
 * only while the app has them open. Only reading: listing (PROPFIND), GET and HEAD with ranges. Basic sign-in with the password Settings
 * > Sharing shows (new at each start of sharing).
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
/** One root of the folder: the files under it, and a part of one of them. */
export interface DavRoot {
  list(): Promise<DavEntry[]>;
  read(path: string, from: number, to: number): Promise<Uint8Array | null>;
  /** Only for this computer itself (the hidden items). */
  localOnly?: boolean;
}

const MAX_PART = 16 * 1024 * 1024;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const href = (parts: readonly string[], dir: boolean): string => `/dav/${parts.map(encodeURIComponent).join("/")}${dir && parts.length ? "/" : ""}`;
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", txt: "text/plain", md: "text/markdown" };
const typeOf = (name: string): string => TYPES[/\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Whether a request comes from this computer. */
export const isLocal = (req: IncomingMessage): boolean => /^(?:127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? "");

/** Handle a request under `/dav/`. */
export async function davHandle(req: IncomingMessage, res: ServerResponse, roots: Readonly<Record<string, DavRoot>>, password: string): Promise<void> {
  const given = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  const pw = given ? Buffer.from(given, "base64").toString("utf8").replace(/^[^:]*:/, "") : "";
  if (!pw || pw.length !== password.length || !timingSafeEqual(Buffer.from(pw), Buffer.from(password))) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="canvast", charset="UTF-8"' });
    return void res.end();
  }
  const url = new URL(req.url ?? "/", "https://x");
  const parts = url.pathname.replace(/^\/dav\/?/, "").split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  if (parts.some((p) => p === ".." || p === "." || p.includes("\0"))) return void res.writeHead(400).end();
  const local = isLocal(req);
  const shown = Object.entries(roots).filter(([, r]) => local || !r.localOnly);
  const method = req.method ?? "GET";
  if (method === "OPTIONS") {
    res.writeHead(200, { dav: "1", allow: "OPTIONS, PROPFIND, GET, HEAD", "ms-author-via": "DAV" });
    return void res.end();
  }
  if (method !== "PROPFIND" && method !== "GET" && method !== "HEAD") return void res.writeHead(403, { "content-type": "text/plain" }).end("This folder is read-only.");

  // What the path names: the top, a root, a folder in it, or a file.
  const rootName = parts[0];
  const root = rootName ? shown.find(([n]) => n === rootName)?.[1] : undefined;
  if (rootName && !root) return void res.writeHead(404).end();
  const under = parts.slice(1).join("/");
  const entries = root ? await root.list() : [];
  const file = root && under ? entries.find((e) => e.path === under) : undefined;
  const isDir = !rootName || (!file && (under === "" || entries.some((e) => e.path.startsWith(`${under}/`))));
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
        const seen = new Set<string>();
        for (const e of entries) {
          if (!e.path.startsWith(prefix)) continue;
          const rest = e.path.slice(prefix.length).split("/");
          const name = rest[0]!;
          if (seen.has(name)) continue;
          seen.add(name);
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
  for (let at = from; at < to; ) {
    const part = await root!.read(file.path, at, Math.min(to, at + MAX_PART));
    if (!part?.length) break;
    if (!res.write(part)) await new Promise((r) => res.once("drain", r));
    at += part.length;
  }
  res.end();
}
