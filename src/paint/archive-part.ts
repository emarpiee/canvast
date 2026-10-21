/**
 * Paintings in `.canvast` archives (ADR 0165; archive version 5). A workspace archive carries `paintings.json` (the paintings and their
 * layers, as stored) and every tile they name as `paint-tiles/<hash>` (the stored form: deflated RGBA). Reading checks every record and
 * every tile (it must inflate to a tile and hash to its name); a painting with a damaged part is left out, and said. Importing gives
 * paintings and layers new ids (importing twice never overwrites) and stores each tile once, in the import's own transaction.
 */
import { req } from "../storage/idb";
import { hashOf, inflate } from "./codec";
import type { Layer, Painting } from "./model";
import { newId, tilesOf, validLayer, validPainting } from "./model";

export const PAINTINGS_FILE = "paintings.json";
export const TILE_DIR = "paint-tiles/";

export interface PlannedPaintings {
  readonly paintings: Painting[];
  readonly layers: Layer[];
  /** Tile hash → stored form. */
  readonly tiles: Map<string, Blob>;
}

/** The workspace's paintings for an archive, read in `tx` (it must cover paintings, paintLayers and paintTiles); null when there are none. */
export async function paintingsOf(tx: IDBTransaction, workspaceId: string): Promise<{ json: string; tiles: Array<{ name: string; data: Blob }>; count: number } | null> {
  const paintings = (await req(tx.objectStore("paintings").index("workspaceId").getAll(workspaceId) as IDBRequest<unknown[]>)).filter(validPainting);
  if (!paintings.length) return null;
  const layers: Layer[] = [];
  const hashes = new Set<string>();
  for (const p of paintings) {
    for (const l of (await req(tx.objectStore("paintLayers").getAll(IDBKeyRange.bound([p.id], [p.id, []])) as IDBRequest<unknown[]>)).filter(validLayer)) {
      layers.push(l);
      for (const h of Object.values(tilesOf(l))) hashes.add(h);
    }
  }
  const tiles: Array<{ name: string; data: Blob }> = [];
  for (const h of [...hashes].sort()) {
    const t = await req(tx.objectStore("paintTiles").get(h) as IDBRequest<{ data: Blob } | undefined>);
    if (t) tiles.push({ name: `${TILE_DIR}${h}`, data: t.data });
  }
  return { json: JSON.stringify({ paintings, layers }), tiles, count: paintings.length };
}

/** Read and check the paintings of an archive. `file(name)` gives an entry's bytes. Problems are added to `problems`. */
export async function readPaintings(json: unknown, file: (name: string) => Blob | undefined, problems: string[]): Promise<PlannedPaintings> {
  const out: PlannedPaintings = { paintings: [], layers: [], tiles: new Map() };
  const d = json as { paintings?: unknown; layers?: unknown } | null;
  if (!d || !Array.isArray(d.paintings) || !Array.isArray(d.layers)) {
    problems.push("The paintings in the archive are damaged and were not imported.");
    return out;
  }
  const layers = (d.layers as unknown[]).filter(validLayer);
  for (const p of (d.paintings as unknown[]).filter(validPainting)) {
    const mine = layers.filter((l) => l.paintingId === p.id && p.pages.some((pg) => pg.id === l.pageId));
    let bad = false;
    for (const h of new Set(mine.flatMap((l) => Object.values(tilesOf(l))))) {
      if (out.tiles.has(h)) continue;
      const blob = file(`${TILE_DIR}${h}`);
      const rgba = blob && (await inflate(blob));
      if (!rgba || (await hashOf(rgba)) !== h) {
        bad = true;
        break;
      }
      out.tiles.set(h, blob!);
    }
    if (bad) {
      problems.push(`The painting “${p.name}” has a damaged or missing tile in the archive and was not imported.`);
      continue;
    }
    out.paintings.push(p);
    out.layers.push(...mine);
  }
  const skipped = (d.paintings as unknown[]).length - out.paintings.length;
  if (skipped > 0 && !problems.some((x) => x.includes("painting"))) problems.push(`${skipped} damaged painting record${skipped === 1 ? " was" : "s were"} not imported.`);
  return out;
}

/** Store planned paintings in `tx` (paintings, paintLayers, paintTiles) for `workspaceId`, with new ids. Returns how many. */
export async function importPaintings(tx: IDBTransaction, workspaceId: string, plan: PlannedPaintings): Promise<number> {
  for (const [hash, data] of plan.tiles) if ((await req(tx.objectStore("paintTiles").count(hash))) === 0) tx.objectStore("paintTiles").put({ hash, data });
  const now = Date.now();
  for (const p of plan.paintings) {
    const id = newId();
    tx.objectStore("paintings").put({ ...p, id, workspaceId, modified: now });
    for (const l of plan.layers) if (l.paintingId === p.id) tx.objectStore("paintLayers").put({ ...l, paintingId: id, id: newId() });
  }
  return plan.paintings.length;
}
