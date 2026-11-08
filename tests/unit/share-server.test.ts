import { X509Certificate } from "node:crypto";
import { request } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { makeSelfCert } from "../../desktop/self-cert";
import type { ShareCall, ShareDevice, ShareServer } from "../../desktop/share-server";
import { guestPage, pathAllowed, startShare } from "../../desktop/share-server";

const cert = makeSelfCert();

describe("self-signed certificate", () => {
  it("is a valid X.509 certificate signed by its own key, with the fingerprint browsers show", () => {
    const x = new X509Certificate(cert.cert);
    expect(x.verify(x.publicKey)).toBe(true);
    expect(x.subject).toBe("CN=canvast");
    expect(x.subjectAltName).toContain("DNS:localhost");
    expect(cert.fingerprint).toBe(x.fingerprint256);
    expect(new Date(x.validTo).getTime()).toBeGreaterThan(Date.now() + 9 * 365 * 86_400_000);
  });
});

describe("the page a guest gets", () => {
  it("is the app with its policy opened to this host only, and marked as a guest's", () => {
    const page = guestPage(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'"></head></html>`)!;
    expect(page).toContain("connect-src 'self'");
    expect(page).not.toContain("connect-src 'none'");
    expect(page).toContain('<meta name="canvast-guest" content="1">');
    expect(guestPage("<html><head></head></html>"), "a page whose policy is not the expected one is not served").toBeNull();
  });
});

describe("paths a guest may read", () => {
  it("never deleted files or temporary ones; hidden items only when shared", () => {
    expect(pathAllowed("library/a.png", false)).toBe(true);
    expect(pathAllowed(".trash/library/a.png", true)).toBe(false);
    expect(pathAllowed("library/.tmp-1234", true)).toBe(false);
    for (const p of [".hidden/x", ".hidden", ".canvast/hidden.json", ".canvast/hidden (1).json", ".canvast/keys/hidden.json"]) {
      expect(pathAllowed(p, false), p).toBe(false);
      expect(pathAllowed(p, true), p).toBe(true);
    }
    expect(pathAllowed(".canvast/workspace.json", false)).toBe(true);
    expect(pathAllowed(42, true)).toBe(false);
  });
});

let server: ShareServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const send = (port: number, method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; type: string; bytes: Buffer }> =>
  new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", servername: "localhost", port, method, path, ca: cert.cert, headers: token ? { authorization: `Bearer ${token}` } : {} }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (b: Buffer) => parts.push(b));
      res.on("end", () => ok({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), bytes: Buffer.concat(parts) }));
    });
    req.on("error", fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
const jsonOf = (r: { bytes: Buffer }): Record<string, unknown> => JSON.parse(r.bytes.toString("utf8")) as Record<string, unknown>;

describe("sharing server", () => {
  it("pairs with the code and the host's yes, answers reads only, and keeps hidden items out unless shared", async () => {
    let shareHidden = false;
    let allow = true;
    let saved: ShareDevice[] = [];
    const asked: string[] = [];
    const calls = new Map<string, ShareCall>([
      ["canvast:read", async (p) => new Uint8Array(Buffer.from(`bytes of ${String(p)}`))],
      ["canvast:exists", async () => true],
      ["canvast:workspace", async () => ({ path: "/home/someone/Art", name: "Art" })],
      [
        "canvast:lib",
        async (op, ...a) => {
          if (op === "entries") return JSON.stringify([{ hash: "a", name: "plain.png" }, { hash: "b", name: "secret.png", hidden: true }]);
          if (op === "meta" && a[0] === "assetFolders") return [{ id: "f1", name: "Shown", parentId: null }, { id: "f2", name: "Private", parentId: null, hidden: true }, { id: "f3", name: "Inside", parentId: "f2" }];
          return null;
        },
      ],
    ]);
    server = await startShare({ cert, host: "127.0.0.1", calls, hidden: () => shareHidden, ask: async (d) => (asked.push(d.name), allow), devices: { load: () => saved, save: (l) => void (saved = l) } });
    const port = server.port;
    expect(server.code).toMatch(/^\d{6}$/);
    expect(jsonOf(await send(port, "GET", "/hello"))).toEqual({ app: "canvast", fingerprint: cert.fingerprint });
    expect((await send(port, "POST", "/call", { ch: "canvast:read", args: ["library/a.png"] })).status).toBe(401);
    // Pairing: the code, then the host's yes.
    expect((await send(port, "POST", "/pair", { code: "000000" === server.code ? "111111" : "000000", name: "Laptop" })).status).toBe(403);
    allow = false;
    expect((await send(port, "POST", "/pair", { code: server.code, name: "Laptop" })).status).toBe(403);
    allow = true;
    const paired = jsonOf(await send(port, "POST", "/pair", { code: server.code, name: "Laptop" }));
    expect(asked).toEqual(["Laptop", "Laptop"]);
    const token = String(paired["token"]);
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toContain(token); // (only its hash is kept)
    // Reads, as bytes.
    const r = await send(port, "POST", "/call", { ch: "canvast:read", args: ["library/a.png"] }, token);
    expect(r.status).toBe(200);
    expect(r.type).toBe("application/octet-stream");
    expect(r.bytes.toString()).toBe("bytes of library/a.png");
    expect(jsonOf(await send(port, "POST", "/call", { ch: "canvast:workspace", args: [] }, token))).toEqual({ v: { path: "", name: "Art" } });
    // No writes, no deleted files, no hidden items unless shared.
    expect((await send(port, "POST", "/call", { ch: "canvast:write", args: ["library/a.png", []] }, token)).status).toBe(403);
    expect((await send(port, "POST", "/call", { ch: "canvast:lib", args: ["apply", []] }, token)).status).toBe(403);
    expect((await send(port, "POST", "/call", { ch: "canvast:read", args: [".trash/library/a.png"] }, token)).status).toBe(403);
    expect((await send(port, "POST", "/call", { ch: "canvast:read", args: [".canvast/hidden.json"] }, token)).status).toBe(403);
    expect((await send(port, "POST", "/call", { ch: "canvast:read", args: [".hidden/abc"] }, token)).status).toBe(403);
    shareHidden = true;
    expect((await send(port, "POST", "/call", { ch: "canvast:read", args: [".hidden/abc"] }, token)).status).toBe(200);
    // The library never tells a hidden item's details, shared or not (a guest opens the encrypted index itself).
    const entries = JSON.parse(String(jsonOf(await send(port, "POST", "/call", { ch: "canvast:lib", args: ["entries", "all"] }, token))["v"])) as Array<{ name: string }>;
    expect(entries.map((e) => e.name)).toEqual(["plain.png"]);
    expect((await send(port, "POST", "/call", { ch: "canvast:lib", args: ["counts", true] }, token)).status).toBe(403);
    expect((await send(port, "POST", "/call", { ch: "canvast:lib", args: ["query", { hidden: true }] }, token)).status).toBe(403);
    const folders = jsonOf(await send(port, "POST", "/call", { ch: "canvast:lib", args: ["meta", "assetFolders"] }, token))["v"] as Array<{ name: string }>;
    expect(folders.map((f) => f.name)).toEqual(["Shown"]);
    // Removed: its token stops at once.
    server.remove(String(paired["id"]));
    expect((await send(port, "POST", "/call", { ch: "canvast:read", args: ["library/a.png"] }, token)).status).toBe(401);
  });

  it("stops taking codes after five wrong ones", async () => {
    server = await startShare({ cert, host: "127.0.0.1", calls: new Map(), hidden: () => false, ask: async () => true, devices: { load: () => [], save: () => {} } });
    const wrong = server.code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) expect((await send(server.port, "POST", "/pair", { code: wrong })).status).toBe(403);
    expect((await send(server.port, "POST", "/pair", { code: server.code })).status).toBe(429);
  });
});

describe("finding hosts", () => {
  it("a host that shares answers a guest's question with its name, port and fingerprint; stopped, it is silent", async () => {
    const { answerFinds, findHosts } = await import("../../desktop/share-find");
    const port = 47_000 + Math.floor(Math.random() * 900);
    const stop = answerFinds(() => ({ name: "Studio · Art", port: 4433, fingerprint: "AA:BB" }), port);
    await new Promise((r) => setTimeout(r, 100));
    const found = await findHosts(400, port, "127.0.0.1");
    expect(found).toEqual([{ name: "Studio · Art", address: "127.0.0.1", port: 4433, fingerprint: "AA:BB" }]);
    stop();
    expect(await findHosts(300, port, "127.0.0.1")).toEqual([]);
  });
});

describe("a typed host address", () => {
  it("takes what Settings > Sharing shows, with or without https://, and refuses anything else", async () => {
    const { parseAddress } = await import("../../desktop/share-find");
    expect(parseAddress("192.168.1.5:47000")).toEqual({ address: "192.168.1.5", port: 47000 });
    expect(parseAddress("https://192.168.1.5:47000/")).toEqual({ address: "192.168.1.5", port: 47000 });
    expect(parseAddress("192.168.1.5")).toBeNull();
    expect(parseAddress("192.168.1.5:99999")).toBeNull();
    expect(parseAddress("evil.com:1/../x")).toBeNull();
  });
});

describe("the folder for file managers (WebDAV)", () => {
  it("lists folders and files, reads a range, needs its password and refuses every change", async () => {
    const files: Record<string, Uint8Array> = { "Refs/hand.png": new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "top.txt": new TextEncoder().encode("hello") };
    const reads: Array<[number, number]> = [];
    server = await startShare({
      cert,
      host: "127.0.0.1",
      calls: new Map(),
      hidden: () => false,
      ask: async () => true,
      devices: { load: () => [], save: () => {} },
      dav: {
        Library: {
          list: async () => Object.entries(files).map(([path, b]) => ({ path, size: b.length, at: 1_700_000_000_000 })),
          read: async (p, from, to) => (reads.push([from, to]), files[p]!.slice(from, to)),
        },
      },
    });
    const dav = (method: string, path: string, headers: Record<string, string> = {}, pw: string | null = server!.davPassword): Promise<{ status: number; text: string; headers: Record<string, unknown> }> =>
      new Promise((ok, fail) => {
        const req = request({ host: "127.0.0.1", servername: "localhost", port: server!.port, method, path, ca: cert.cert, headers: { ...headers, ...(pw !== null ? { authorization: `Basic ${Buffer.from(`me:${pw}`).toString("base64")}` } : {}) } }, (res) => {
          const parts: Buffer[] = [];
          res.on("data", (b: Buffer) => parts.push(b));
          res.on("end", () => ok({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString("latin1"), headers: res.headers }));
        });
        req.on("error", fail);
        req.end();
      });
    expect((await dav("PROPFIND", "/dav/", { depth: "1" }, null)).status).toBe(401);
    expect((await dav("PROPFIND", "/dav/", { depth: "1" }, "wrong")).status).toBe(401);
    const top = await dav("PROPFIND", "/dav/", { depth: "1" });
    expect(top.status).toBe(207);
    expect(top.text).toContain("<d:href>/dav/Library/</d:href>");
    const lib = await dav("PROPFIND", "/dav/Library/", { depth: "1" });
    expect(lib.text).toContain("<d:href>/dav/Library/Refs/</d:href>");
    expect(lib.text).toContain("<d:href>/dav/Library/top.txt</d:href>");
    expect(lib.text).toContain("<d:getcontentlength>5</d:getcontentlength>");
    expect(lib.text).not.toContain("hand.png"); // (one level at a time)
    const part = await dav("GET", "/dav/Library/Refs/hand.png", { range: "bytes=2-4" });
    expect(part.status).toBe(206);
    expect([...Buffer.from(part.text, "latin1")]).toEqual([3, 4, 5]);
    expect(part.headers["content-range"]).toBe("bytes 2-4/10");
    expect(reads.at(-1)).toEqual([2, 5]); // (only that part is read)
    for (const m of ["PUT", "DELETE", "MKCOL", "MOVE", "COPY", "PROPPATCH", "LOCK"]) expect((await dav(m, "/dav/Library/top.txt")).status, m).toBe(403);
    expect((await dav("GET", "/dav/Library/../../etc/passwd")).status).not.toBe(200);
    expect((await dav("GET", "/dav/Hidden/x")).status).toBe(404);
  });
});
