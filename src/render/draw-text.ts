import { paintColor } from "./ink";
import * as D from "../core/dyadic";
import type { Viewport } from "../core/camera";
import type { ImageObject, TextObject } from "../doc/model";
import { TEXT_PAD_EM } from "../doc/model";
import type { Deco, Line, PlacedGlyph } from "../text/layout";
import { DECO, LINE_HEIGHT, glyphScale, layoutOf } from "../text/layout";
import { FALLBACK_FAMILY, faceReady, familyFor, fontFor } from "../text/fonts";
import type { ProjectedObject, Projection } from "./projection";
import { exactX, exactY, projX, projY, toPx } from "./projection";
import type { RasterSource } from "./draw-objects";
import { drawImageObject, paint } from "./draw-objects";

/**
 * Text drawing (ADR 0013). Glyph positions come from the shared layout
 * (text/layout.ts), so every mode below puts each glyph in the same place:
 *
 * - Normal sizes, opaque: the browser draws each glyph with the bundled font
 *   (fillText per glyph: no kerning, ligatures or contextual forms that the
 *   layout does not know about).
 * - Translucent: the glyph outlines are added to one path and filled once,
 *   so overlapping glyphs (italic, bold) never blend twice.
 * - Above DEEP_EM_PX per em, or when the projection needs exact arithmetic:
 *   the real glyph outlines are projected exactly at any magnification
 *   (ExactPath below). There is no zoom limit.
 *
 * Bold is the union of the outline and a copy shifted right by
 * BOLD_SHIFT_EM; italic is a shear by SKEW about the baseline. Both are
 * applied the same way in every mode (the browser is never asked to
 * synthesize them for the bundled font). Characters the font lacks use a
 * system font, and at deep zoom are drawn from a raster, so they pixelate.
 */

/** Above this many CSS px per em, glyphs are drawn from exact outlines. */
export const DEEP_EM_PX = 2000;
/** Italic shear (x += SKEW · height above baseline), exact in binary (≈ 11.5°). */
export const SKEW = 13 / 64;
export const BOLD_SHIFT_EM = 1 / 32;

/** Culling margin around the viewport (CSS px). */
const VIEW_MARGIN = 64;
/** Outline pieces are handed to the canvas only once they lie within this many px of the viewport. */
const NEAR_LIMIT = 2 ** 14;
/** Radius (px) of the circle that stands in for outline pieces far outside the viewport. */
const FAR_RADIUS = 2 ** 17;
/** Raster resolution (px per em) of system-font characters at deep zoom. */
const RASTER_EM_PX = 128;

export function drawText(ctx: CanvasRenderingContext2D, po: ProjectedObject, vp: Viewport, dpr: number): void {
  const o = po.obj as TextObject;
  const p = po.proj;
  const lay = layoutOf(o);
  const SIZE = D.fromNumber(o.size);
  const emPx = toPx(p, SIZE);
  // Screen position of a layout coordinate (em).
  const sx = (em: number): number => (po.exact ? exactX(p, D.mul(D.fromNumber(em), SIZE)) : projX(p, em * o.size));
  const sy = (em: number): number => (po.exact ? exactY(p, D.mul(D.fromNumber(em), SIZE)) : projY(p, em * o.size));
  const minX = -VIEW_MARGIN;
  const minY = -VIEW_MARGIN;
  const maxX = vp.width + VIEW_MARGIN;
  const maxY = vp.height + VIEW_MARGIN;
  const opaque = o.opacity === 1;
  let font = "";
  const setFont = (f: string): void => {
    if (f !== font) ctx.font = font = f;
  };
  const glyphText = (ch: string, x: number, y: number, italic: boolean): void => {
    if (!italic) return ctx.fillText(ch, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1, 0, -SKEW, 1, 0, 0);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  };
  ctx.save();
  paint(ctx, o, () => {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // One pass per colour (nearly always one): a range with a colour of its own is filled apart from the rest.
    const colours = new Set<string>();
    for (const line of lay.lines) {
      for (const g of line.glyphs) colours.add(g.color ?? o.color);
      for (const d of line.decos) colours.add(d.color ?? o.color);
    }
    for (const colour of colours) {
      ctx.fillStyle = paintColor(colour);
      ctx.beginPath();
      const path = new ExactPath(ctx, p, vp);
      let filled = false;
      for (const line of lay.lines) {
        if (sy(line.bottom + TEXT_PAD_EM) < minY || sy(line.top - TEXT_PAD_EM) > maxY) continue;
        const deep = po.exact || !(emPx * line.scale * lineBig(line) <= DEEP_EM_PX);
        const pad = TEXT_PAD_EM * line.scale;
        for (const g of line.glyphs) {
          if (g.cp === 32 || (g.color ?? o.color) !== colour || sx(g.x + g.adv + pad) < minX || sx(g.x - pad) > maxX) continue;
          const gs = glyphScale(line, g);
          const linePx = emPx * gs;
          const shifts = g.bold ? [0, BOLD_SHIFT_EM * gs] : [0];
          if (!g.gid) {
            if (deep) drawFallbackRaster(ctx, p, vp, dpr, o, line, g, colour);
            else {
              setFont(`${g.bold ? "bold " : ""}${linePx}px ${FALLBACK_FAMILY}`);
              glyphText(String.fromCodePoint(g.cp), sx(g.x), sy(line.baseline), g.italic);
            }
          } else if (deep) {
            for (const d of shifts) addGlyphExact(path, o, line, g, d);
            filled = true;
          } else if (opaque && faceReady(o.assetId)) {
            setFont(`${linePx}px ${familyFor(o.assetId)}`);
            for (const d of shifts) glyphText(String.fromCodePoint(g.cp), sx(g.x + d), sy(line.baseline), g.italic);
          } else {
            for (const d of shifts) addGlyphFast(ctx, p, o, line, g, d);
            filled = true;
          }
        }
        for (const d of line.decos) {
          if ((d.color ?? o.color) !== colour || sx(d.x1) < minX || sx(d.x0) > maxX) continue;
          addDeco(ctx, path, po, o, line, d, deep, sx, sy);
          filled = true;
        }
      }
      if (filled) ctx.fill("nonzero");
    }
  });
  ctx.restore();
}

/** The biggest size of a glyph on a line, as a multiple of the line's. */
const lineBig = (line: Line): number => line.glyphs.reduce((m, g) => Math.max(m, g.k ?? 1), 1);

/** The rectangle of an underline or a strikethrough: in doubles, or (at deep zoom) as exact lines in the same path as the glyphs. */
function addDeco(ctx: CanvasRenderingContext2D, path: ExactPath, po: ProjectedObject, o: TextObject, line: Line, d: Deco, deep: boolean, sx: (em: number) => number, sy: (em: number) => number): void {
  const gs = line.scale * d.k;
  const thick = DECO.thick * gs;
  const y0 = line.baseline + (d.kind === "under" ? DECO.underOffset * gs : -DECO.strikeOffset * gs - thick / 2);
  const y1 = y0 + thick;
  if (!deep) {
    ctx.moveTo(sx(d.x0), sy(y0));
    ctx.lineTo(sx(d.x1), sy(y0));
    ctx.lineTo(sx(d.x1), sy(y1));
    ctx.lineTo(sx(d.x0), sy(y1));
    ctx.closePath();
    return;
  }
  const SIZE = D.fromNumber(o.size);
  const pt = (xe: number, ye: number): Pt => ({ x: D.mul(D.fromNumber(xe), SIZE), y: D.mul(D.fromNumber(ye), SIZE) });
  const c = [pt(d.x0, y0), pt(d.x1, y0), pt(d.x1, y1), pt(d.x0, y1)];
  for (let i = 0; i < 4; i++) path.segment([c[i]!, c[(i + 1) % 4]!]);
  path.close();
  void po;
}

/** Glyph outline in doubles (bounded sizes only). */
function addGlyphFast(ctx: CanvasRenderingContext2D, p: Projection, o: TextObject, line: Line, g: PlacedGlyph, shiftEm: number): void {
  const f = fontFor(o.assetId);
  const c = (o.size * glyphScale(line, g)) / f.unitsPerEm;
  const ox = (g.x + shiftEm) * o.size;
  const oy = line.baseline * o.size;
  const X = (fx: number, fy: number): number => projX(p, ox + (g.italic ? fx + fy * SKEW : fx) * c);
  const Y = (fy: number): number => projY(p, oy - fy * c);
  for (const contour of f.glyph(g.gid).contours) {
    contour.forEach((s, i) => {
      if (i === 0) ctx.moveTo(X(s[0]!, s[1]!), Y(s[1]!));
      if (s.length === 4) ctx.lineTo(X(s[2]!, s[3]!), Y(s[3]!));
      else ctx.quadraticCurveTo(X(s[2]!, s[3]!), Y(s[3]!), X(s[4]!, s[5]!), Y(s[5]!));
    });
    ctx.closePath();
  }
}

interface Pt {
  readonly x: D.Dyadic;
  readonly y: D.Dyadic;
}

function addGlyphExact(path: ExactPath, o: TextObject, line: Line, g: PlacedGlyph, shiftEm: number): void {
  const f = fontFor(o.assetId);
  const SIZE = D.fromNumber(o.size);
  const C = D.mul(SIZE, D.fromNumber(glyphScale(line, g) / f.unitsPerEm));
  const ox = D.mul(D.fromNumber(g.x + shiftEm), SIZE);
  const oy = D.mul(D.fromNumber(line.baseline), SIZE);
  const pt = (fx: number, fy: number): Pt => ({
    x: D.add(ox, D.mul(D.fromNumber(g.italic ? fx + fy * SKEW : fx), C)),
    y: D.sub(oy, D.mul(D.fromNumber(fy), C)),
  });
  for (const contour of f.glyph(g.gid).contours) {
    for (const s of contour) {
      const pts: Pt[] = [];
      for (let i = 0; i < s.length; i += 2) pts.push(pt(s[i]!, s[i + 1]!));
      path.segment(pts);
    }
    path.close();
  }
}

const mid = (a: Pt, b: Pt): Pt => ({ x: D.shift(D.add(a.x, b.x), -1), y: D.shift(D.add(a.y, b.y), -1) });

/**
 * Exact outline projection at any magnification. Outline pieces (lines and
 * quadratics in exact local units) are split at their midpoints (exact)
 * until each one either
 *
 * - lies within NEAR_LIMIT px of the viewport: drawn as is (doubles are
 *   accurate there and the canvas gets bounded coordinates), or
 * - has its control box entirely outside the viewport (plus a margin): it
 *   cannot cover any visible pixel, and only its contribution to the
 *   winding number of visible points matters. Its control polygon does not
 *   contain the viewport centre, so it sweeps less than half a turn around
 *   it; consecutive far pieces are replaced by their total swept angle as an
 *   arc of a circle of radius FAR_RADIUS around the centre, joined to the
 *   rest radially. Moving points radially away from a convex region keeps
 *   them outside it, so this changes no visible point's winding number.
 *
 * Every contour stays one closed path, so the result is filled once with
 * the nonzero rule.
 */
class ExactPath {
  private started = false;
  private far: { a0: number; sweep: number } | null = null;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly p: Projection,
    private readonly vp: Viewport,
  ) {}

  segment(pts: Pt[]): void {
    const stack: Pt[][] = [pts];
    while (stack.length) {
      const piece = stack.pop()!;
      const xs = piece.map((q) => exactX(this.p, q.x));
      const ys = piece.map((q) => exactY(this.p, q.y));
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const W = this.vp.width;
      const H = this.vp.height;
      if (x1 < -VIEW_MARGIN || x0 > W + VIEW_MARGIN || y1 < -VIEW_MARGIN || y0 > H + VIEW_MARGIN) {
        this.addFar(piece[0]!, piece[piece.length - 1]!);
      } else if (x0 >= -NEAR_LIMIT && x1 <= W + NEAR_LIMIT && y0 >= -NEAR_LIMIT && y1 <= H + NEAR_LIMIT) {
        this.flush();
        this.to(xs[0]!, ys[0]!);
        if (piece.length === 2) this.ctx.lineTo(xs[1]!, ys[1]!);
        else this.ctx.quadraticCurveTo(xs[1]!, ys[1]!, xs[2]!, ys[2]!);
      } else if (piece.length === 2) {
        const m = mid(piece[0]!, piece[1]!);
        stack.push([m, piece[1]!], [piece[0]!, m]);
      } else {
        const [a, c, b] = piece as [Pt, Pt, Pt];
        const ac = mid(a, c);
        const cb = mid(c, b);
        const m = mid(ac, cb);
        stack.push([m, cb, b], [a, ac, m]);
      }
    }
  }

  close(): void {
    this.flush();
    if (this.started) this.ctx.closePath();
    this.started = false;
  }

  private to(x: number, y: number): void {
    if (this.started) this.ctx.lineTo(x, y);
    else this.ctx.moveTo(x, y);
    this.started = true;
  }

  /** Angle of a point around the viewport centre, from exact offsets (no overflow). */
  private angle(q: Pt): number {
    const dx = D.sub(q.x, this.p.lx);
    const dy = D.sub(q.y, this.p.ly);
    const s = Math.floor(Math.max(D.log2Abs(dx), D.log2Abs(dy)));
    return Math.atan2(D.toNumber(D.shift(dy, -s)), D.toNumber(D.shift(dx, -s)));
  }

  private addFar(a: Pt, b: Pt): void {
    const t0 = this.angle(a);
    let d = this.angle(b) - t0;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    if (!this.far) this.far = { a0: t0, sweep: 0 };
    this.far.sweep += d;
  }

  private flush(): void {
    const f = this.far;
    if (!f) return;
    this.far = null;
    const { cx, cy } = this.p;
    this.to(cx + FAR_RADIUS * Math.cos(f.a0), cy + FAR_RADIUS * Math.sin(f.a0));
    this.ctx.arc(cx, cy, FAR_RADIUS, f.a0, f.a0 + f.sweep, f.sweep < 0);
  }
}

const rasters = new Map<string, RasterSource>();

/**
 * A system-font character at deep zoom: rendered once at RASTER_EM_PX and
 * drawn like an image (exact pixel edges at any magnification), so it
 * pixelates instead of disappearing.
 */
function drawFallbackRaster(ctx: CanvasRenderingContext2D, p: Projection, vp: Viewport, dpr: number, o: TextObject, line: Line, g: PlacedGlyph, colour: string): void {
  const pad = TEXT_PAD_EM;
  const R = RASTER_EM_PX;
  const gs = glyphScale(line, g);
  const pixelW = Math.ceil((g.adv / gs + 2 * pad) * R);
  const pixelH = Math.ceil(Math.max(o.lineHeight ?? LINE_HEIGHT, (line.bottom - line.top) / gs) * R);
  const key = `${g.cp}|${g.bold}|${g.italic}|${paintColor(colour)}|${pixelW}|${pixelH}|${((line.baseline - line.top) / gs).toFixed(4)}`;
  let src = rasters.get(key);
  if (!src) {
    if (rasters.size > 256) rasters.clear();
    const c = document.createElement("canvas");
    c.width = pixelW;
    c.height = pixelH;
    const r = c.getContext("2d", { willReadFrequently: true })!;
    r.fillStyle = paintColor(colour);
    r.font = `${g.bold ? "bold " : ""}${R}px ${FALLBACK_FAMILY}`;
    r.translate(pad * R, ((line.baseline - line.top) / gs) * R);
    if (g.italic) r.transform(1, 0, -SKEW, 1, 0, 0);
    r.fillText(String.fromCodePoint(g.cp), 0, 0);
    src = { source: c, pixelW, pixelH, readPixels: (x, y, w, h) => r.getImageData(x, y, w, h).data };
    rasters.set(key, src);
  }
  const SIZE = D.fromNumber(o.size);
  const offX = D.mul(D.fromNumber(g.x - pad * gs), SIZE);
  const offY = D.mul(D.fromNumber(line.top), SIZE);
  const w = (pixelW / R) * gs * o.size;
  const h = (pixelH / R) * gs * o.size;
  const img: ImageObject = { ...o, kind: "image", assetId: "", w, h, pixelW, pixelH, opacity: 1 };
  // The raster's projection: the text's, with the origin moved to the raster's corner.
  const lx = D.sub(p.lx, offX);
  const ly = D.sub(p.ly, offY);
  const ddx = D.toDD(lx);
  const ddy = D.toDD(ly);
  const proj: Projection = { ...p, lx, ly, lxHi: ddx.hi, lxLo: ddx.lo, lyHi: ddy.hi, lyLo: ddy.lo };
  const box = {
    minX: exactX(p, offX),
    minY: exactY(p, offY),
    maxX: exactX(p, D.add(offX, D.fromNumber(w))),
    maxY: exactY(p, D.add(offY, D.fromNumber(h))),
  };
  const q = Float64Array.of(box.minX, box.minY, box.maxX, box.maxY);
  drawImageObject(ctx, { obj: img, proj, box, q, radius: 0, exact: false }, vp, dpr, src, "");
}
