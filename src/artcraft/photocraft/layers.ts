import type { ExportTarget, RenderDeps } from "../../app/export-render";
import { paintExport, renderExport } from "../../app/export-render";
import type { CanvasObject, ObjectId } from "../../doc/model";
import { isContainer } from "../../doc/containers";
import { labelOf } from "../../ui/layers-panel";
import { writeZip } from "../../storage/zip";

/**
 * A layered project for PhotoCraft from canvas objects: an OpenRaster file (`.ora`, which it opens with its layers). Each object is a
 * layer drawn by the same code as Export (its crop, flip, turn, adjustments and words as on the canvas), at the size chosen, lined up in
 * the document; canvast's paint order is the layer order, and its groups and the sheets on a sheet are layer groups, named as in the
 * Layers panel. A sheet's own fill is the bottom layer of its group. Masks and adjustment shapes act on what is under them, so they are
 * not layers of their own; what they do is in the merged picture only.
 */

export type LayerNode = { kind: "layer"; o: CanvasObject } | { kind: "stack"; key: string; name: string; children: LayerNode[] };

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The objects as a tree of layer groups: sheets on the root sheet, then groups (outermost first), in paint order, bottom first. */
export function layerTree(objects: readonly CanvasObject[], get: (id: ObjectId) => CanvasObject | undefined, rootSheet: ObjectId | null, nameOf: (o: CanvasObject) => string): LayerNode[] {
  const root: LayerNode[] = [];
  const stacks = new Map<string, Extract<LayerNode, { kind: "stack" }>>();
  const stackFor = (path: Array<{ key: string; name: string }>): LayerNode[] => {
    let into = root;
    let at = "";
    for (const p of path) {
      at += `/${p.key}`;
      let s = stacks.get(at);
      if (!s) {
        s = { kind: "stack", key: p.key, name: p.name, children: [] };
        stacks.set(at, s);
        into.push(s);
      }
      into = s.children;
    }
    return into;
  };
  const sheetPath = (o: CanvasObject): Array<{ key: string; name: string }> => {
    const chain: Array<{ key: string; name: string }> = [];
    for (let p = o.parent, n = 0; p && p !== rootSheet && n < 64; n++) {
      const s = get(p);
      if (!s) break;
      chain.unshift({ key: `s:${p}`, name: nameOf(s) });
      p = s.parent;
    }
    return chain;
  };
  for (const o of [...objects].sort((a, b) => a.z - b.z)) {
    const path = [...sheetPath(o), ...(o.groups ?? []).map((g) => ({ key: `g:${g}`, name: o.groupNames?.[g] ?? "Group" }))];
    // (a sheet on the sheet: its fill is the bottom layer of its own group)
    if (isContainer(o) && o.id !== rootSheet) path.push({ key: `s:${o.id}`, name: nameOf(o) });
    stackFor(path).push({ kind: "layer", o });
  }
  return root;
}

/** Whether an object is a layer of its own (not a mask, an adjustment shape, or hidden). */
const isLayer = (o: CanvasObject): boolean => !o.hidden && !o.isMask && !(o.kind === "path" && o.backdrop);

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function png(canvas: HTMLCanvasElement): Promise<Blob> {
  const b = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!b) throw new Error("the browser could not make a picture of a layer");
  return b;
}

/** One object drawn alone at the document's size (waiting for its picture to be decoded, as Export does). */
async function layerPicture(deps: RenderDeps, t: ExportTarget, o: CanvasObject, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("the browser could not make a picture this size");
  const one: ExportTarget = { ...t, ids: new Set([o.id]) };
  for (let i = 0; i < 60; i++) {
    if (!paintExport(deps, one, ctx, w, h, "transparent")) break;
    await pause(50);
  }
  const b = await png(canvas);
  canvas.width = canvas.height = 0; // (its memory goes now, not at the next collection)
  return b;
}

/** The project: an `.ora` file named `name`, `w` × `h` px. `progress` hears each layer done. */
export async function layeredProject(deps: RenderDeps, t: ExportTarget, w: number, h: number, name: string, progress?: (done: number, total: number) => void): Promise<File> {
  w = Math.round(w);
  h = Math.round(h);
  const rootSheet = t.kind === "sheet" ? ([...t.ids].map((id) => deps.doc.get(id)).find((o) => isContainer(o) && !t.ids.has(o.parent ?? "")) ?? null) : null;
  const objects = [...t.ids].map((id) => deps.doc.get(id)).filter((o): o is CanvasObject => !!o && isLayer(o));
  const tree = layerTree(objects, (id) => deps.doc.get(id), rootSheet?.id ?? null, (o) => labelOf(o).text);
  const files: Array<{ name: string; data: Blob }> = [];
  let n = 0;
  const total = objects.length;
  const xmlOf = async (nodes: LayerNode[], indent: string): Promise<string> => {
    const parts: string[] = [];
    for (const node of nodes) {
      if (node.kind === "stack") parts.push(`${indent}<stack name="${xml(node.name)}" visibility="visible" opacity="1">\n${await xmlOf(node.children, `${indent} `)}${indent}</stack>\n`);
      else {
        const src = `data/layer${files.length + 1}.png`;
        files.push({ name: src, data: await layerPicture(deps, t, node.o, w, h) });
        progress?.(++n, total);
        const o = node.o;
        // (its opacity is in its pixels, as the canvas draws it: the layer itself at full strength, so it is not applied twice)
        parts.push(`${indent}<layer name="${xml(o.id === rootSheet?.id ? "Sheet" : labelOf(o).text)}" src="${src}" x="0" y="0" opacity="1.000" visibility="visible" composite-op="svg:src-over"/>\n`);
      }
    }
    // (OpenRaster lists the top layer first)
    return parts.reverse().join("");
  };
  const stack = await xmlOf(tree, "  ");
  const merged = await renderExport(deps, t, w, h, "transparent");
  const thumb = document.createElement("canvas");
  const k = Math.min(1, 256 / Math.max(w, h));
  thumb.width = Math.max(1, Math.round(w * k));
  thumb.height = Math.max(1, Math.round(h * k));
  thumb.getContext("2d")?.drawImage(merged, 0, 0, thumb.width, thumb.height);
  const stackXml = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${w}" h="${h}" xres="72" yres="72">\n <stack>\n${stack} </stack>\n</image>\n`;
  const zip = await writeZip([
    { name: "mimetype", data: new Blob(["image/openraster"]) },
    { name: "stack.xml", data: new Blob([stackXml], { type: "text/xml" }) },
    ...files,
    { name: "mergedimage.png", data: await png(merged) },
    { name: "Thumbnails/thumbnail.png", data: await png(thumb) },
  ]);
  return new File([zip], `${name}.ora`, { type: "image/openraster" });
}
