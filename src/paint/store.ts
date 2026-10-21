/**
 * Paintings in IndexedDB (ADR 0165), in three stores of the `canvast` database (schema 11, storage/idb.ts):
 *
 *   paintings    keyPath "id"                → Painting (with its pages), index "workspaceId"
 *   paintLayers  keyPath [paintingId, id]    → Layer
 *   paintTiles   keyPath "hash"              → { hash, data }: a 256 px tile, its straight RGBA pixels deflated (exact, unlike a PNG
 *                                              through a canvas, which premultiplies), named by the SHA-256 of those pixels, stored once
 *
 * Every change is one transaction (records and the new tiles together) and is read back. Tiles are erased only by `collect`, when no
 * stored layer and none of the caller's roots (the undo history of the open painting) names them, the asset GC's rule (ADR 0007).
 * Only the tab holding the writer lease writes (the caller checks).
 */
import { done, req } from "../storage/idb";
import type { Layer, Painting } from "./model";
import { validLayer, validPainting } from "./model";

export interface TileBlob {
  readonly hash: string;
  /** The tile's RGBA pixels, deflated (`CompressionStream("deflate")`). */
  readonly data: Blob;
}

export interface Change {
  readonly paintings?: readonly Painting[];
  readonly layers?: readonly Layer[];
  /** [paintingId, layerId] */
  readonly deleteLayers?: ReadonlyArray<readonly [string, string]>;
  readonly deletePaintings?: readonly string[];
  readonly tiles?: readonly TileBlob[];
}

export class PaintStore {
  constructor(private readonly db: IDBDatabase) {}

  /** The workspace's paintings, newest first (records that do not check are left out). */
  async list(workspaceId: string): Promise<Painting[]> {
    const tx = this.db.transaction("paintings", "readonly");
    const all = await req(tx.objectStore("paintings").index("workspaceId").getAll(workspaceId) as IDBRequest<unknown[]>);
    return all.filter(validPainting).sort((a, b) => b.modified - a.modified);
  }

  /** A painting and its layers; null when it is gone or does not check. */
  async load(id: string): Promise<{ painting: Painting; layers: Layer[] } | null> {
    const tx = this.db.transaction(["paintings", "paintLayers"], "readonly");
    const p = await req(tx.objectStore("paintings").get(id) as IDBRequest<unknown>);
    if (!validPainting(p)) return null;
    const layers = await req(tx.objectStore("paintLayers").getAll(IDBKeyRange.bound([id], [id, []])) as IDBRequest<unknown[]>);
    return { painting: p, layers: layers.filter(validLayer) };
  }

  async tile(hash: string): Promise<Blob | null> {
    const r = await req(this.db.transaction("paintTiles", "readonly").objectStore("paintTiles").get(hash) as IDBRequest<TileBlob | undefined>);
    return r?.data ?? null;
  }

  /** Write a change in one transaction, then read the records back: a mismatch throws (nothing is taken as saved). */
  async write(c: Change): Promise<void> {
    const tx = this.db.transaction(["paintings", "paintLayers", "paintTiles"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    const tiles = tx.objectStore("paintTiles");
    for (const t of c.tiles ?? []) tiles.put(t);
    for (const p of c.paintings ?? []) tx.objectStore("paintings").put(p);
    for (const l of c.layers ?? []) tx.objectStore("paintLayers").put(l);
    for (const k of c.deleteLayers ?? []) tx.objectStore("paintLayers").delete([...k]);
    for (const id of c.deletePaintings ?? []) {
      tx.objectStore("paintings").delete(id);
      tx.objectStore("paintLayers").delete(IDBKeyRange.bound([id], [id, []]));
    }
    await committed;
    const back = this.db.transaction(["paintings", "paintLayers"], "readonly");
    for (const p of c.paintings ?? []) {
      const r = await req(back.objectStore("paintings").get(p.id) as IDBRequest<Painting | undefined>);
      if (!r || r.modified !== p.modified || r.pages.length !== p.pages.length) throw new Error("the painting did not read back as written");
    }
    for (const l of c.layers ?? []) {
      const r = await req(back.objectStore("paintLayers").get([l.paintingId, l.id]) as IDBRequest<Layer | undefined>);
      if (!r || JSON.stringify(r.tiles) !== JSON.stringify(l.tiles) || r.z !== l.z) throw new Error("a layer did not read back as written");
    }
  }

  /** Erase the tiles that no stored layer and none of `roots` names. Returns how many were erased. */
  async collect(roots: ReadonlySet<string>): Promise<number> {
    const tx = this.db.transaction(["paintLayers", "paintTiles"], "readwrite");
    const committed = done(tx);
    const used = new Set(roots);
    for (const l of await req(tx.objectStore("paintLayers").getAll() as IDBRequest<Layer[]>)) for (const h of Object.values(l.tiles ?? {})) used.add(h);
    const keys = await req(tx.objectStore("paintTiles").getAllKeys() as IDBRequest<IDBValidKey[]>);
    let n = 0;
    for (const k of keys) {
      if (used.has(k as string)) continue;
      tx.objectStore("paintTiles").delete(k);
      n++;
    }
    await committed;
    return n;
  }
}
