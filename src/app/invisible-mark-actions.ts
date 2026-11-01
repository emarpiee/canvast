/**
 * The invisible watermark in the app (doc/invisible-mark.ts): hide a text or a logo in a copy of the picked picture (a new library picture
 * beside it; the picture itself is not changed), and read one back from a picture on the canvas or from a file, trying the scales and
 * quarter turns a copy may have been through.
 */
import type { AssetLibrary, AssetRecord } from "../assets/asset-library";
import type { MarkContent, Pixels, Strength } from "../doc/invisible-mark";
import { findFrame, frameOf, hideFrame, logoBits, markKey, minPart, openFrame } from "../doc/invisible-mark";
import type { DocumentStore } from "../doc/document-store";
import type { ImageObject, TextObject } from "../doc/model";
import { markText, readText } from "../doc/text-mark";
import type { EditorState } from "./editor-state";
import { placeBeside } from "./actions";
import { bakedPicture } from "./watermark-bake";

/** The pixels of a picture file (null: not one the browser can read). Turned by `quarter` quarter turns and scaled by `scale`. */
async function pixelsOf(blob: Blob, quarter = 0, scale = 1): Promise<(Pixels & { canvas: HTMLCanvasElement }) | null> {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return null;
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const side = quarter % 2 === 1;
  const c = document.createElement("canvas");
  c.width = side ? h : w;
  c.height = side ? w : h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.imageSmoothingQuality = "high";
  g.translate(c.width / 2, c.height / 2);
  g.rotate((quarter * Math.PI) / 2);
  g.drawImage(bmp, -w / 2, -h / 2, w, h);
  bmp.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data, canvas: c };
}

/** A picture file's 32 × 32 logo bits, and a picture of them (null: not a picture). */
export async function logoFromFile(file: Blob): Promise<{ bits: Uint8Array; preview: string } | null> {
  const p = await pixelsOf(file);
  return p ? { bits: logoBits(p), preview: logoPicture(logoBits(p)) } : null;
}

/** 32 × 32 logo bits as a PNG data URL (dark on light), to show. */
export function logoPicture(bits: Uint8Array): string {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const d = g.createImageData(32, 32);
  for (let i = 0; i < 1024; i++) {
    const v = (bits[i >> 3]! >> (7 - (i & 7))) & 1 ? 20 : 240;
    d.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(d, 0, 0);
  return c.toDataURL("image/png");
}

export interface HideOptions {
  readonly content: MarkContent;
  readonly password: string;
  readonly strength: Strength;
  /** The part of the picture to hide it in, as fractions of its box (default: all of it). */
  readonly region?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/**
 * Hide the mark in a copy of `o` as it looks (crop, flip, adjustments, visible watermark), placed beside it. Returns how visible the change
 * is (PSNR in dB) and a picture of the change, made 20 times stronger; the least size when the part chosen is too small; null when it could
 * not be made.
 */
export async function hideInPicture(
  doc: DocumentStore,
  editor: EditorState,
  assets: AssetLibrary,
  o: ImageObject,
  opts: HideOptions,
  store: (shot: { png: Blob; label: string; sourceName: string; sourceHash: string; kind?: "edit" }) => Promise<AssetRecord>,
): Promise<{ psnr: number; change: string } | { tooSmall: { w: number; h: number; min: number } } | null> {
  const rec = await assets.record(o.assetId).catch(() => undefined);
  const png = rec ? await bakedPicture(o, rec.blob, assets) : null;
  const p = png ? await pixelsOf(png) : null;
  if (!rec || !p) return null;
  const before = p.data.slice();
  const r = opts.region;
  const region = r ? { x0: Math.round(r.x * p.width), y0: Math.round(r.y * p.height), x1: Math.round((r.x + r.w) * p.width), y1: Math.round((r.y + r.h) * p.height) } : undefined;
  // (a part too small to hold two tiles each way could not be told from the rest when it is read)
  const min = minPart(opts.content);
  if (region && (region.x1 - region.x0 < min || region.y1 - region.y0 < min)) return { tooSmall: { w: region.x1 - region.x0, h: region.y1 - region.y0, min } };
  const key = await markKey(opts.password);
  const frame = await frameOf(opts.content, key);
  const psnr = hideFrame(p, frame, opts.strength, region);
  const g = p.canvas.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0); // (the pixels read from this canvas, changed in place)
  const out = await new Promise<Blob | null>((res) => p.canvas.toBlob(res, "image/png"));
  if (!out) return null;
  const record = await store({ png: out, label: "Invisible watermark", sourceName: rec.name, sourceHash: o.assetId, kind: "edit" });
  placeBeside(doc, editor, o, record, "Hide a watermark in a copy");
  return { psnr, change: changePicture(before, p.data, p.width, p.height) };
}

/** The change made to a picture, 20 times stronger, grey where nothing changed, at most 256 px on its longer side. */
function changePicture(before: Uint8ClampedArray, after: Uint8ClampedArray, w: number, h: number): string {
  const k = Math.min(1, 256 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d")!;
  const d = g.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = (Math.min(h - 1, Math.floor(y / k)) * w + Math.min(w - 1, Math.floor(x / k))) * 4;
    const v = Math.max(0, Math.min(255, 128 + 20 * (after[i]! - before[i]!)));
    d.data.set([v, v, v, 255], (y * cw + x) * 4);
  }
  g.putImageData(d, 0, 0);
  return c.toDataURL("image/png");
}

export type ReadResult =
  | { readonly found: "yes"; readonly content: MarkContent; readonly agree: number; readonly how: string }
  | { readonly found: "locked"; readonly agree: number }
  | { readonly found: "no" };

/** The scales a copy may have been resized by, most likely first, and the quarter turns. */
const SCALES = [1, 0.5, 2, 0.75, 4 / 3, 1.5, 2 / 3, 0.8, 1.25];
/** The longer side a picture is read at, at most (bigger is made smaller first: it holds the mark many times over). */
const READ_MAX = 3000;

/** Look for a mark in a picture file, trying each scale and quarter turn until one is found; `progress` hears how far it is. */
export async function readPicture(blob: Blob, password: string, progress: (done: number, total: number) => void): Promise<ReadResult> {
  const probe = await createImageBitmap(blob).catch(() => null);
  if (!probe) return { found: "no" };
  const fit = Math.min(1, READ_MAX / Math.max(probe.width, probe.height));
  probe.close();
  const tries = [0, 1, 2, 3].flatMap((q) => SCALES.map((s) => ({ q, s })));
  for (const [i, t] of tries.entries()) {
    progress(i, tries.length);
    await new Promise((r) => setTimeout(r, 0)); // (the page stays alive between tries)
    // (a copy made `s` times the size is brought back by 1 / s; one made smaller than the reading size is read at its own)
    const p = await pixelsOf(blob, t.q, Math.min(fit / t.s, 1 / t.s));
    const f = p && findFrame(p);
    if (!f) continue;
    progress(tries.length, tries.length);
    const content = await openFrame(f, await markKey(password));
    if (!content) return { found: "locked", agree: f.agree };
    const how = [t.s !== 1 ? `resized to ${Math.round(t.s * 100)}%` : "", t.q ? `turned ${t.q * 90}°` : ""].filter(Boolean).join(", ");
    return { found: "yes", content, agree: f.agree, how };
  }
  progress(tries.length, tries.length);
  return { found: "no" };
}

// ---- texts ------------------------------------------------------------------------------------------------------------------------------

/** The one picked text (null: not exactly one, or locked). */
export function pickedText(doc: DocumentStore, editor: EditorState): TextObject | null {
  const ids = [...editor.selection];
  const o = ids.length === 1 ? doc.get(ids[0]!) : undefined;
  return o?.kind === "text" && !o.locked ? o : null;
}

/** Hide `words` between the words of the picked text (a mark it had is replaced): one undo step. False when no text is picked. */
export async function hideInText(doc: DocumentStore, editor: EditorState, words: string, password: string): Promise<boolean> {
  const o = pickedText(doc, editor);
  if (!o || editor.blockEdit()) return false;
  const md = await markText(o.md, words, await markKey(password));
  const now = doc.get(o.id);
  if (now?.kind !== "text") return false;
  doc.commit(doc.transaction("Hide a watermark in the text", [{ ...now, md }]));
  editor.changed();
  return true;
}

/** Look for a mark in a text (a picked text's words, or text pasted in). */
export async function readMarkedText(text: string, password: string): Promise<ReadResult> {
  const r = await readText(text, await markKey(password));
  return r.found === "yes" ? { found: "yes", content: { kind: "text", text: r.words }, agree: 1, how: "" } : r.found === "locked" ? { found: "locked", agree: 1 } : { found: "no" };
}
