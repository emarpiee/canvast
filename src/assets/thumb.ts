import type { AssetRecord } from "./asset-library";
import type { ThumbRecord } from "./asset-catalog";
import { BlankPictureError, decodeAudio, decodeVideo } from "./video";
import { probeMp4 } from "./mp4-probe";
import { makeCard, makeFileCard } from "./card";
import { describeFile, isCard, isMediaType } from "./file-kind";

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
  const card = async (): Promise<ImageBitmap> => {
    const d = describeFile(rec.name, rec.type);
    return makeFileCard(rec.name, d.chip, d.category, rec.size, 1, isMediaType(rec.type) ? "This browser cannot read it" : undefined);
  };
  try {
    const k = Math.min(1, THUMB_PX / Math.max(rec.pixelW, rec.pixelH));
    const bmp = isCard(rec)
      ? await card()
      : rec.type.startsWith("video/")
      ? await decodeVideo(rec.blob).then(
          (v) => v.bitmap,
          async (e) => {
            const pr = probeMp4(new Uint8Array(await rec.blob.arrayBuffer()));
            if (!pr) {
              if (e instanceof BlankPictureError) return e.result.bitmap;
              throw e;
            }
            return makeCard(pr.w, pr.h, rec.name, pr.codec, e instanceof BlankPictureError ? e.why : e instanceof Error ? e.message : ""); // a video this browser cannot decode: its card
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
    // A file shown as a card has its card as the thumbnail. A picture the browser cannot decode at a size (an SVG, say) has none: the library
    // shows the original itself, as it always did.
    if (!isCard(rec)) return null;
    try {
      const bmp = await card();
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      bmp.close();
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", THUMB_QUALITY));
      return blob ? { hash: rec.hash, blob, w: c.width, h: c.height } : null;
    } catch {
      return null;
    }
  }
}
