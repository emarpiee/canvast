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

/** What this page asked its host, by call (how many, bytes, time): `#debug` shows it, and tests read it. */
export const hostStats: Record<string, { n: number; bytes: number; ms: number }> = {};

export function hostCalls(origin: string, token: string): HostCall {
  return async (ch, ...args) => {
    const t0 = performance.now();
    const key = ch === "canvast:lib" ? `lib.${String(args[0])}` : ch === "canvast:read" && String(args[0]).startsWith("library/") ? "read.library" : ch.slice(8);
    const res = await fetch(`${origin}/call`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ch, args }) });
    const done = (bytes: number): void => {
      const s = (hostStats[key] ??= { n: 0, bytes: 0, ms: 0 });
      s.n++;
      s.bytes += bytes;
      s.ms += performance.now() - t0;
    };
    if (res.headers.get("content-type")?.startsWith("application/octet-stream")) {
      const b = new Uint8Array(await res.arrayBuffer());
      done(b.byteLength);
      return b;
    }
    const text = await res.text();
    done(text.length);
    let body: { v?: unknown; error?: string } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      /* not JSON */
    }
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
  /** Whole lists the storage asks for again and again: kept a moment, and forgotten when the host says something changed. */
  private kept = new Map<string, { at: number; v: Promise<unknown> }>();
  private keptLib = <T>(op: string, ...args: unknown[]): Promise<T> => {
    const key = JSON.stringify([op, args]);
    const k = this.kept.get(key);
    if (k && performance.now() - k.at < 5000) return k.v as Promise<T>;
    const v = this.lib<T>(op, ...args);
    this.kept.set(key, { at: performance.now(), v });
    v.catch(() => this.kept.delete(key));
    return v;
  };
  /** Items asked for in the same moment (each card asks for its own) go to the host in one call. */
  private batch: { hashes: Set<string>; done: Promise<Map<string, [string, CatalogEntry | null, AssetRecord | null, string | null]>> } | null = null;
  private async getSoon(hashes: readonly string[]): Promise<Array<[string, CatalogEntry | null, AssetRecord | null, string | null]>> {
    if (!this.batch) {
      const hs = new Set<string>();
      const done = new Promise<void>((r) => setTimeout(r, 15)).then(async () => {
        this.batch = null;
        const rows = await this.lib<Array<[string, CatalogEntry | null, AssetRecord | null, string | null]>>("get", [...hs]);
        return new Map(rows.map((r) => [r[0], r]));
      });
      this.batch = { hashes: hs, done };
    }
    const b = this.batch;
    for (const h of hashes) b.hashes.add(h);
    const got = await b.done;
    return hashes.flatMap((h) => (got.has(h) ? [got.get(h)!] : []));
  }

  /** The host's library changed: ask again. */
  forget(): void {
    this.kept.clear();
  }
  private local = (hash: string): boolean => this.mine.has(hash);

  async get(hashes: readonly string[]): Promise<Array<[string, CatalogEntry | null, AssetRecord | null, string | null]>> {
    const remote = hashes.filter((h) => !this.local(h));
    const there = remote.length ? await this.getSoon(remote) : [];
    return [...there, ...hashes.filter((h) => this.local(h)).map((h): [string, CatalogEntry | null, AssetRecord | null, string | null] => [h, this.mine.get(h) ?? null, this.myRecs.get(h) ?? null, null])];
  }
  async entries(which: "all" | "active" | "deleted" | "hidden" = "all"): Promise<string> {
    const mine = [...this.mine.values()].filter((e) => which === "all" || which === "hidden" || (which === "active" ? e.state === "active" : e.state === "deleted"));
    const theirs = which === "hidden" ? [] : (JSON.parse(await this.keptLib<string>("entries", which)) as CatalogEntry[]).filter((e) => !this.local(e.hash));
    return JSON.stringify([...theirs, ...mine]);
  }
  async recs(which: "all" | "sealed" = "all"): Promise<string> {
    const mine = [...this.myRecs.values()];
    const theirs = which === "sealed" ? [] : (JSON.parse(await this.keptLib<string>("recs", which)) as AssetRecord[]).filter((r) => !this.local(r.hash));
    return JSON.stringify([...theirs, ...mine]);
  }
  async byFile(file: string): Promise<string | null> {
    for (const r of this.myRecs.values()) if ((r as { file?: string }).file === file) return r.hash;
    return this.lib<string | null>("byFile", file);
  }
  async meta(key: string): Promise<unknown> {
    if (this.metas.has(key)) return this.metas.get(key);
    return this.keptLib("meta", key);
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
  async counts(hidden = false, concealed: readonly string[] = []): Promise<Awaited<ReturnType<LibraryCalls["counts"]>>> {
    if (hidden) return this.hiddenIndex.counts(true);
    const c = await this.lib<Awaited<ReturnType<LibraryCalls["counts"]>>>("counts", false, [...concealed]);
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
    return this.keptLib("absent");
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
  // A path the host does not share (hidden items while they are not shared) is as if it were not there; shared later, it is read then.
  const orNot = <T>(ch: string, none: T, ...args: unknown[]): Promise<T> => call<T>(ch, ...args).catch((e: unknown) => (e instanceof HostError && e.status === 403 ? none : Promise.reject(e)));
  const nothing = async (): Promise<void> => {};
  const lib = new GuestLibrary(host);
  return {
    workspace: () => call("workspace").then((w) => (w ? { path: `${origin}/`, name: (w as { name: string }).name } : null)),
    read: (p) => orNot("read", null, p),
    part: (p, from, to) => orNot("part", null, p, from, to),
    head: (p) => orNot("head", null, p),
    exists: (p) => orNot("exists", false, p),
    folderExists: (p) => orNot("folderExists", false, p),
    sizes: (paths) => call("sizes", paths),
    tree: (p) => orNot("tree", [], p),
    list: (p) => orNot("list", [], p),
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
    onChanged: (fn) =>
      hostEvents(origin, token).addEventListener("changed", (e) => {
        lib.forget();
        fn(JSON.parse((e as MessageEvent<string>).data) as string[]);
      }),
    lib,
    thumb: async (hash) => {
      const t = (await call<{ b64: string; type: string; w: number; h: number; face?: string } | null>("thumb", hash).catch(() => null));
      return t ? { bytes: Uint8Array.from(atob(t.b64), (c) => c.charCodeAt(0)), type: t.type, w: t.w, h: t.h, ...(t.face ? { face: t.face } : {}) } : null;
    },
    exportTo: { begin: async () => null, write: readOnly, end: nothing },
  };
}
