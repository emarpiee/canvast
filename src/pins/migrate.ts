import type { Session } from "../app/session";
import type { AssetLibrary } from "../assets/asset-library";
import { imageAt } from "../app/actions";
import { ViewState } from "../app/view-state";
import { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ImageObject } from "../doc/model";
import { localToWorld, rotateAbout } from "../doc/edit-ops";
import { angleFromRadians } from "../core/angle";

/** A moodboard of the reference windows (ADR 0207), as it was kept in the workspace's settings. */
interface OldBoard {
  name: string;
  items: Array<{ h: string; x: number; y: number; w: number; fx?: boolean; fy?: boolean; r?: number; o?: number }>;
}

/**
 * The moodboards of the reference windows, from before Pins (ADR 0208), become canvases, once: one canvas each, in a new board named "Pins",
 * every picture where it was, as wide, flipped, turned and see-through as it was (a grey look, which only the window gave, is not kept).
 * Returns how many became canvases; the old list is then emptied (`clear`), so it is done once.
 */
export async function moodboardsToCanvases(o: { session: Session; assets: AssetLibrary; read(): string; clear(): void }): Promise<number> {
  let boards: OldBoard[] = [];
  try {
    const v = JSON.parse(o.read() || "[]") as unknown;
    boards = Array.isArray(v) ? (v as OldBoard[]).filter((b) => b && typeof b.name === "string" && Array.isArray(b.items)) : [];
  } catch {
    return 0;
  }
  const repo = o.session.repo, ws = o.session.current?.workspaceId;
  if (!boards.length || !repo || !ws || o.session.readOnly) return 0;
  const { board, canvas: first } = await repo.createBoard(ws, "Pins");
  let made = 0;
  for (const [i, b] of boards.entries()) {
    const name = b.name.trim() || `Pinboard ${i + 1}`;
    const c = i === 0 ? first : await repo.createCanvas(board.id, name);
    if (i === 0) await repo.renameCanvas(first.id, name);
    const loaded = await repo.loadCanvas(c.id);
    const doc = new DocumentStore();
    doc.load(loaded.objects, loaded.space);
    // (a view at the origin, one CSS pixel a unit: the moodboard's own units are the canvas's)
    const view = new ViewState(() => doc.space);
    view.setViewport({ width: 2, height: 2 });
    const puts: CanvasObject[] = [];
    for (const [z, it] of b.items.entries()) {
      const rec = await o.assets.record(it.h).catch(() => undefined);
      if (!rec || !(it.w > 0)) continue;
      let obj: CanvasObject = imageAt(rec, doc, view, it.x + 1, it.y + 1, it.w, (it.w * rec.pixelH) / Math.max(1, rec.pixelW), z);
      obj = { ...obj, ...(it.fx ? { flipX: true as const } : {}), ...(it.fy ? { flipY: true as const } : {}), ...(typeof it.o === "number" && it.o > 0 && it.o < 1 ? { opacity: it.o } : {}) } as ImageObject;
      if (it.r) obj = rotateAbout(obj, localToWorld(obj, (obj as ImageObject).w / 2, (obj as ImageObject).h / 2), angleFromRadians((it.r * Math.PI) / 180));
      puts.push(obj);
    }
    if (puts.length) await repo.commit(c.id, loaded.canvas.revision, puts, []);
    made++;
  }
  o.clear();
  await o.session.refreshTree();
  return made;
}
