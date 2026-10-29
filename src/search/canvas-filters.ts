/**
 * Search words that only the canvas search understands, beside names, `#tag` and `.png`: `kind:text` (picture, video, gif, audio, text,
 * stroke, shape, sheet), `group:name` (in a group of that name), `in:name` (on a sheet of that name), `fill:red` and `stroke:#2563eb` (the
 * colour of the fill or the outline, a gradient matching by any of its stops), and `is:locked|masked|offscreen|tagged|named|rotated`.
 */
import { colourMatches } from "../assets/look";
import type { CanvasObject } from "../doc/model";
import type { Paint } from "../doc/paint";

export interface CanvasContext {
  /** The name of a sheet (by id), lower case; undefined when there is none. */
  sheetName(id: string): string | undefined;
  /** Whether the object is in the view now. */
  onScreen(o: CanvasObject): boolean;
}

export type CanvasFilter = (o: CanvasObject, ctx: CanvasContext) => boolean;

export type CanvasKind = "picture" | "video" | "gif" | "audio" | "text" | "stroke" | "shape" | "sheet";

export const canvasKindOf = (o: CanvasObject): CanvasKind => {
  if (o.kind === "image") return o.media?.kind ?? "picture";
  if (o.kind === "path") return o.container ? "sheet" : "shape";
  return o.kind;
};
const KINDS: Record<string, CanvasKind> = { picture: "picture", pictures: "picture", image: "picture", images: "picture", video: "video", videos: "video", gif: "gif", gifs: "gif", audio: "audio", sound: "audio", text: "text", texts: "text", stroke: "stroke", strokes: "stroke", pen: "stroke", shape: "shape", shapes: "shape", path: "shape", sheet: "sheet", sheets: "sheet" };

const rgbOf = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const paintMatches = (p: Paint | null | undefined, want: string): boolean => {
  if (!p) return false;
  const colours = typeof p === "string" ? [p] : p.type === "texture" ? [] : p.stops.map((s) => s.c);
  return colours.some((c) => {
    const rgb = rgbOf(c);
    return !!rgb && colourMatches(rgb, want);
  });
};
/** The paint of a part: `fill` is what fills the object (a stroke's ink, a text's letters), `stroke` its outline. */
const partOf = (o: CanvasObject, part: "fill" | "stroke"): Paint | null | undefined => {
  if (o.kind === "path") return part === "fill" ? o.fill : o.stroke;
  if (o.kind === "stroke") return o.color;
  if (o.kind === "text") return part === "fill" ? (o.gradient ?? o.color) : o.outline?.c;
  return part === "stroke" ? o.stroke : undefined;
};

const IS: Record<string, CanvasFilter> = {
  locked: (o) => o.locked === true,
  masked: (o) => o.mask !== undefined,
  offscreen: (o, ctx) => !ctx.onScreen(o),
  "off-screen": (o, ctx) => !ctx.onScreen(o),
  onscreen: (o, ctx) => ctx.onScreen(o),
  tagged: (o) => (o.tags?.length ?? 0) > 0,
  named: (o) => !!o.name,
  rotated: (o) => !!o.rot,
  grouped: (o) => (o.groups?.length ?? 0) > 0,
};

/** The filter a search word stands for (lower case), or null when it is an ordinary word. */
export function parseCanvasFilter(w: string): CanvasFilter | null {
  const m = /^(kind|is|group|in|fill|stroke|colou?r):(.+)$/.exec(w);
  if (!m) return null;
  const v = m[2]!;
  switch (m[1]) {
    case "kind": {
      const k = KINDS[v];
      return k ? (o) => canvasKindOf(o) === k : null;
    }
    case "is":
      return IS[v] ?? null;
    case "group":
      return (o) => (o.groups ?? []).some((g) => (o.groupNames?.[g] ?? "").toLowerCase().includes(v));
    case "in":
      return (o, ctx) => !!o.parent && (ctx.sheetName(o.parent)?.includes(v) ?? false);
    case "fill":
      return (o) => paintMatches(partOf(o, "fill"), v);
    case "stroke":
      return (o) => paintMatches(partOf(o, "stroke"), v);
    default:
      return (o) => paintMatches(partOf(o, "fill"), v) || paintMatches(partOf(o, "stroke"), v);
  }
}
