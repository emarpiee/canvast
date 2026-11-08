/**
 * The host side of sharing (ADR 0184) in the main process: the read calls the server may make, its certificate and allowed devices
 * (kept in the app's own settings folder, never in the workspace), and the page's `canvast:share` call to start, stop and manage it.
 * Sharing is off at every start; so is sharing the hidden items.
 */
import { app, ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeSelfCert } from "./self-cert";
import type { SelfCert } from "./self-cert";
import { guestPage, pathAllowed, startShare } from "./share-server";
import { answerFinds } from "./share-find";
import { hostname } from "node:os";
import type { ShareCall, ShareDevice, ShareServer } from "./share-server";

/** The event a read call gets when a guest makes it (the handlers' own check lets it through). */
export const SHARED = { sender: null } as unknown as IpcMainInvokeEvent;
/** The read calls of the main process, by channel, as the server makes them. */
export const SHARE_CALLS = new Map<string, ShareCall>();

interface Saved {
  cert?: SelfCert;
  devices?: ShareDevice[];
  port?: number;
}
const file = (): string => join(app.getPath("userData"), "share.json");
function load(): Saved {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Saved;
  } catch {
    return {};
  }
}
function keep(s: Saved): void {
  writeFileSync(file(), JSON.stringify(s), { mode: 0o600 });
  chmodSync(file(), 0o600); // (its private key: this user only)
}

let server: ShareServer | null = null;
let hidden = false;

/** The folder changed (as the page is told): guests are told too, without the paths they may not read. */
export function shareChanged(paths: readonly string[]): void {
  const shown = paths.filter((p) => pathAllowed(p, hidden));
  if (server && shown.length) server.send("changed", shown);
}

export interface ShareStatus {
  on: boolean;
  hidden: boolean;
  port: number;
  code: string;
  addresses: string[];
  fingerprint: string;
  devices: Array<{ id: string; name: string; added: number; seen: number | null; active: boolean }>;
}

export function installShare(win: BrowserWindow, html: string, workspaceName: string): void {
  let stopFind: (() => void) | null = null;
  const saved = load();
  const answers = new Map<string, (ok: boolean) => void>();
  const status = (): ShareStatus => {
    const active = new Set(server?.active() ?? []);
    return {
      on: !!server,
      hidden,
      port: server?.port ?? 0,
      code: server?.code ?? "",
      addresses: server?.addresses ?? [],
      fingerprint: saved.cert?.fingerprint ?? "",
      devices: (saved.devices ?? []).map((d) => ({ id: d.id, name: d.name, added: d.added, seen: d.seen ?? null, active: active.has(d.id) })),
    };
  };
  const push = (): void => {
    if (!win.isDestroyed()) win.webContents.send("canvast:shareStatus", status());
  };
  const start = async (port: number): Promise<ShareServer> =>
    startShare({
      cert: (saved.cert ??= makeSelfCert()),
      port,
      calls: SHARE_CALLS,
      hidden: () => hidden,
      ask: (device) =>
        new Promise((ok) => {
          const id = randomBytes(8).toString("hex");
          answers.set(id, ok);
          if (win.isDestroyed()) return ok(false);
          win.webContents.send("canvast:shareAsk", { id, ...device });
        }),
      devices: {
        load: () => saved.devices ?? [],
        save: (list) => {
          saved.devices = list;
          keep(saved);
        },
      },
      changed: push,
      page: async () => guestPage(await readFile(html, "utf8")) ?? "<!doctype html><title>canvast</title><p>This version of canvast cannot be shared.</p>",
    });
  ipcMain.handle("canvast:share", async (e, op: unknown, arg: unknown) => {
    if (e.sender !== win.webContents) throw new Error("not this window");
    switch (op) {
      case "status":
        return status();
      case "start":
        if (!server) {
          // The same port as last time when it is free, so a guest's address stays the same.
          server = await start(saved.port ?? 0).catch(() => start(0));
          saved.port = server.port;
          keep(saved);
          const s = server;
          stopFind = answerFinds(() => ({ name: `${hostname()} · ${workspaceName}`, port: s.port, fingerprint: s.fingerprint }));
        }
        push();
        return status();
      case "stop":
        await server?.close();
        stopFind?.();
        stopFind = null;
        server = null;
        hidden = false;
        push();
        return status();
      case "hidden":
        hidden = arg === true;
        push();
        return status();
      case "remove":
        if (typeof arg !== "string") throw new Error("a device id expected");
        if (server) server.remove(arg);
        else {
          saved.devices = (saved.devices ?? []).filter((d) => d.id !== arg);
          keep(saved);
        }
        push();
        return status();
      case "answer": {
        const a = arg as { id?: unknown; ok?: unknown } | null;
        if (typeof a?.id === "string") answers.get(a.id)?.(a.ok === true);
        if (typeof a?.id === "string") answers.delete(a.id);
        return null;
      }
      case "view":
        // The host's view, for guests that follow it.
        server?.send("view", arg);
        return null;
      default:
        throw new Error("not a sharing call");
    }
  });
  win.on("closed", () => {
    stopFind?.();
    void server?.close();
  });
}
