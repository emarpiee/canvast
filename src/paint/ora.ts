/**
 * OpenRaster (`.ora`), the open layered format of painting programs: a ZIP holding `mimetype` (first, stored), `stack.xml` (the layers, top
 * first, with their names, places, opacity, visibility and blend), a PNG per layer, the merged picture and a thumbnail. A page exports with
 * every layer drawn alone as it looks (shapes, text, pictures and fills as pixels, its mask applied); a file imports as a new painting of
 * paint layers. Files from other programs are compressed (deflate), so they are read here, not with the archives' store-only reader.
 */
import { BLEND_MODES, type BlendMode } from "../doc/model";
import { writeZip, type ZipInput } from "../storage/zip";
import { LAYER_KINDS, MAX_PAGE_PX, newId, newPage, type Layer, type Painting } from "./model";
import { rasterize } from "./rasterize";
import type { PaintStore, TileBlob } from "./store";

const MIME = "image/openraster";
const MAX_FILE = 512 * 1024 * 1024;
const MAX_LAYERS = 500;

export interface OraLayer {
  readonly name: string;
  readonly png: Blob;
  readonly x: number;
  readonly y: number;
  readonly opacity: number;
  readonly hidden: boolean;
  readonly blend: BlendMode | null;
}

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** An `.ora` file: the page's size and resolution, its layers top first (each a page-sized PNG), the merged picture. */
export async function writeOra(page: { w: number; h: number; dpi: number }, layers: readonly OraLayer[], merged: Blob): Promise<Blob> {
  const stack = layers.map((l, i) => `    <layer name="${xml(l.name)}" src="data/layer${i}.png" x="${l.x}" y="${l.y}" opacity="${l.opacity.toFixed(3)}" visibility="${l.hidden ? "hidden" : "visible"}" composite-op="svg:${l.blend ?? "src-over"}"/>`);
  const doc = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.3" w="${page.w}" h="${page.h}" xres="${page.dpi}" yres="${page.dpi}">\n  <stack>\n${stack.join("\n")}\n  </stack>\n</image>\n`;
  const entries: ZipInput[] = [
    { name: "mimetype", data: new Blob([MIME]) },
    { name: "stack.xml", data: new Blob([doc], { type: "application/xml" }) },
    ...layers.map((l, i) => ({ name: `data/layer${i}.png`, data: l.png })),
    { name: "mergedimage.png", data: merged },
    { name: "Thumbnails/thumbnail.png", data: await thumbnail(merged, 256) },
  ];
  return writeZip(entries);
}

async function thumbnail(png: Blob, side: number): Promise<Blob> {
  const bmp = await createImageBitmap(png);
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(bmp.width * k)), height: Math.max(1, Math.round(bmp.height * k)) });
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("the thumbnail could not be made"))), "image/png"));
}

/** The entries of a ZIP (stored or deflated), by name: each read when asked for. */
async function zipEntries(file: Blob): Promise<Map<string, () => Promise<Blob>>> {
  const tail = new DataView(await file.slice(Math.max(0, file.size - 65_557)).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("it is not a ZIP file");
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const out = new Map<string, () => Promise<Blob>>();
  for (let p = 0, i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error("its directory is damaged");
    const method = cd.getUint16(p + 10, true), size = cd.getUint32(p + 20, true), nl = cd.getUint16(p + 28, true), el = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), off = cd.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
    p += 46 + nl + el + cl;
    if (method !== 0 && method !== 8) continue;
    out.set(name, async () => {
      const lh = new DataView(await file.slice(off, off + 30).arrayBuffer());
      const start = off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = file.slice(start, start + size);
      return method === 0 ? raw : new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    });
  }
  return out;
}

/** Read an `.ora` file: the page and the layers (top first). Throws with a reason a person can read. */
export async function readOra(file: Blob): Promise<{ w: number; h: number; dpi: number; layers: OraLayer[] }> {
  if (file.size > MAX_FILE) throw new Error("the file is too big");
  const z = await zipEntries(file);
  const mime = await (await z.get("mimetype")?.())?.text();
  if (mime !== undefined && mime.trim() !== MIME) throw new Error("it is not an OpenRaster file");
  const stackXml = await (await z.get("stack.xml")?.())?.text();
  if (!stackXml) throw new Error("it has no stack.xml");
  const d = new DOMParser().parseFromString(stackXml, "application/xml");
  const img = d.querySelector("image");
  if (!img || d.querySelector("parsererror")) throw new Error("its stack.xml does not read");
  const w = Math.round(Number(img.getAttribute("w"))), h = Math.round(Number(img.getAttribute("h")));
  if (!(w >= 1 && h >= 1 && w <= MAX_PAGE_PX && h <= MAX_PAGE_PX)) throw new Error(`its size must be 1 to ${MAX_PAGE_PX} px a side`);
  const dpi = Math.round(Number(img.getAttribute("xres"))) || 72;
  const layers: OraLayer[] = [];
  // (layers in groups are read in their place in the stack; a group's own settings are not kept)
  for (const el of [...d.querySelectorAll("layer")].slice(0, MAX_LAYERS)) {
    const src = el.getAttribute("src") ?? "";
    const png = await z.get(src)?.();
    if (!png) continue;
    const op = (el.getAttribute("composite-op") ?? "").replace(/^svg:/, "");
    const opacity = Number(el.getAttribute("opacity") ?? "1");
    layers.push({
      name: (el.getAttribute("name") ?? "").slice(0, 80) || `Layer ${layers.length + 1}`,
      png,
      x: Math.round(Number(el.getAttribute("x") ?? "0")) || 0,
      y: Math.round(Number(el.getAttribute("y") ?? "0")) || 0,
      opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
      hidden: el.getAttribute("visibility") === "hidden",
      blend: (BLEND_MODES as readonly string[]).includes(op) ? (op as BlendMode) : null,
    });
  }
  if (!layers.length) throw new Error("it has no layer that reads");
  return { w, h, dpi, layers };
}

/** A new painting from an `.ora` file's page and layers (each a paint layer, at its place), stored; its id. */
export async function importOra(store: PaintStore, workspaceId: string, name: string, file: Blob): Promise<string> {
  const o = await readOra(file);
  const now = Date.now();
  const page = newPage({ name: "Page 1", w: o.w, h: o.h, dpi: Math.min(10000, Math.max(1, o.dpi)), bg: null });
  const p: Painting = { id: newId(), workspaceId, name, pages: [page], created: now, modified: now };
  const layers: Layer[] = [];
  const tiles: TileBlob[] = [];
  for (const [i, l] of o.layers.entries()) {
    const bmp = await createImageBitmap(l.png).catch(() => null);
    if (!bmp) continue;
    const r = await rasterize(o.w, o.h, (g) => g.drawImage(bmp, l.x, l.y));
    bmp.close();
    tiles.push(...r.blobs);
    const base = LAYER_KINDS.raster.fresh({ paintingId: p.id, id: newId(), pageId: page.id, z: o.layers.length - i, opacity: l.opacity });
    layers.push({ ...base, name: l.name, tiles: r.tiles, ...(l.hidden ? { hidden: true as const } : {}), ...(l.blend ? { blend: l.blend } : {}) });
  }
  if (!layers.length) throw new Error("none of its layers' pictures could be read");
  await store.write({ paintings: [p], layers, tiles });
  return p.id;
}
