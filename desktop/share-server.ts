/**
 * The sharing server (ADR 0184): read-only, on the local network, over HTTPS. A guest pairs with the host's code and the host's
 * approval, then asks for the same read calls the host's own page makes (`calls`, the main process's handlers: the same path rules).
 * There is no write route. Hidden items' files go out only when the host shares them, and only as they are on disk (encrypted);
 * hidden items' details are taken out of every library answer (a guest opens its own copy of the encrypted index).
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createServer } from "node:https";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import type { SelfCert } from "./self-cert";
import { davHandle } from "./share-dav";
import type { DavLogin, DavRoot } from "./share-dav";

/** A guest the host allowed. Only a hash of its token is kept. */
export interface ShareDevice {
  id: string;
  name: string;
  tokenHash: string;
  added: number;
  seen?: number;
}

/** One line of the sharing log. */
export interface ShareEvent {
  at: number;
  what: string;
  /** The device or app. */
  who: string;
  address: string;
}
/** An app using the file managers' folder (by its address and its name). */
export interface DavClient {
  address: string;
  /** The login's name (a device's, or "Shared password"), and the app's. */
  who: string;
  app: string;
  first: number;
  last: number;
  opened: number;
}

/** A read call of the main process: what the page's bridge would get. */
export type ShareCall = (...args: unknown[]) => Promise<unknown>;

export interface ShareOptions {
  cert: SelfCert;
  /** 0: any free port. */
  port?: number;
  /** Where to listen: every address of this computer by default (tests: 127.0.0.1). */
  host?: string;
  /** The calls a guest may make, by channel (`canvast:read`, …). `canvast:lib` is narrowed to its reading ops here. */
  calls: ReadonlyMap<string, ShareCall>;
  /** Whether hidden items' files (encrypted) are shared now. */
  hidden: () => boolean;
  /** The host is asked whether a device may connect; false when it says no (or does not answer in time). */
  ask: (device: { name: string; address: string }) => Promise<boolean>;
  /** The allowed devices, read and written by the host (kept across starts). */
  devices: { load(): ShareDevice[]; save(list: ShareDevice[]): void };
  /** The page a browser gets at `/` (the app, set up as a guest of this host); a short note when absent. */
  page?: () => Promise<string>;
  /** Told when a guest connects, leaves or is removed. */
  changed?: () => void;
  /** Each thing that happened (the host keeps the log). */
  log?: (e: ShareEvent) => void;
  /** The folder file managers open at `/dav/` (its roots), signed in with `davPassword`. */
  dav?: Readonly<Record<string, DavRoot>>;
  /** Which parts answer now: guests (the app's page, pairing, reads) and the file managers' folder. Both, when absent. */
  parts?: () => { guests: boolean; dav: boolean };
  /** The devices' own logins to the folder, and whether the shared password (read only) is on. */
  davLogins?: () => readonly DavLogin[];
  davShared?: () => boolean;
  /** The code and the file managers' password, kept by the host (made here when absent). */
  code?: string;
  davPassword?: string;
  /** At most this many requests at once from one device. */
  perDevice?: number;
}

export interface ShareServer {
  port: number;
  /** The six digits a guest types to pair (new at each start). */
  code: string;
  /** The file managers' password for `/dav/` (new at each start). */
  davPassword: string;
  addresses: string[];
  fingerprint: string;
  /** The devices with a request open now (connected). */
  active(): string[];
  /** The apps that used the file managers' folder since sharing started, the latest first. */
  davClients(): DavClient[];
  /** Take a device off: its token stops working at once. */
  remove(id: string): void;
  /** End every guest's connection (sharing with guests turned off). */
  dropGuests(): void;
  /** Send an event to every connected guest (live changes, the host's view). */
  send(event: string, data: unknown): void;
  close(): Promise<void>;
}

/** The library's reading ops a guest may use (the rest write, or answer what only the host's page needs). */
const LIB_READS = new Set(["get", "entries", "recs", "byFile", "meta", "listed", "absent", "query", "counts", "fieldKeys", "fieldValues"]);
/** Whether a library call asks about the hidden items (their lists are a guest's own, from the index it opens). */
const asksHidden = (op: string, a: readonly unknown[]): boolean => (op === "query" ? (a[0] as { hidden?: unknown } | null)?.hidden === true : op === "counts" || op === "fieldKeys" ? a[0] === true : op === "fieldValues" ? a[1] === true : false);
/** Paths of the hidden items (their files, names, index and key): shared only when the host says so. */
const HIDDEN_PATH = /^(?:\.hidden(?:\/|$)|\.canvast\/(?:hidden[^/]*\.json|keys(?:\/|$)))/i;
/** Never shared: deleted files, the app's own temporary files. */
const PRIVATE_PATH = /^(?:\.trash(?:\/|$))|(?:^|\/)\.tmp-/i;
const FOLDERS_KEY = "assetFolders";
const MAX_BODY = 1 << 20;
const PAIR_TRIES = 5;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** This computer's addresses on the local network (IPv4, not the loopback). */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a): a is NonNullable<typeof a> => !!a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

/** Whether a call's path arguments may be read by a guest now. */
export function pathAllowed(path: unknown, hidden: boolean): boolean {
  if (typeof path !== "string") return false;
  if (PRIVATE_PATH.test(path)) return false;
  return hidden || !HIDDEN_PATH.test(path);
}

const hiddenEntry = (e: unknown): boolean => !!e && typeof e === "object" && (e as { hidden?: unknown }).hidden === true;
const hiddenRec = (r: unknown): boolean => !!r && typeof r === "object" && typeof (r as { file?: unknown }).file === "string" && /^\.hidden\//.test((r as { file: string }).file);

/** A library answer with every hidden item's details taken out (the host's page may hold them open; a guest opens its own). */
export function withoutHidden(op: string, args: readonly unknown[], out: unknown): unknown {
  if (op === "entries" || op === "recs") {
    if (args[0] === "hidden" || args[0] === "sealed") return "[]";
    const list = JSON.parse(String(out)) as unknown[];
    return JSON.stringify(list.filter((x) => !hiddenEntry(x) && !hiddenRec(x)));
  }
  if (op === "get") return (out as Array<[string, unknown, unknown, unknown]>).filter(([, e, r]) => !hiddenEntry(e) && !hiddenRec(r));
  if (op === "listed") return (out as unknown[]).filter((e) => !hiddenEntry(e));
  if (op === "counts" && out && typeof out === "object") return { ...(out as object), hidden: 0 };
  if (op === "query" && out && typeof out === "object") return { ...(out as object), ratios: Array.from((out as { ratios: ArrayLike<number> }).ratios ?? []) };
  if (op === "byFile") return typeof args[0] === "string" && /^\.hidden\//.test(args[0]) ? null : out;
  if (op === "meta" && args[0] === FOLDERS_KEY && Array.isArray(out)) {
    // (a hidden folder and everything inside it)
    const folders = out as Array<{ id: string; parentId: string | null; hidden?: boolean }>;
    const byId = new Map(folders.map((f) => [f.id, f]));
    const hiddenUnder = (f: (typeof folders)[number] | undefined): boolean => {
      for (let g = f, n = 0; g && n < 1000; g = g.parentId ? byId.get(g.parentId) : undefined, n++) if (g.hidden) return true;
      return false;
    };
    return folders.filter((f) => !hiddenUnder(f));
  }
  return out;
}

/**
 * The app as a guest's browser gets it: the same single file, marked as a guest's, its own security policy opened to this host only
 * (the file as downloaded connects nowhere: `check:offline`). Null when the policy is not the one expected (nothing is served).
 */
export function guestPage(html: string): string | null {
  if (!/connect-src 'none'/.test(html)) return null;
  return html.replace("connect-src 'none'", "connect-src 'self'").replace(/<head>/i, '<head><meta name="canvast-guest" content="1">');
}

export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const newDavPassword = (): string => randomBytes(9).toString("base64url");

export async function startShare(o: ShareOptions): Promise<ShareServer> {
  const code = o.code ?? newCode();
  const davPassword = o.davPassword ?? newDavPassword();
  let wrongAt = 0;
  let devices = o.devices.load();
  let wrongCodes = 0;
  const busy = new Map<string, number>();
  const waiting = new Map<string, Array<() => void>>();
  const streams = new Map<ServerResponse, string>();
  const perDevice = o.perDevice ?? 12;
  const addr = (req: IncomingMessage): string => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const say = (what: string, who: string, req: IncomingMessage | null): void => o.log?.({ at: Date.now(), what, who, address: req ? addr(req) : "" });
  // The file managers' folder: who uses it (a client is its address and its app), and what it opened.
  const davClients = new Map<string, DavClient>();
  const appOf = (req: IncomingMessage): string => (req.headers["user-agent"] ?? "a WebDAV app").split(/[ /(]/)[0]!.slice(0, 40) || "a WebDAV app";
  const davSeen = (req: IncomingMessage, who: string | null, what: "wrong password" | "request" | "opened" | "changed", detail?: string): void => {
    const app = appOf(req);
    if (what === "wrong password") return say("Folder: wrong user name or password", app, req);
    const name = who ?? app;
    const key = `${addr(req)}|${name}|${app}`;
    let c = davClients.get(key);
    if (!c) {
      c = { address: addr(req), who: name, app, first: Date.now(), last: Date.now(), opened: 0 };
      davClients.set(key, c);
      say(`Folder: signed in (${app})`, name, req);
    }
    c.last = Date.now();
    if (what === "opened") {
      c.opened++;
      say(`Folder: opened ${detail}`, name, req);
    } else if (what === "changed") say(`Folder: ${detail}`, name, req);
    else o.changed?.();
  };
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const body = (req: IncomingMessage): Promise<unknown> =>
    new Promise((ok, fail) => {
      const parts: Buffer[] = [];
      let size = 0;
      req.on("data", (b: Buffer) => {
        size += b.length;
        if (size > MAX_BODY) {
          fail(new Error("too big"));
          req.destroy();
        } else parts.push(b);
      });
      req.on("end", () => {
        try {
          ok(JSON.parse(Buffer.concat(parts).toString("utf8") || "null"));
        } catch {
          fail(new Error("not JSON"));
        }
      });
      req.on("error", fail);
    });
  const deviceOf = (req: IncomingMessage): ShareDevice | null => {
    const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "") ?? /[?&]token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(req.url ?? "");
    if (!m) return null;
    const h = sha(m[1]!);
    return devices.find((d) => same(d.tokenHash, h)) ?? null;
  };

  async function call(dev: ShareDevice, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const b = (await body(req)) as { ch?: unknown; args?: unknown } | null;
    const ch = b?.ch;
    const args = Array.isArray(b?.args) ? (b!.args as unknown[]) : [];
    const fn = typeof ch === "string" ? o.calls.get(ch) : undefined;
    if (!fn) return json(res, 403, { error: "not a call a guest can make" });
    const hidden = o.hidden();
    if (ch === "canvast:lib") {
      if (typeof args[0] !== "string" || !LIB_READS.has(args[0])) return json(res, 403, { error: "the library is read-only here" });
      if (asksHidden(args[0], args.slice(1))) return json(res, 403, { error: "hidden items' lists are opened by the guest" });
    } else if (ch === "canvast:sizes") {
      if (!Array.isArray(args[0]) || !(args[0] as unknown[]).every((p) => pathAllowed(p, hidden))) return json(res, 403, { error: "not shared" });
    } else if (ch !== "canvast:canvasFiles" && ch !== "canvast:workspace" && ch !== "canvast:thumb" && !pathAllowed(args[0], hidden)) {
      return json(res, 403, { error: "not shared" });
    }
    // At most `perDevice` at once from one device: the rest wait their turn (a library view asks for many at once).
    while ((busy.get(dev.id) ?? 0) >= perDevice) await new Promise<void>((r) => (waiting.get(dev.id) ?? waiting.set(dev.id, []).get(dev.id)!).push(r));
    busy.set(dev.id, (busy.get(dev.id) ?? 0) + 1);
    try {
      let out = await fn(...args);
      if (ch === "canvast:lib") out = withoutHidden(args[0] as string, args.slice(1), out);
      if (ch === "canvast:workspace" && out && typeof out === "object") out = { path: "", name: (out as { name?: string }).name ?? "" }; // (not the host's own path)
      if (out instanceof Uint8Array) {
        res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store", "content-length": out.byteLength });
        res.end(Buffer.from(out.buffer, out.byteOffset, out.byteLength));
      } else json(res, 200, { v: out ?? null });
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      busy.set(dev.id, (busy.get(dev.id) ?? 1) - 1);
      waiting.get(dev.id)?.shift()?.();
    }
  }

  async function pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const b = (await body(req)) as { code?: unknown; name?: unknown } | null;
    // (five wrong codes: none is taken for a minute)
    if (wrongCodes >= PAIR_TRIES && Date.now() - wrongAt < 60_000) return json(res, 429, { error: "Too many wrong codes: try again in a minute." });
    if (wrongCodes >= PAIR_TRIES) wrongCodes = 0;
    if (typeof b?.code !== "string" || !same(b.code, code)) {
      wrongCodes++;
      wrongAt = Date.now();
      say("Wrong code", typeof b?.name === "string" ? b.name.slice(0, 60) : "A device", req);
      return json(res, 403, { error: "That is not the code the host shows." });
    }
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : "A device";
    const ok = await Promise.race([o.ask({ name, address: req.socket.remoteAddress ?? "" }), new Promise<boolean>((r) => setTimeout(() => r(false), 120_000))]);
    if (!ok) {
      say("Not allowed", name, req);
      return json(res, 403, { error: "The host did not allow this device." });
    }
    say("Allowed", name, req);
    const token = randomBytes(32).toString("base64url");
    const dev: ShareDevice = { id: randomBytes(8).toString("hex"), name, tokenHash: sha(token), added: Date.now() };
    devices = [...devices, dev];
    o.devices.save(devices);
    o.changed?.();
    json(res, 200, { token, id: dev.id });
  }

  const server: Server = createServer({ key: o.cert.key, cert: o.cert.cert }, (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "https://x");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      const parts = o.parts?.() ?? { guests: true, dav: true };
      const isDav = url.pathname === "/dav" || url.pathname.startsWith("/dav/");
      if (isDav ? !parts.dav : !parts.guests) return json(res, 404, { error: isDav ? "The folder for file managers is off." : "Sharing with guests is off." });
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(o.page ? await o.page() : "<!doctype html><title>canvast</title><p>A canvast workspace is shared here. Open it in canvast.</p>");
      }
      if (o.dav && isDav) return davHandle(req, res, o.dav, { logins: () => o.davLogins?.() ?? [], shared: () => (o.davShared?.() ?? true ? davPassword : null) }, davSeen);
      if (req.method === "GET" && url.pathname === "/hello") return json(res, 200, { app: "canvast", fingerprint: o.cert.fingerprint });
      if (req.method === "POST" && url.pathname === "/pair") return pair(req, res);
      const dev = deviceOf(req);
      if (!dev) return json(res, 401, { error: "not paired" });
      dev.seen = Date.now();
      if (req.method === "POST" && url.pathname === "/call") return call(dev, req, res);
      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(": hello\n\n");
        const first = ![...streams.values()].includes(dev.id);
        streams.set(res, dev.id);
        if (first) say("Connected", dev.name, req);
        o.changed?.();
        req.on("close", () => {
          streams.delete(res);
          if (![...streams.values()].includes(dev.id)) say("Left", dev.name, req);
          o.changed?.();
        });
        return;
      }
      json(res, 404, { error: "no such thing" });
    })().catch((e: unknown) => {
      if (!res.headersSent) json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    });
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(o.port ?? 0, o.host ?? "0.0.0.0", () => ok());
  });

  return {
    port: (server.address() as AddressInfo).port,
    code,
    davPassword,
    addresses: o.host && o.host !== "0.0.0.0" ? [o.host] : lanAddresses(),
    fingerprint: o.cert.fingerprint,
    active: () => [...new Set(streams.values())],
    davClients: () => [...davClients.values()].sort((a, b) => b.last - a.last),
    remove(id) {
      const gone = devices.find((d) => d.id === id);
      if (gone) say("Removed", gone.name, null);
      devices = devices.filter((d) => d.id !== id);
      o.devices.save(devices);
      for (const [res, d] of streams) if (d === id) res.end();
      o.changed?.();
    },
    dropGuests() {
      for (const res of streams.keys()) res.end();
    },
    send(event, data) {
      const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of streams.keys()) res.write(line);
    },
    close: () =>
      new Promise((ok) => {
        for (const res of streams.keys()) res.end();
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
