/**
 * Finding shared workspaces on the local network (ADR 0184): a guest broadcasts one short UDP question; each host that shares answers
 * with its name, port and certificate fingerprint. Nothing else is sent, and a host answers only while it shares.
 */
import { createSocket } from "node:dgram";
import type { Socket } from "node:dgram";

export const FIND_PORT = 47_321;
const ASK = "canvast-find-1";

export interface FoundHost {
  name: string;
  address: string;
  port: number;
  fingerprint: string;
}

/** Answer guests' questions while sharing; stop with the function it returns. */
export function answerFinds(about: () => Omit<FoundHost, "address">, port = FIND_PORT): () => void {
  const sock: Socket = createSocket({ type: "udp4", reuseAddr: true });
  sock.on("message", (msg, from) => {
    if (msg.toString("utf8") !== ASK) return;
    sock.send(JSON.stringify({ app: "canvast", ...about() }), from.port, from.address);
  });
  sock.on("error", () => sock.close()); // (the port taken: this host is found by its address instead)
  sock.bind(port);
  return () => {
    try {
      sock.close();
    } catch {
      /* already closed */
    }
  };
}

/** Ask the network which hosts share, for `ms` milliseconds. */
export function findHosts(ms = 1500, port = FIND_PORT, to = "255.255.255.255"): Promise<FoundHost[]> {
  return new Promise((done) => {
    const found = new Map<string, FoundHost>();
    const sock = createSocket({ type: "udp4" });
    sock.on("message", (msg, from) => {
      try {
        const h = JSON.parse(msg.toString("utf8")) as Partial<FoundHost> & { app?: string };
        if (h.app === "canvast" && typeof h.name === "string" && Number.isInteger(h.port) && typeof h.fingerprint === "string")
          found.set(`${from.address}:${h.port}`, { name: h.name.slice(0, 80), address: from.address, port: h.port!, fingerprint: h.fingerprint });
      } catch {
        /* not an answer */
      }
    });
    sock.on("error", () => done([...found.values()]));
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(ASK, port, to);
    });
    setTimeout(() => {
      sock.close();
      done([...found.values()]);
    }, ms);
  });
}

/** Parse "192.168.1.5:47000" (or a full https:// address). */
export function parseAddress(text: string): { address: string; port: number } | null {
  const m = /^(?:https:\/\/)?([\w.-]+|\[[0-9a-f:]+\]):(\d{1,5})\/?$/i.exec(text.trim());
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65_536 ? { address: m[1]!, port } : null;
}
