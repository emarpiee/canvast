import { createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makePng } from "../e2e/png";
// @ts-expect-error (plain JavaScript, no types)
import { cleanPath, cleanPaths, shareFolder } from "../../scripts/tools/tools-source.mjs";
// @ts-expect-error (a build script, plain JavaScript)
import { decodeFrames, encodeFrame, handleMcp, newCode, pageOrigin, startBridge } from "../../scripts/tools/agent-bridge.mjs";
import { PassThrough } from "node:stream";
import { connect as netConnect, type Socket } from "node:net";
// @ts-expect-error (plain JavaScript, no types)
import { encryptHidden, hiddenFolder } from "../../scripts/hidden-items.mjs";

const root = mkdtempSync(join(tmpdir(), "cv-tools-"));
process.env["CANVAST_TOOLS_HOME"] = join(root, "tools-home");
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Share = { port: number; run: { user: string; password: string }; close: () => Promise<void> };
const call = (s: Share, method: string, path: string, o: { pw?: string; headers?: Record<string, string>; body?: Buffer | string } = {}): Promise<{ status: number; body: Buffer }> =>
  new Promise((ok, fail) => {
    const auth = Buffer.from(`${s.run.user}:${o.pw ?? s.run.password}`).toString("base64");
    const r = request({ host: "127.0.0.1", port: s.port, path, method, rejectUnauthorized: false, headers: { authorization: `Basic ${auth}`, ...o.headers } }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (b: Buffer) => parts.push(b));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: Buffer.concat(parts) }));
    });
    r.on("error", fail);
    r.end(o.body);
  });

describe("canvast tools: a plain folder shared with other devices", () => {
  it("read only by default: its files, never a dot-name, a link out, a path out or a wrong password; with --write, changes, deletes into .trash", async () => {
    const dir = join(root, "My stuff");
    mkdirSync(join(dir, "docs"), { recursive: true });
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "docs", "a.txt"), "hello");
    writeFileSync(join(dir, ".git", "config"), "secret");
    writeFileSync(join(root, "outside.txt"), "outside");
    symlinkSync(join(root, "outside.txt"), join(dir, "link.txt"));
    let s: Share = await shareFolder(dir, { port: 0, password: "pw-for-test-1", log: () => {} });
    try {
      const listing = (await call(s, "PROPFIND", "/dav/My%20stuff/", { headers: { depth: "1" } })).body.toString();
      expect(listing).toContain("/dav/My%20stuff/docs/");
      expect(listing).not.toContain(".git");
      expect(listing).not.toContain("link.txt");
      expect((await call(s, "GET", "/dav/My%20stuff/docs/a.txt")).body.toString()).toBe("hello");
      expect((await call(s, "GET", "/dav/My%20stuff/docs/a.txt", { headers: { range: "bytes=1-3" } })).body.toString()).toBe("ell");
      expect((await call(s, "GET", "/dav/My%20stuff/../outside.txt")).status).not.toBe(200);
      expect((await call(s, "GET", "/dav/My%20stuff/docs/a.txt", { pw: "wrong" })).status).toBe(401);
      expect((await call(s, "PUT", "/dav/My%20stuff/new.txt", { body: "x" })).status).toBe(403);
    } finally {
      await s.close();
    }
    s = await shareFolder(dir, { port: 0, password: "pw-for-test-2", write: true, log: () => {} });
    try {
      expect((await call(s, "PUT", "/dav/My%20stuff/new.txt", { body: "made" })).status).toBe(201);
      expect(readFileSync(join(dir, "new.txt"), "utf8")).toBe("made");
      expect((await call(s, "MOVE", "/dav/My%20stuff/new.txt", { headers: { destination: "/dav/My%20stuff/docs/moved.txt" } })).status).toBe(201);
      expect((await call(s, "DELETE", "/dav/My%20stuff/docs/moved.txt")).status).toBe(204);
      expect(existsSync(join(dir, "docs", "moved.txt"))).toBe(false);
      expect(readdirSync(join(dir, ".trash")).some((n) => n.endsWith("moved.txt")), "deleted into the folder's .trash").toBe(true);
      expect(readFileSync(join(root, "outside.txt"), "utf8")).toBe("outside");
    } finally {
      await s.close();
    }
  });

  it("takes paths as a terminal gives them when they are dragged in", () => {
    expect(cleanPath("'/tmp/My stuff' ")).toBe("/tmp/My stuff");
    expect(cleanPath("/tmp/My\\ stuff")).toBe("/tmp/My stuff");
    expect(cleanPath("file:///tmp/My%20stuff")).toBe("/tmp/My stuff");
    expect(cleanPaths("'/a b.png' /c\\ d.png \"/e.png\"")).toEqual(["/a b.png", "/c d.png", "/e.png"]);
  });
});

describe("canvast tools: a workspace's hidden items shared, decrypted only as they are read", () => {
  it("lists them by name and gives any part of one, across its 1 MiB chunks; only with the password, only to a login allowed", async () => {
    const ws = join(root, "workspace");
    mkdirSync(join(ws, ".canvast"), { recursive: true });
    mkdirSync(join(ws, "library"), { recursive: true });
    writeFileSync(join(ws, ".canvast", "workspace.json"), "{}");
    writeFileSync(join(ws, "library", "shown.txt"), "shown");
    // A Hidden password's vault, as the app makes it (scrypt, AES-KW over the data key; small N for speed).
    const salt = randomBytes(16);
    const kek = await crypto.subtle.importKey("raw", scryptSync("pw", salt, 32, { N: 1024, r: 8, p: 1 }), "AES-KW", false, ["wrapKey"]);
    const data = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const key = Buffer.from(await crypto.subtle.wrapKey("raw", data, kek, "AES-KW")).toString("base64");
    writeFileSync(join(ws, ".canvast", "hidden.json"), JSON.stringify({ format: "canvast-hidden", version: 2, kdf: { name: "scrypt", N: 1024, r: 8, p: 1, salt: salt.toString("base64") }, key }));
    const noise = randomBytes(900 * 900 * 3);
    const pic = makePng(900, 900, (x, y) => [noise[(y * 900 + x) * 3]!, noise[(y * 900 + x) * 3 + 1]!, noise[(y * 900 + x) * 3 + 2]!, 255]);
    expect(pic.length, "past two chunks").toBeGreaterThan(2 * 2 ** 20);
    writeFileSync(join(root, "Secret.png"), pic);
    expect(await encryptHidden(ws, [join(root, "Secret.png")], "pw")).toBe(1);
    await expect(hiddenFolder(ws, "nope")).rejects.toThrow(/wrong password/);
    const hidden = await hiddenFolder(ws, "pw");
    expect(hidden.list()).toEqual([expect.objectContaining({ path: "Secret.png", size: pic.length })]);
    for (const [from, to] of [[0, 10], [2 ** 20 - 5, 2 ** 20 + 5], [2 ** 20, 2 * 2 ** 20 + 3], [pic.length - 7, pic.length]] as const)
      expect(Buffer.from(await hidden.read("Secret.png", from, to)).equals(pic.subarray(from, to)), `bytes ${from}-${to}`).toBe(true);
    const s: Share = await shareFolder(ws, { port: 0, password: "pw-for-test-3", hiddenPassword: "pw", log: () => {} });
    try {
      const top = (await call(s, "PROPFIND", "/dav/", { headers: { depth: "1" } })).body.toString();
      expect(top).toContain("/dav/Hidden/");
      expect(top).toContain("/dav/Library/");
      const whole = await call(s, "GET", "/dav/Hidden/Secret.png");
      expect(createHash("sha256").update(whole.body).digest("hex")).toBe(createHash("sha256").update(pic).digest("hex"));
      expect((await call(s, "GET", "/dav/Library/shown.txt")).body.toString()).toBe("shown");
    } finally {
      await s.close();
    }
    // Shared without the password: no Hidden.
    const plain: Share = await shareFolder(ws, { port: 0, password: "pw-for-test-4", log: () => {} });
    try {
      expect((await call(plain, "PROPFIND", "/dav/", { headers: { depth: "1" } })).body.toString()).not.toContain("Hidden");
    } finally {
      await plain.close();
    }
  });
});

describe("canvast tools: the link to AI agents (mcp, ADR 0205)", () => {
  it("answers MCP: initialize, the tools, and calls passed on to canvast", async () => {
    const calls: Array<[string, unknown]> = [];
    const app = async (method: string, params: unknown): Promise<unknown> => {
      calls.push([method, params]);
      if (method === "list") return [{ id: "edit.undo" }];
      if (method === "run") return (params as { id: string }).id === "edit.undo" ? { ok: true } : { ok: false, error: "nope" };
      return { ok: true, completed: 2, results: [] };
    };
    const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, app);
    expect(init?.result.protocolVersion).toBe("2025-03-26");
    expect(init?.result.capabilities).toEqual({ tools: {} });
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, app)).toBeNull();
    expect((await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, app))?.result.tools.map((t: { name: string }) => t.name)).toEqual(["command_list", "command_run", "command_batch"]);
    const list = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "command_list", arguments: {} } }, app);
    expect(JSON.parse(list?.result.content[0].text)).toEqual([{ id: "edit.undo" }]);
    expect((await handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "command_run", arguments: { id: "edit.undo" } } }, app))?.result.isError).toBe(false);
    expect((await handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "command_run", arguments: { id: "x" } } }, app))?.result.isError).toBe(true);
    expect((await handleMcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "command_batch", arguments: { steps: [{ id: "a" }], stop_on_error: false } } }, app))?.result.isError).toBe(false);
    expect(calls.at(-1)).toEqual(["batch", { steps: [{ id: "a" }], stopOnError: false }]);
    expect((await handleMcp({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "command_run", arguments: { id: "a", evil: 1 } } }, app))?.error.code).toBe(-32602);
    expect((await handleMcp({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nope" } }, app))?.error.code).toBe(-32602);
    expect((await handleMcp({ jsonrpc: "2.0", id: 9, method: "nope" }, app))?.error.code).toBe(-32601);
  });

  it("reads and writes WebSocket frames, and lets only a page with the code connect", () => {
    for (const text of ["hi", "x".repeat(300), "y".repeat(70000)]) {
      const frame = encodeFrame(text);
      // (a client's frame is masked)
      const mask = Buffer.from([1, 2, 3, 4]);
      const head = frame.subarray(0, frame.length - Buffer.byteLength(text));
      const body = Buffer.from(text).map((b, i) => b ^ mask[i & 3]!);
      const masked = Buffer.concat([Buffer.from([head[0]!, head[1]! | 128]), head.subarray(2), mask, body]);
      const { frames, rest } = decodeFrames(Buffer.concat([masked, masked.subarray(0, 3)]));
      expect(frames.map((f: { data: Buffer }) => f.data.toString())).toEqual([text]);
      expect(rest.length).toBe(3);
    }
    expect(pageOrigin("null")).toBe(true);
    expect(pageOrigin("app://canvast")).toBe(true);
    expect(pageOrigin(undefined)).toBe(true);
    expect(pageOrigin("https://example.com")).toBe(false);
    expect(newCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("passes an agent's call to the page connected with the code, and refuses one without it", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: unknown[] = [];
    output.on("data", (b: Buffer) => b.toString().split("\n").filter(Boolean).forEach((l) => lines.push(JSON.parse(l))));
    const bridge = await startBridge({ code: "ABCD-EFGH-JKLM", port: 0, input, output, log: () => undefined });
    const connect = (path: string, origin = "null"): Promise<Socket> => new Promise((ok) => {
      const s = netConnect(bridge.port, "127.0.0.1", () => {
        s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`);
        ok(s);
      });
    });
    const firstLine = (s: Socket): Promise<string> => new Promise((ok) => s.once("data", (d: Buffer) => ok(d.toString().split("\r\n")[0]!)));
    const bad = await connect("/canvast?code=WRONG");
    expect(await firstLine(bad)).toContain("403");
    const site = await connect("/canvast?code=ABCD-EFGH-JKLM", "https://example.com");
    expect(await firstLine(site)).toContain("403");
    const page = await connect("/canvast?code=ABCD-EFGH-JKLM");
    expect(await firstLine(page)).toContain("101");
    // the page answers what the tools pass on
    page.on("data", (d: Buffer) => {
      const { frames } = decodeFrames(d);
      for (const f of frames) {
        const req = JSON.parse(f.data.toString()) as { id: number; method: string };
        const reply = Buffer.from(JSON.stringify({ id: req.id, result: { ok: true, value: req.method } }));
        const mask = Buffer.from([9, 8, 7, 6]);
        page.write(Buffer.concat([Buffer.from([0x81, 0x80 | reply.length]), mask, reply.map((b, i) => b ^ mask[i & 3]!)]));
      }
    });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "command_run", arguments: { id: "edit.undo" } } })}\n`);
    await expect.poll(() => lines.length).toBe(1);
    expect(JSON.parse((lines[0] as { result: { content: Array<{ text: string }> } }).result.content[0]!.text)).toEqual({ ok: true, value: "run" });
    page.destroy();
    bridge.close();
  });
});
