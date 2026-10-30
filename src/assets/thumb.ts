import type { AssetRecord } from "./asset-library";
import type { ThumbRecord } from "./asset-catalog";
import { BlankPictureError, decodeAudio, decodeVideo } from "./video";
import { probeMp4 } from "./mp4-probe";
import { makeCard } from "./card";
import { isCard, isFontFile } from "./file-kind";

/** Longest edge of a stored thumbnail (CSS px: cards show them at up to 240). */
export const THUMB_PX = 256;
/** Lossy quality: a thumbnail is a recognisable face, not the picture (ADR 0034). */
const THUMB_QUALITY = 0.6;

/**
 * A lower-quality thumbnail of an original, or null when the browser cannot decode it. Decoded straight at
 * thumbnail size (a full-size decode of each of hundreds of originals is what made the grid heavy). WebP, or JPEG
 * where the browser cannot encode WebP.
 */
export async function makeThumb(rec: AssetRecord): Promise<ThumbRecord | null> {
  // A file shown as a card has no stored picture: the library draws a fixed tile for it (ADR 0089), so there is nothing to make.
  if (isFontFile(rec)) return makeFontThumb(rec);
  if (isCard(rec)) return null;
  try {
    const k = Math.min(1, THUMB_PX / Math.max(rec.pixelW, rec.pixelH));
    const bmp = rec.type.startsWith("video/")
      ? await decodeVideo(rec.blob).then(
          (v) => v.bitmap,
          async (e) => {
            const pr = probeMp4(new Uint8Array(await rec.blob.arrayBuffer()));
            if (!pr) {
              if (e instanceof BlankPictureError) return e.result.bitmap;
              throw e;
            }
            return makeCard(pr.w, pr.h, pr.codec); // a video this browser cannot decode: its card
          },
        )
      : rec.type.startsWith("audio/")
        ? (await decodeAudio(rec.blob)).bitmap
        : await createImageBitmap(rec.blob, k < 1 ? { resizeWidth: Math.max(1, Math.round(rec.pixelW * k)), resizeHeight: Math.max(1, Math.round(rec.pixelH * k)), resizeQuality: "high" } : undefined);
    const s = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    let blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", THUMB_QUALITY));
    if (blob?.type !== "image/webp") blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", THUMB_QUALITY));
    return blob ? { hash: rec.hash, blob, w: c.width, h: c.height } : null;
  } catch {
    // A picture the browser cannot decode at a size (an SVG, say) has no thumbnail: the library shows the original itself, as it always did.
    return null;
  }
}

/**
 * A font's thumbnail: "Aa" in that font, light on a clear ground (the library shows it in the theme's colour). Null when the browser cannot
 * read the font.
 */
async function makeFontThumb(rec: AssetRecord): Promise<ThumbRecord | null> {
  let face: FontFace | null = null;
  try {
    face = new FontFace(`canvast-thumb-${rec.hash.slice(0, 12)}`, await rec.blob.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    const c = document.createElement("canvas");
    c.width = c.height = THUMB_PX;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    // As large as fits: measured once at a reference size, then scaled to fill most of the width.
    g.font = `100px "${face.family}"`;
    const w = g.measureText("Aa").width || 100;
    const size = Math.min(THUMB_PX * 0.62, (100 * THUMB_PX * 0.78) / w);
    g.font = `${size}px "${face.family}"`;
    g.fillText("Aa", THUMB_PX / 2, THUMB_PX / 2);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    return blob ? { hash: rec.hash, blob, w: c.width, h: c.height } : null;
  } catch {
    return null;
  } finally {
    if (face) document.fonts.delete(face);
  }
}

/** A custom thumbnail's picture as kept (`CustomThumbStore`): at most 512 px on its longer side, WebP (PNG where it cannot be encoded). */
export async function shrinkPicture(blob: Blob, max = 512): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const out = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/webp", 0.85));
  return out ?? (await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("the picture could not be made"))), "image/png")));
}
