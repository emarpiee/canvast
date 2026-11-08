/**
 * The host side of sharing (ADR 0184) in the main process: the read calls the server may make, its certificate and allowed devices
 * (kept in the app's own settings folder, never in the workspace), and the page's `canvast:share` call to start, stop and manage it.
 * Sharing is off at every start; so is sharing the hidden items.
 */
import { app, ipcMain, shell } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeSelfCert } from "./self-cert";
import type { SelfCert } from "./self-cert";
import { guestPage, newCode, newDavPassword, pathAllowed, startShare } from "./share-server";
import { answerFinds } from "./share-find";
import { hostname } from "node:os";
import type { DavClient, ShareCall, ShareDevice, ShareEvent, ShareServer } from "./share-server";
import type { DavEntry, DavLogin, DavRights, DavRoot } from "./share-dav";

/** The event a read call gets when a guest makes it (the handlers' own check lets it through). */
export const SHARED = { sender: null } as unknown as IpcMainInvokeEvent;
/** The read calls of the main process, by channel, as the server makes them. */
export const SHARE_CALLS = new Map<string, ShareCall>();

interface Saved {
  cert?: SelfCert;
  /** The code guests type, and the file managers' password: kept until the person asks for new ones. */
  code?: string;
  davPassword?: string;
  /** Start sharing when the app opens (off by default; the hidden items are never shared at a start): the parts that were on. */
  autoStart?: boolean;
  guestsOn?: boolean;
  davOn?: boolean;
  /** The devices' own logins to the folder, and the shared password turned off. */
  davLogins?: DavLogin[];
  davSharedOff?: boolean;
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

/** The sharing log: a file in the app's settings folder (one older file kept past 1 MiB), the latest lines in memory for Settings. */
const logFile = (): string => join(app.getPath("userData"), "share-log.txt");
const recent: ShareEvent[] = [];
function logEvent(e: ShareEvent): void {
  recent.unshift(e);
  recent.length = Math.min(recent.length, 50);
  try {
    if ((statSync(logFile(), { throwIfNoEntry: false })?.size ?? 0) > 1 << 20) renameSync(logFile(), `${logFile()}.1`);
    appendFileSync(logFile(), `${new Date(e.at).toISOString()}\t${e.what}\t${e.who}\t${e.address}\n`, { mode: 0o600 });
  } catch {
    /* the log is a help, never a reason to stop sharing */
  }
}

let server: ShareServer | null = null;
/** What is shared now: with guests, and the file managers' folder (the server runs while either is on). */
const parts = { guests: false, dav: false };
let hidden = false;

/** The folder changed (as the page is told): guests are told too, without the paths they may not read. */
export function shareChanged(paths: readonly string[]): void {
  const shown = paths.filter((p) => pathAllowed(p, hidden));
  if (server && shown.length) server.send("changed", shown);
}

export interface ShareStatus {
  on: boolean;
  guests: boolean;
  davOn: boolean;
  hidden: boolean;
  port: number;
  code: string;
  addresses: string[];
  fingerprint: string;
  autoStart: boolean;
  /** The latest of the log, the newest first. */
  log: ShareEvent[];
  /** The apps that used the file managers' folder since sharing started. */
  davClients: DavClient[];
  /** The devices' own logins to the folder (their passwords shown to the host, as the shared one), and whether the shared password is on. */
  davLogins: DavLogin[];
  davShared: boolean;
  /** The file managers' folder: its address on this computer, and its password. */
  dav: { url: string; others: string[]; password: string } | null;
  devices: Array<{ id: string; name: string; added: number; seen: number | null; active: boolean }>;
}

/** A list read again only after a few seconds (a file manager asks for it at every step), or at once after a change (`forget`). */
function cached(read: () => Promise<DavEntry[]>, ms = 3000): { list: () => Promise<DavEntry[]>; forget: () => void } {
  let at = 0;
  let last: Promise<DavEntry[]> = Promise.resolve([]);
  return {
    list: () => {
      if (Date.now() - at > ms) {
        at = Date.now();
        last = read().catch(() => []);
      }
      return last;
    },
    forget: () => void (at = 0),
  };
}

/** The main process's file changes the folder makes for a device allowed to (the same handlers, and path rules, as the page's). */
export const WRITE_CALLS = new Map<string, ShareCall>();

export function installShare(win: BrowserWindow, html: string, workspaceName: string): void {
  let stopFind: (() => void) | null = null;
  const saved = load();
  const answers = new Map<string, (ok: boolean) => void>();
  // The hidden items are opened by the page (it holds their key while they are open): asked there, and answered back.
  const davAsks = new Map<string, (v: unknown) => void>();
  const askPage = (op: "list" | "read" | "thumb", arg?: unknown): Promise<unknown> =>
    new Promise((ok) => {
      if (win.isDestroyed()) return ok(null);
      const id = randomBytes(8).toString("hex");
      davAsks.set(id, ok);
      setTimeout(() => davAsks.delete(id) && ok(undefined), 30_000); // (undefined: the page did not answer; null: it cannot)
      win.webContents.send("canvast:davAsk", { id, op, arg });
    });
  const call = (ch: string, ...a: unknown[]): Promise<unknown> => SHARE_CALLS.get(ch)!(...a);
  // A guest's thumbnails: the host's page has them (never a hidden item's), so a guest does not read every original to draw its own.
  SHARE_CALLS.set("canvast:thumb", async (hash) => (typeof hash === "string" && /^[0-9a-f]{64}(?:~\d+)?$/.test(hash) ? ((await askPage("thumb", hash)) ?? null) : null));
  const libList = cached(async () => ((await call("canvast:tree", "library")) as Array<{ path: string; size: number }>).map((f) => ({ path: f.path.replace(/^library\//, ""), size: f.size })));
  // The hidden items as the page lists them; while they are locked there, one note saying so, so a file manager's empty folder is not a mystery.
  // Each change of what the folder gets (listed, locked, no answer) is in the activity.
  const LOCKED = { path: "Locked - open the hidden items on the host computer.txt", text: new TextEncoder().encode("The hidden items are locked on the computer sharing this folder.\nOpen them there (the Hidden password), then refresh this folder.\n") };
  let hiddenSaid = "";
  const hiddenList = cached(async () => {
    const got = (await askPage("list")) as DavEntry[] | null | undefined;
    const said = got ? `Folder: hidden items listed (${got.length})` : got === null ? "Folder: hidden items asked for, but they are locked on this computer" : "Folder: hidden items asked for, but the app's page did not answer";
    if (said !== hiddenSaid) logEvent({ at: Date.now(), what: said, who: "", address: "" });
    hiddenSaid = said;
    return got ?? [{ path: LOCKED.path, size: LOCKED.text.length }];
  });
  const write = (ch: string, ...a: unknown[]): Promise<unknown> => WRITE_CALLS.get(ch)!(...a);
  const dav: Record<string, DavRoot> = {
    Library: {
      list: libList.list,
      read: (p, from, to) => call("canvast:part", `library/${p}`, from, to) as Promise<Uint8Array | null>,
      // (what a device adds or changes is a file changed outside the app: the app takes it in as it does any such file)
      writes: {
        put: async (p, bytes) => void (await write("canvast:write", `library/${p}`, bytes)),
        mkdir: async (p) => void (await write("canvast:makeFolder", `library/${p}`)),
        remove: async (p) => void (await write("canvast:remove", `library/${p}`, "trash")),
        move: async (from, to) => void (await write("canvast:rename", `library/${from}`, `library/${to}`)),
      },
      changed: libList.forget,
    },
    Hidden: {
      hidden: true,
      list: hiddenList.list,
      read: async (p, from, to) => (p === LOCKED.path ? LOCKED.text.slice(from, to) : (((await askPage("read", { path: p, from, to })) as Uint8Array | null) ?? null)),
    },
  };
  const status = (): ShareStatus => {
    const active = new Set(server?.active() ?? []);
    return {
      on: !!server,
      guests: parts.guests,
      davOn: parts.dav,
      hidden,
      autoStart: saved.autoStart === true,
      log: recent.slice(0, 15),
      davClients: server?.davClients() ?? [],
      davLogins: saved.davLogins ?? [],
      davShared: saved.davSharedOff !== true,
      port: server?.port ?? 0,
      code: server?.code ?? "",
      addresses: server?.addresses ?? [],
      fingerprint: saved.cert?.fingerprint ?? "",
      dav: server ? { url: `davs://127.0.0.1:${server.port}/dav/`, others: server.addresses.map((a) => `https://${a}:${server!.port}/dav/`), password: server.davPassword } : null,
      devices: (saved.devices ?? []).map((d) => ({ id: d.id, name: d.name, added: d.added, seen: d.seen ?? null, active: active.has(d.id) })),
    };
  };
  // The page is told at most every half second (a file manager makes many requests a second: one update for all of them).
  let pushing: ReturnType<typeof setTimeout> | null = null;
  const push = (): void => {
    pushing ??= setTimeout(() => {
      pushing = null;
      if (!win.isDestroyed()) win.webContents.send("canvast:shareStatus", status());
    }, 500);
  };
  const start = async (port: number): Promise<ShareServer> =>
    startShare({
      cert: (saved.cert ??= makeSelfCert()),
      code: (saved.code ??= newCode()),
      davPassword: (saved.davPassword ??= newDavPassword()),
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
      davLogins: () => saved.davLogins ?? [],
      davShared: () => saved.davSharedOff !== true,
      parts: () => parts,
      log: (e) => {
        logEvent(e);
        push();
      },
      dav,
      page: async () => guestPage(await readFile(html, "utf8")) ?? "<!doctype html><title>canvast</title><p>This version of canvast cannot be shared.</p>",
    });
  const begin = async (): Promise<void> => {
    if (server) return;
    // The same port as last time when it is free, so the addresses stay the same.
    server = await start(saved.port ?? 0).catch(() => start(0));
    saved.port = server.port;
    keep(saved);
    logEvent({ at: Date.now(), what: `Sharing started on port ${server.port}`, who: "", address: "" });
  };
  const end = async (): Promise<void> => {
    if (!server) return;
    logEvent({ at: Date.now(), what: "Sharing stopped", who: "", address: "" });
    await server.close();
    server = null;
    hidden = false;
  };
  /** Turn a part on or off: the server runs while one is; guests are found on the network only while they are shared. */
  const setPart = async (part: "guests" | "dav", on: boolean): Promise<void> => {
    if (parts[part] !== on) logEvent({ at: Date.now(), what: `${part === "guests" ? "Sharing with guests" : "Folder for file managers"} ${on ? "on" : "off"}`, who: "", address: "" });
    parts[part] = on;
    if (part === "guests") saved.guestsOn = on;
    else saved.davOn = on;
    keep(saved);
    if (parts.guests || parts.dav) await begin();
    else await end();
    if (part === "guests" && !on) {
      server?.dropGuests();
      hidden = false;
    }
    stopFind?.();
    stopFind = null;
    const s = server;
    if (s && parts.guests) stopFind = answerFinds(() => ({ name: `${hostname()} · ${workspaceName}`, port: s.port, fingerprint: s.fingerprint }));
  };
  // (Settings > Sharing: started with the app when the person asked for it; the hidden items never are)
  if (saved.autoStart && (saved.guestsOn || saved.davOn))
    void (async () => {
      if (saved.guestsOn) await setPart("guests", true);
      if (saved.davOn) await setPart("dav", true);
    })().then(push, (err: unknown) => logEvent({ at: Date.now(), what: `Sharing could not start: ${(err as Error).message}`, who: "", address: "" }));
  ipcMain.handle("canvast:share", async (e, op: unknown, arg: unknown) => {
    if (e.sender !== win.webContents) throw new Error("not this window");
    switch (op) {
      case "status":
        return status();
      case "start":
      case "stop":
      case "guests":
      case "dav":
        await setPart(op === "dav" ? "dav" : "guests", op === "start" || ((op === "guests" || op === "dav") && arg === true));
        push();
        return status();
      case "davAdd": {
        const name = typeof arg === "string" ? arg.trim().slice(0, 60) : "";
        if (!name) throw new Error("A name for the device.");
        const list = saved.davLogins ?? [];
        const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "device";
        let user = base;
        for (let k = 2; list.some((l) => l.user === user); k++) user = `${base}-${k}`;
        saved.davLogins = [...list, { id: randomBytes(8).toString("hex"), name, user, password: newDavPassword(), rights: { add: true, edit: false, move: false, delete: false, hidden: false }, added: Date.now() }];
        keep(saved);
        logEvent({ at: Date.now(), what: `Folder login added (${user})`, who: name, address: "" });
        push();
        return status();
      }
      case "davLogin": {
        // (rename, a right on or off, a new password, or removed)
        const a = arg as { id?: unknown; name?: unknown; right?: unknown; on?: unknown; newPassword?: unknown; remove?: unknown } | null;
        const login = (saved.davLogins ?? []).find((l) => l.id === a?.id);
        if (!login) throw new Error("No such login.");
        if (a?.remove === true) {
          saved.davLogins = (saved.davLogins ?? []).filter((l) => l !== login);
          logEvent({ at: Date.now(), what: "Folder login removed", who: login.name, address: "" });
        } else if (typeof a?.name === "string" && a.name.trim()) login.name = a.name.trim().slice(0, 60);
        else if (a?.newPassword === true) login.password = newDavPassword();
        else if (typeof a?.right === "string" && ["add", "edit", "move", "delete", "hidden"].includes(a.right)) {
          login.rights = { ...login.rights, [a.right]: a.on === true } as DavRights;
          logEvent({ at: Date.now(), what: `Folder right “${a.right}” ${a.on === true ? "given" : "taken away"}`, who: login.name, address: "" });
        }
        keep(saved);
        push();
        return status();
      }
      case "davShared":
        saved.davSharedOff = arg !== true;
        keep(saved);
        push();
        return status();
      case "autoStart":
        saved.autoStart = arg === true;
        keep(saved);
        push();
        return status();
      case "openLog":
        logEvent({ at: Date.now(), what: "Log opened", who: "", address: "" });
        await shell.openPath(logFile());
        return null;
      case "hidden":
        hidden = arg === true;
        server?.send("changed", [".canvast/hidden.json"]); // (guests look for the hidden items again)
        push();
        return status();
      case "newCode":
      case "newDavPassword":
      case "setDavPassword": {
        if (op === "setDavPassword" && (typeof arg !== "string" || arg.length < 8 || arg.length > 200)) throw new Error("A password of at least 8 characters.");
        if (op === "newCode") saved.code = newCode();
        else saved.davPassword = op === "setDavPassword" ? (arg as string) : newDavPassword();
        keep(saved);
        if (server) {
          // (taken at once: the server starts again on the same port; guests already allowed stay allowed)
          const port = server.port;
          await server.close();
          stopFind?.();
          stopFind = null;
          server = await start(port).catch(() => start(0));
          const s = server;
          saved.port = s.port;
          keep(saved);
          if (parts.guests) stopFind = answerFinds(() => ({ name: `${hostname()} · ${workspaceName}`, port: s.port, fingerprint: s.fingerprint }));
        }
        push();
        return status();
      }
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
      case "davAnswer": {
        const a = arg as { id?: unknown; value?: unknown } | null;
        if (typeof a?.id === "string") davAsks.get(a.id)?.(a.value ?? null);
        if (typeof a?.id === "string") davAsks.delete(a.id);
        return null;
      }
      case "openDav":
        if (server) await shell.openExternal(`davs://canvast@127.0.0.1:${server.port}/dav/`);
        return null;
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
