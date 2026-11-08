/**
 * A guest's bridge (ADR 0184): the desktop storage's calls, answered by the host over HTTPS. Reads go to the host; every write is
 * left undone here (the host's folder is never changed by a guest). The library's lists of shown items are the host's; the hidden
 * items' details are a guest's own, from the index it opens with the Hidden password, kept in this page only.
 */
import type { AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import { FOLDERS_KEY } from "../assets/asset-catalog";
import type { AssetRecord } from "../assets/asset-library";
import { LibraryIndex } from "../../desktop/library-index";
import type { LibraryQuery } from "../../desktop/library-index";
import type { DesktopBridge, LibraryCalls, LibraryOp } from "./desktop-bridge";
import { entryOf, recStubOf } from "./library-mirror";
import type { LibraryItem } from "./library-mirror";
import { scryptJs } from "./scrypt";
import { isGuestPage } from "./guest-page";
export { isGuestPage };

/** Raised by a call the host refused or could not answer. */
export class HostError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** One read call to the host: bytes, or the JSON value it answered. */
export type HostCall = (ch: string, ...args: unknown[]) => Promise<unknown>;

export function hostCalls(origin: string, token: string): HostCall {
  return async (ch, ...args) => {
    const res = await fetch(`${origin}/call`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ch, args }) });
    if (res.headers.get("content-type")?.startsWith("application/octet-stream")) return new Uint8Array(await res.arrayBuffer());
    const body = (await res.json().catch(() => ({}))) as { v?: unknown; error?: string };
    if (!res.ok) throw new HostError(body.error ?? `the host answered ${res.status}`, res.status);
    return body.v ?? null;
  };
}

const readOnly = (): never => {
  throw new Error("This workspace is shared read-only: nothing here can be changed.");
};

/**
 * The library of a guest: the host's for the shown items (its database is kept up to date by the host app), and a page-only copy of
 * the hidden items the guest opened. Changes the storage makes are kept here, for this page, and never sent.
 */
export class GuestLibrary implements LibraryCalls {
  private readonly mine = new Map<string, CatalogEntry>();
  private readonly myRecs = new Map<string, AssetRecord>();
  private readonly metas = new Map<string, unknown>();
  private readonly hiddenIndex: LibraryIndex;
  readonly listeners: Array<(op: LibraryOp) => void> = [];

  constructor(private readonly host: HostCall) {
    this.hiddenIndex = new LibraryIndex({
      listeners: this.listeners,
      meta: (k) => this.metas.get(k),
      activeJson: () => [...this.mine.values()].filter((e) => e.state === "active").map((e) => JSON.stringify(e)),
    });
  }

  private lib = <T>(op: string, ...args: unknown[]): Promise<T> => this.host("canvast:lib", op, ...args) as Promise<T>;
  private local = (hash: string): boolean => this.mine.has(hash);

  async get(hashes: readonly string[]): Promise<Array<[string, CatalogEntry | null, AssetRecord | null, string | null]>> {
    const remote = hashes.filter((h) => !this.local(h));
    const there = remote.length ? await this.lib<Array<[string, CatalogEntry | null, AssetRecord | null, string | null]>>("get", remote) : [];
    return [...there, ...hashes.filter((h) => this.local(h)).map((h): [string, CatalogEntry | null, AssetRecord | null, string | null] => [h, this.mine.get(h) ?? null, this.myRecs.get(h) ?? null, null])];
  }
  async entries(which: "all" | "active" | "deleted" | "hidden" = "all"): Promise<string> {
    const mine = [...this.mine.values()].filter((e) => which === "all" || which === "hidden" || (which === "active" ? e.state === "active" : e.state === "deleted"));
    const theirs = which === "hidden" ? [] : (JSON.parse(await this.lib<string>("entries", which)) as CatalogEntry[]).filter((e) => !this.local(e.hash));
    return JSON.stringify([...theirs, ...mine]);
  }
  async recs(which: "all" | "sealed" = "all"): Promise<string> {
    const mine = [...this.myRecs.values()];
    const theirs = which === "sealed" ? [] : (JSON.parse(await this.lib<string>("recs", which)) as AssetRecord[]).filter((r) => !this.local(r.hash));
    return JSON.stringify([...theirs, ...mine]);
  }
  async byFile(file: string): Promise<string | null> {
    for (const r of this.myRecs.values()) if ((r as { file?: string }).file === file) return r.hash;
    return this.lib<string | null>("byFile", file);
  }
  async meta(key: string): Promise<unknown> {
    if (this.metas.has(key)) return this.metas.get(key);
    return this.lib("meta", key);
  }
  async apply(ops: readonly LibraryOp[]): Promise<void> {
    for (const op of ops) {
      if (op.t === "entry") op.v ? this.mine.set(op.hash, op.v) : this.mine.delete(op.hash);
      else if (op.t === "rec") op.v ? this.myRecs.set(op.hash, op.v) : this.myRecs.delete(op.hash);
      else if (op.t === "meta") this.metas.set(op.k, op.v);
      for (const fn of this.listeners) fn(op);
    }
  }
  /** The parts are the host's (its database has them); the items given (the hidden index this page opened) are kept here. */
  async sync(_keys: readonly string[], extra: readonly unknown[]): Promise<{ took: boolean; whole: boolean; read: number }> {
    const ops: LibraryOp[] = [];
    for (const it of extra as LibraryItem[]) {
      ops.push({ t: "entry", hash: it.hash, v: entryOf(it, this.mine.get(it.hash)) });
      if (it.file) ops.push({ t: "rec", hash: it.hash, v: recStubOf({ ...it, file: it.file }) });
    }
    await this.apply(ops);
    return { took: ops.length > 0, whole: true, read: 0 };
  }
  async write(): Promise<{ sealed: unknown[]; compat: string }> {
    return { sealed: [], compat: "-" };
  }
  async unnamed(): Promise<Array<{ path: string; size: number }>> {
    return [];
  }
  async holds(): Promise<boolean> {
    return true; // (nothing is ever tidied away on a guest)
  }
  async query(q: unknown): Promise<{ hashes: string; ratios: Float32Array; total: number; bytes: number }> {
    if ((q as LibraryQuery).hidden) return this.hiddenIndex.query(q as LibraryQuery, new Set());
    const r = await this.lib<{ hashes: string; ratios: number[] | Record<string, number>; total: number; bytes: number }>("query", q);
    return { ...r, ratios: Float32Array.from(Array.isArray(r.ratios) ? r.ratios : Object.values(r.ratios)) };
  }
  async counts(hidden = false): Promise<Awaited<ReturnType<LibraryCalls["counts"]>>> {
    if (hidden) return this.hiddenIndex.counts(true);
    const c = await this.lib<Awaited<ReturnType<LibraryCalls["counts"]>>>("counts", false);
    return { ...c, hidden: [...this.mine.values()].filter((e) => e.state === "active" && e.hidden).length };
  }
  async fieldKeys(hidden = false): Promise<string[]> {
    return hidden ? this.hiddenIndex.fieldKeys(true) : this.lib("fieldKeys", false);
  }
  async fieldValues(key: string, hidden = false): Promise<string[]> {
    return hidden ? this.hiddenIndex.fieldValues(key, true) : this.lib("fieldValues", key, false);
  }
  async listed(hashes: readonly string[]): Promise<Array<CatalogEntry & { present: boolean }>> {
    const remote = hashes.filter((h) => !this.local(h));
    const there = remote.length ? await this.lib<Array<CatalogEntry & { present: boolean }>>("listed", remote) : [];
    const mine = hashes.filter((h) => this.local(h)).map((h) => ({ ...this.mine.get(h)!, present: true }));
    const byHash = new Map([...there, ...mine].map((e) => [e.hash, e]));
    return hashes.map((h) => byHash.get(h)).filter((e): e is CatalogEntry & { present: boolean } => !!e);
  }
  async absent(): Promise<string[]> {
    return this.lib("absent");
  }
  async orphans(): Promise<string> {
    return "[]";
  }
  async pending(): Promise<string[]> {
    return [];
  }
  async parts(): Promise<Record<string, string>> {
    return {};
  }
  async reset(): Promise<void> {
    this.mine.clear();
    this.myRecs.clear();
    this.metas.clear();
  }
  onProgress(): void {}
  /** The folders: the host's shown ones, and the hidden ones this page opened. */
  async folders(): Promise<AssetFolder[]> {
    return ((await this.meta(FOLDERS_KEY)) as AssetFolder[] | null) ?? [];
  }
}

let events: EventSource | null = null;
/** The host's events (one stream per page): `changed` (paths of the folder), `view` (where the host is, for Follow). */
export function hostEvents(origin: string, token: string): EventSource {
  return (events ??= new EventSource(`${origin}/events?token=${encodeURIComponent(token)}`));
}

/** The bridge of a guest of the host at `origin` (its page's own address), paired with `token`. */
export function remoteBridge(origin: string, token: string): DesktopBridge {
  const host = hostCalls(origin, token);
  const call = <T>(ch: string, ...args: unknown[]): Promise<T> => host(`canvast:${ch}`, ...args) as Promise<T>;
  const nothing = async (): Promise<void> => {};
  return {
    workspace: () => call("workspace").then((w) => (w ? { path: `${origin}/`, name: (w as { name: string }).name } : null)),
    read: (p) => call("read", p),
    part: (p, from, to) => call("part", p, from, to),
    head: (p) => call("head", p),
    exists: (p) => call("exists", p),
    folderExists: (p) => call("folderExists", p),
    sizes: (paths) => call("sizes", paths),
    tree: (p) => call("tree", p),
    list: (p) => call("list", p),
    hash: (p) => call("hash", p),
    canvasFiles: () => call("canvasFiles"),
    // Writes: left undone (the storage's own bookkeeping stays in this page).
    write: nothing,
    rename: nothing,
    remove: nothing,
    erase: nothing,
    makeFolder: nothing,
    removeEmptyFolder: async () => false,
    syncFiles: nothing,
    emptyOldTrash: async () => 0,
    stream: { begin: readOnly, save: readOnly, intoExport: readOnly, copy: readOnly, append: readOnly, read: readOnly, finish: readOnly, commit: readOnly, abort: nothing },
    // Desktop-only things a guest's page does not use (it runs as the browser build).
    openFile: async () => "Not on a shared workspace.",
    openCopy: async () => "Not on a shared workspace.",
    copyFiles: async () => 0,
    forgetHiddenCopy: async () => false,
    startDrag: () => {},
    frame: async () => ({ saved: "system", window: "system" }),
    setFrame: nothing,
    windowAct: () => {},
    dropOpened: nothing,
    showFile: nothing,
    onClosing: () => {},
    holdClose: nothing,
    workspaces: async () => null,
    switchWorkspace: async () => false,
    forgetWorkspace: nothing,
    scrypt: async (password, salt, N, r, p) => scryptJs(password, salt, N, r, p),
    // The host keeps its library in step with the folder: nothing to look at here.
    libraryChanges: async () => [],
    libraryLookDone: nothing,
    onChanged: (fn) => hostEvents(origin, token).addEventListener("changed", (e) => fn(JSON.parse((e as MessageEvent<string>).data) as string[])),
    lib: new GuestLibrary(host),
    exportTo: { begin: async () => null, write: readOnly, end: nothing },
  };
}
