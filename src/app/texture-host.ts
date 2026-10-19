/**
 * Where a texture fill (ADR 0154) gets its pictures and objects: the app's asset library for a picture, and Export's own drawing
 * (`paintExport`) for objects, so a pattern tile is drawn by the same code as everything else. Told to `render/texture.ts` once.
 */
import type { AssetLibrary } from "../assets/asset-library";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject } from "../doc/model";
import type { TextureHost } from "../render/texture";
import type { FrameIndex } from "../scene/frame-index";
import type { SceneTheme } from "../render/scene-renderer";
import { buildTarget } from "./actions";
import type { ExportTarget } from "./export-render";
import { paintExport } from "./export-render";

const KEEP = 16;

export function createTextureHost(deps: { doc: DocumentStore; index: FrameIndex; assets: AssetLibrary; theme: () => SceneTheme }): TextureHost {
  const targets = new Map<string, ExportTarget | null>();
  const tiles = new Map<string, HTMLCanvasElement>();
  let rev = -1;
  const fresh = (): void => {
    if (rev === deps.doc.revision) return;
    rev = deps.doc.revision;
    targets.clear();
    tiles.clear();
  };
  const targetOf = (ids: readonly string[]): ExportTarget | null => {
    fresh();
    const key = ids.join(",");
    if (!targets.has(key)) {
      const sel = ids.map((i) => deps.doc.get(i)).filter((o): o is CanvasObject => !!o); // (a source may be hidden: the pattern still shows it)
      targets.set(key, sel.length ? buildTarget(deps.doc, sel, null) : null);
    }
    return targets.get(key)!;
  };
  return {
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
      if (hit) return { canvas: hit, version: `${rev}` };
      const [w, h] = t.ratio >= 1 ? [px, Math.max(1, Math.round(px / t.ratio))] : [Math.max(1, Math.round(px * t.ratio)), px];
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const pending = paintExport({ doc: deps.doc, index: deps.index, assets: deps.assets, theme: deps.theme() }, t, ctx, w, h, "transparent", true);
      if (!pending) {
        tiles.set(key, canvas);
        if (tiles.size > KEEP) tiles.delete(tiles.keys().next().value!);
      }
      return { canvas, version: `${rev}${pending ? "p" : ""}` };
    },
  };
}
