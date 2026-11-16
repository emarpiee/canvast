// The canvast tools' link to AI agents (ADR 0205): `canvast-tools mcp`. An AI agent (an MCP client: Claude Desktop, Claude Code, …) starts
// it and talks MCP to it over its standard input and output; canvast (the app, in a browser or the desktop app) connects to it on this
// computer (ws://127.0.0.1:47380) once Settings > AI agents is on and has the pairing code these tools show. A call of the agent goes on to
// the app as `{ id, method, params }` (list, run, batch) and its answer comes back. Nothing else is listened to: only 127.0.0.1, only a
// page (a file:// or the desktop app's, never a website), only with the code. No dependency: Node.js 20 or later.
import { createHash, randomInt } from "node:crypto";
import { createServer } from "node:http";

export const AGENT_PORT = 47380;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const PROTOCOL = "2025-06-18";
const WAIT_FOR_APP_MS = 15000;
const ANSWER_MS = 120000;

/** A new pairing code: three groups of four letters and digits (easy to read and type, about 60 bits). */
export function newCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const group = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

/** Whether a page may connect: a page opened from a file (its origin is "null"), the desktop app's (app:), or no origin; never a website. */
export const pageOrigin = (origin) => origin === undefined || origin === "null" || origin.startsWith("app:") || origin.startsWith("file:");

// ---- WebSocket frames (RFC 6455, text and control frames only) ----
export function encodeFrame(text, opcode = 1) {
  const body = Buffer.from(text, "utf8");
  const n = body.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, body]);
}

/** Frames read from `buf` (a client's: masked); `rest` is what is not a whole frame yet. */
export function decodeFrames(buf) {
  const frames = [];
  let at = 0;
  for (;;) {
    if (buf.length - at < 2) break;
    const b0 = buf[at], b1 = buf[at + 1];
    let len = b1 & 127, off = at + 2;
    if (len === 126) {
      if (buf.length - off < 2) break;
      len = buf.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (buf.length - off < 8) break;
      len = Number(buf.readBigUInt64BE(off));
      off += 8;
    }
    const masked = (b1 & 128) !== 0;
    const maskAt = off;
    if (masked) off += 4;
    if (buf.length - off < len) break;
    const data = Buffer.from(buf.subarray(off, off + len));
    if (masked) for (let i = 0; i < len; i++) data[i] ^= buf[maskAt + (i & 3)];
    frames.push({ fin: (b0 & 128) !== 0, opcode: b0 & 15, data });
    at = off + len;
  }
  return { frames, rest: buf.subarray(at) };
}

// ---- MCP: what the agent sees ----
export const TOOLS = [
  {
    name: "command_list",
    title: "List canvast's commands",
    description: "Every command of canvast with its id, title, hint, options (name, type, whether required), risk (read, edit, confirm: asks the person first, refused: never for an agent), and whether it can run now and why not. Read this first, then run a command by id.",
    inputSchema: { type: "object", properties: { filter: { type: "string", description: "only commands whose id, title or group contain this" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "command_run",
    title: "Run a canvast command",
    description: "Run one command by its id with its options. The answer says whether it was done, what it made or changed, or why not. A risky command (deleting, hidden items, writing files) waits for the person to allow it in canvast.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "the command's id, from command_list" }, options: { type: "object", description: "its options, as command_list describes them" } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "command_batch",
    title: "Run several canvast commands",
    description: "Run commands in order; stops at the first that fails unless stop_on_error is false. Not one undo step: what ran stays. At most 256 steps. The answer is short: how many ran, what the batch made, changed or removed, and only the steps that failed or read something (by their number); details: true gives every step's answer.",
    inputSchema: { type: "object", properties: { steps: { type: "array", items: { type: "object", properties: { id: { type: "string" }, options: { type: "object" } }, required: ["id"] } }, stop_on_error: { type: "boolean" }, details: { type: "boolean", description: "every step's answer, not only the failed ones and those that read something" } }, required: ["steps"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

/** The answer to one MCP request (null for a notification). `app(method, params)` asks canvast. */
export async function handleMcp(msg, app, version = "0") {
  const { id, method, params } = msg ?? {};
  const reply = (result) => (id === undefined ? null : { jsonrpc: "2.0", id, result });
  const fail = (code, message) => (id === undefined ? null : { jsonrpc: "2.0", id, error: { code, message } });
  if (typeof method !== "string") return fail(-32600, "Not a request.");
  if (method === "initialize") return reply({ protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "canvast", title: "canvast", version }, instructions: "canvast is an endless canvas and a library of files. Call command_list first: every action of canvast is a command with an id. Risky commands wait for the person to allow them in canvast." });
  if (method === "ping") return reply({});
  if (method.startsWith("notifications/")) return null;
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method !== "tools/call") return fail(-32601, `No method ${method}.`);
  const name = params?.name;
  const args = params?.arguments ?? {};
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(-32602, `No tool ${String(name)}: ${TOOLS.map((t) => t.name).join(", ")}.`);
  const known = Object.keys(tool.inputSchema.properties);
  const extra = Object.keys(args).filter((k) => !known.includes(k));
  if (extra.length) return fail(-32602, `${name} takes no ${extra.join(", ")}.`);
  const text = (value, isError = false) => reply({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }], isError });
  try {
    if (name === "command_list") return text(await app("list", { filter: typeof args.filter === "string" ? args.filter : "" }));
    if (name === "command_run") {
      if (typeof args.id !== "string") return text("command_run needs id.", true);
      const r = await app("run", { id: args.id, options: args.options ?? {} });
      return text(r, !r?.ok);
    }
    if (!Array.isArray(args.steps)) return text("command_batch needs steps.", true);
    const r = await app("batch", { steps: args.steps, stopOnError: args.stop_on_error !== false, details: args.details === true });
    return text(r, !r?.ok);
  } catch (e) {
    return text(e.message, true);
  }
}

/**
 * Start the link: the WebSocket server canvast connects to, and the MCP server on `input`/`output` (the agent's). `log` goes to the
 * standard error (the agent's log), never to the output, which is the protocol's. Resolves with `close()`.
 */
export function startBridge({ code, port = AGENT_PORT, input = process.stdin, output = process.stdout, log = (s) => process.stderr.write(`${s}\n`), version = "0" }) {
  let page = null; // { send(obj), close() }
  const waiting = new Map();
  let next = 1;
  const pageWaiters = new Set();
  const server = createServer((_req, res) => {
    res.writeHead(426, { "content-type": "text/plain" }).end("canvast tools: only canvast connects here.\n");
  });
  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const key = req.headers["sec-websocket-key"];
    if (url.pathname !== "/canvast" || url.searchParams.get("code") !== code || !pageOrigin(req.headers.origin) || typeof key !== "string") {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return log("canvast tools: a connection without the pairing code, or not from canvast, was refused.");
    }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash("sha1").update(key + GUID).digest("base64")}\r\n\r\n`);
    page?.close();
    let buf = Buffer.alloc(0);
    let parts = [];
    const me = {
      send: (obj) => socket.write(encodeFrame(JSON.stringify(obj))),
      close: () => socket.destroy(),
    };
    page = me;
    log("canvast tools: canvast is connected.");
    for (const w of pageWaiters) w();
    pageWaiters.clear();
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 64 * 1024 * 1024) return socket.destroy(); // (an answer is never this big)
      const { frames, rest } = decodeFrames(buf);
      buf = Buffer.from(rest);
      for (const f of frames) {
        if (f.opcode === 8) return socket.end(encodeFrame("", 8));
        if (f.opcode === 9) socket.write(encodeFrame(f.data.toString("utf8"), 10));
        if (f.opcode !== 1 && f.opcode !== 0) continue;
        parts.push(f.data);
        if (!f.fin) continue;
        const text = Buffer.concat(parts).toString("utf8");
        parts = [];
        let m;
        try {
          m = JSON.parse(text);
        } catch {
          continue;
        }
        const w = waiting.get(m.id);
        if (!w) continue;
        waiting.delete(m.id);
        if (m.error !== undefined) w.reject(new Error(String(m.error)));
        else w.resolve(m.result);
      }
    });
    socket.on("close", () => {
      if (page === me) {
        page = null;
        log("canvast tools: canvast disconnected.");
        for (const [, w] of waiting) w.reject(new Error("canvast closed the link before it answered."));
        waiting.clear();
      }
    });
    socket.on("end", () => socket.destroy()); // (the page went away without a close frame: free the link at once)
    socket.on("error", () => undefined);
  });
  const app = async (method, params) => {
    if (!page) {
      await new Promise((ok, no) => {
        const t = setTimeout(() => (pageWaiters.delete(go), no(new Error(`canvast is not connected. Open canvast, then Settings > AI agents: turn on "Let AI agents use canvast" and type the pairing code ${code}.`))), WAIT_FOR_APP_MS);
        const go = () => (clearTimeout(t), ok());
        pageWaiters.add(go);
      });
    }
    const id = next++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => (waiting.delete(id), reject(new Error("canvast did not answer in time (a dialog may be waiting for the person)."))), ANSWER_MS);
      waiting.set(id, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) });
      page.send({ id, method, params });
    });
  };
  // MCP over the standard input and output: one JSON message a line
  let pending = "";
  const write = (obj) => obj && output.write(`${JSON.stringify(obj)}\n`);
  input.setEncoding?.("utf8");
  input.on("data", (chunk) => {
    pending += chunk;
    let nl;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Not JSON." } });
        continue;
      }
      void handleMcp(msg, app, version).then(write);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", (e) => reject(e.code === "EADDRINUSE" ? new Error(`port ${port} is in use: is another canvast-tools mcp running?`) : e));
    server.listen(port, "127.0.0.1", () => resolve({ close: () => (page?.close(), server.close()), port: server.address().port }));
  });
}
