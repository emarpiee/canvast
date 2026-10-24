/**
 * Where a texture fill (ADR 0154) gets its pictures and objects: the app's asset library for a picture, and Export's own drawing
 * (`paintExport`) for objects, so a tile of objects is drawn by the same code as everything else. Told to `render/texture.ts` once.
 */
import type { AssetLibrary } from "../assets/asset-library";
import type { DocumentStore } from "../doc/document-store";
import type { EditorState } from "./editor-state";
import type { CanvasObject } from "../doc/model";
import type { TextureHost } from "../render/texture";
import type { FrameIndex } from "../scene/frame-index";
import type { SceneTheme } from "../render/scene-renderer";
import * as D from "../core/dyadic";
import { buildTarget } from "./actions";
import type { ExportTarget } from "./export-render";
import { paintExport } from "./export-render";

const KEEP = 16;

export function createTextureHost(deps: { doc: DocumentStore; index: FrameIndex; assets: AssetLibrary; theme: () => SceneTheme; editor: EditorState }): TextureHost & { live(on: boolean): void } {
  const targets = new Map<string, ExportTarget | null>();
  const tiles = new Map<string, HTMLCanvasElement>();
  const parts = new Map<string, HTMLCanvasElement>();
  let rev = -1;
  // While a gesture changes a source (live), tiles show it as the gesture does, drawn again at each step of it.
  let live = false;
  let step = 0;
  let drawnStep = 0;
  const fresh = (): void => {
    if (rev === deps.doc.revision && drawnStep === step) return;
    rev = deps.doc.revision;
    drawnStep = step;
    targets.clear();
    tiles.clear();
    parts.clear();
  };
  const shown = (o: CanvasObject): CanvasObject => (live ? (deps.editor.previewed(o) ?? o) : o);
  const targetOf = (ids: readonly string[]): ExportTarget | null => {
    fresh();
    const key = ids.join(",");
    if (!targets.has(key)) {
      const sel = ids.map((i) => deps.doc.get(i)).filter((o): o is CanvasObject => !!o).map(shown); // (a source may be hidden: the fill still shows it)
      targets.set(key, sel.length ? buildTarget(deps.doc, sel, null) : null);
    }
    return targets.get(key)!;
  };
  return {
    /** A gesture changed a source (on), or ended (off): the tiles are drawn again. */
    live(on) {
      live = on;
      step++;
    },
    picture(hash, shownPx) {
      const src = deps.assets.get(hash, shownPx);
      if (!src) return null;
      const s = src.source as { width?: number; height?: number };
      const k = src.scale ?? 1;
      return { source: src.source, w: s.width ?? src.pixelW * k, h: s.height ?? src.pixelH * k };
    },
    aspect(ids) {
      return targetOf(ids)?.ratio ?? null;
    },
    objects(ids, px) {
      const t = targetOf(ids);
      if (!t) return null;
      const key = `${ids.join(",")}|${px}`;
      const hit = tiles.get(key);
      if (hit) return { canvas: hit, version: `${rev}.${step}` };
      const [w, h] = t.ratio >= 1 ? [px, Math.max(1, Math.round(px / t.ratio))] : [Math.max(1, Math.round(px * t.ratio)), px];
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const pending = paintExport({ doc: deps.doc, index: deps.index, assets: deps.assets, theme: deps.theme(), editor: live ? deps.editor : null }, t, ctx, w, h, "transparent", true);
      if (!pending) {
        tiles.set(key, canvas);
        if (tiles.size > KEEP) tiles.delete(tiles.keys().next().value!);
      }
      return { canvas, version: `${rev}.${step}${pending ? "p" : ""}` };
    },
    objectsPart(ids, u0, v0, u1, v1, w, h) {
      const t = targetOf(ids);
      if (!t || !(w >= 1 && h >= 1)) return null;
      const key = `${ids.join(",")}|${u0}|${v0}|${u1}|${v1}|${w}|${h}`;
      const hit = parts.get(key);
      if (hit) return { canvas: hit, pending: false };
      // the part's own box, exact: shares of the objects' box (at any depth, the numbers say exactly where)
      const at = (a: D.Dyadic, b: D.Dyadic, f: number): D.Dyadic => D.add(a, D.mul(D.sub(b, a), D.fromNumber(f)));
      const sub: ExportTarget = { ...t, min: { x: at(t.min.x, t.max.x, u0), y: at(t.min.y, t.max.y, v0) }, max: { x: at(t.min.x, t.max.x, u1), y: at(t.min.y, t.max.y, v1) }, ratio: (t.ratio * (u1 - u0)) / (v1 - v0) };
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const pending = paintExport({ doc: deps.doc, index: deps.index, assets: deps.assets, theme: deps.theme(), editor: live ? deps.editor : null }, sub, ctx, w, h, "transparent", true);
      if (!pending) {
        parts.set(key, canvas);
        if (parts.size > KEEP) parts.delete(parts.keys().next().value!);
      }
      return { canvas, pending };
    },
  };
}
