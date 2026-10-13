import type { ObjectId } from "../doc/model";
import { done, req } from "../storage/idb";
import type { AssetRecord } from "./asset-library";

/**
 * The workspace's shared asset catalog (ADR 0007).
 *
 * Three things are kept apart:
 *   - the original bytes, `assets[hash]` (content-addressed, stored once);
 *   - the catalog entry, `assetCatalog[hash]` (metadata only, so listing the
 *     library never loads bytes);
 *   - placed instances, the image objects on canvases that name the hash in
 *     `data.assetId`. They are found through the `objects.assetId` index, so
 *     usage is always derived from the stored objects and never from a counter
 *     that could drift.
 *
 * Originals are only ever erased by the mark-and-sweep `collect`, and only
 * when the user has deleted the asset from the library, no stored instance
 * references it, and the caller's live roots (open document, undo/redo
 * history, unsaved changes) do not either. Deleting instances, canvases or
 * boards never erases an original.
 */
export type CatalogState = "active" | "deleted";

export interface CatalogEntry {
  hash: string;
  name: string;
  type: string;
  size: number;
  pixelW: number;
  pixelH: number;
  importedAt: number;
  state: CatalogState;
  deletedAt: number | null;
}

export interface Usage {
  /** Stored image instances that reference the asset, across all canvases. */
  instances: number;
  /** Distinct canvases holding those instances. */
  canvases: number;
}

export interface CatalogListing {
  /** Active library entries, with usage and whether the original bytes are present. */
  entries: Array<CatalogEntry & Usage & { present: boolean }>;
  /** Hashes referenced by stored instances with no original bytes stored. */
  missing: Array<{ hash: string } & Usage>;
  /** Entries deleted by the user but still retained (needed by undo history). */
  pendingDeletion: number;
}

export interface AssetLocation {
  canvasId: string;
  ids: ObjectId[];
}

export interface GcReport {
  /** Originals erased (deleted by the user, unreferenced, unrooted). */
  swept: string[];
  bytesFreed: number;
  /** Deleted by the user but still needed by live roots (undo history): kept. */
  retained: string[];
  /** Deleted by the user but referenced by a stored instance again: restored to the library. */
  restored: string[];
}

export class AssetInUseError extends Error {
  constructor(
    readonly hash: string,
    readonly instances: number,
  ) {
    super(`the asset is still used by ${instances} instance(s); remove them first`);
  }
}

export function entryFromRecord(r: AssetRecord): CatalogEntry {
  return {
    hash: r.hash,
    name: r.name,
    type: r.type,
    size: r.size,
    pixelW: r.pixelW,
    pixelH: r.pixelH,
    importedAt: r.importedAt,
    state: "active",
    deletedAt: null,
  };
}

const usageOf = (m: Map<string, { instances: number; canvases: Set<string> }>, hash: string): Usage => {
  const u = m.get(hash);
  return { instances: u?.instances ?? 0, canvases: u?.canvases.size ?? 0 };
};

export class AssetCatalog {
  constructor(readonly db: IDBDatabase) {}

  /** The whole library with usage, in one read-only transaction (keys only for usage; no bytes are read). */
  async list(): Promise<CatalogListing> {
    const tx = this.db.transaction(["assetCatalog", "assets", "objects"], "readonly");
    const entries = await req(tx.objectStore("assetCatalog").getAll() as IDBRequest<CatalogEntry[]>);
    const blobKeys = new Set((await req(tx.objectStore("assets").getAllKeys())) as string[]);
    const usage = new Map<string, { instances: number; canvases: Set<string> }>();
    await new Promise<void>((resolve, reject) => {
      const cur = tx.objectStore("objects").index("assetId").openKeyCursor();
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve();
        const hash = c.key as string;
        const canvasId = (c.primaryKey as [string, string])[0];
        let u = usage.get(hash);
        if (!u) usage.set(hash, (u = { instances: 0, canvases: new Set() }));
        u.instances++;
        u.canvases.add(canvasId);
        c.continue();
      };
    });
    const known = new Set(entries.map((e) => e.hash));
    return {
      entries: entries.filter((e) => e.state === "active").map((e) => ({ ...e, ...usageOf(usage, e.hash), present: blobKeys.has(e.hash) })),
      missing: [...usage.keys()].filter((h) => !blobKeys.has(h) && !known.has(h)).map((hash) => ({ hash, ...usageOf(usage, hash) })),
      pendingDeletion: entries.filter((e) => e.state === "deleted").length,
    };
  }

  async entry(hash: string): Promise<CatalogEntry | undefined> {
    const tx = this.db.transaction("assetCatalog", "readonly");
    return req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>);
  }

  /** Every stored instance of an asset, grouped by canvas (in key order). */
  async locations(hash: string): Promise<AssetLocation[]> {
    const tx = this.db.transaction("objects", "readonly");
    const keys = (await req(tx.objectStore("objects").index("assetId").getAllKeys(hash))) as unknown as Array<[string, string]>;
    const by = new Map<string, ObjectId[]>();
    for (const [canvasId, id] of keys) {
      let ids = by.get(canvasId);
      if (!ids) by.set(canvasId, (ids = []));
      ids.push(id);
    }
    return [...by].map(([canvasId, ids]) => ({ canvasId, ids }));
  }

  /**
   * Repair the catalog from the bytes that are actually stored: every
   * original without an entry gets one (schema-2 data, or an interrupted
   * write). Never deletes anything. Returns the number of entries created.
   */
  async reconcile(): Promise<number> {
    const tx = this.db.transaction(["assetCatalog", "assets"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const known = new Set((await req(tx.objectStore("assetCatalog").getAllKeys())) as string[]);
    const missingKeys = ((await req(tx.objectStore("assets").getAllKeys())) as string[]).filter((k) => !known.has(k));
    for (const k of missingKeys) {
      const r = await req(tx.objectStore("assets").get(k) as IDBRequest<AssetRecord | undefined>);
      if (r) tx.objectStore("assetCatalog").put(entryFromRecord({ ...r, hash: k }));
    }
    await committed;
    return missingKeys.length;
  }

  /**
   * Delete an asset from the library. Refused while any stored instance uses
   * it. The original is not erased here; `collect` does that once nothing
   * (including undo history) can bring an instance back.
   */
  async markDeleted(hash: string): Promise<void> {
    const tx = this.db.transaction(["assetCatalog", "objects"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    try {
      const n = await req(tx.objectStore("objects").index("assetId").count(hash));
      if (n > 0) throw new AssetInUseError(hash, n);
      const e = await req(tx.objectStore("assetCatalog").get(hash) as IDBRequest<CatalogEntry | undefined>);
      if (!e) throw new Error(`asset ${hash} is not in the library`);
      tx.objectStore("assetCatalog").put({ ...e, state: "deleted", deletedAt: Date.now() } satisfies CatalogEntry);
      await committed;
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // already finished
      }
      await committed.catch(() => undefined);
      throw err;
    }
  }

  /**
   * Mark-and-sweep over deleted entries, in one transaction so no commit can
   * interleave between the reference check and the erase.
   *
   * Mark: a deleted entry is live if a stored instance references it (it is
   * then restored to the library) or if it is in `roots`, the hashes the
   * caller can still bring back without storage (open document, undo/redo
   * history, queued saves). Sweep: everything else loses its bytes and entry.
   */
  async collect(roots: ReadonlySet<string>): Promise<GcReport> {
    const report: GcReport = { swept: [], bytesFreed: 0, retained: [], restored: [] };
    const tx = this.db.transaction(["assetCatalog", "assets", "objects"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const catalog = tx.objectStore("assetCatalog");
    const deleted = (await req(catalog.getAll() as IDBRequest<CatalogEntry[]>)).filter((e) => e.state === "deleted");
    for (const e of deleted) {
      const refs = await req(tx.objectStore("objects").index("assetId").count(e.hash));
      if (refs > 0) {
        catalog.put({ ...e, state: "active", deletedAt: null } satisfies CatalogEntry);
        report.restored.push(e.hash);
      } else if (roots.has(e.hash)) {
        report.retained.push(e.hash);
      } else {
        tx.objectStore("assets").delete(e.hash);
        catalog.delete(e.hash);
        report.swept.push(e.hash);
        report.bytesFreed += e.size;
      }
    }
    await committed;
    return report;
  }
}
