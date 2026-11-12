import { notePicture } from "../notes/note-preview";
import { noteKindOf, tooBigForNote } from "../notes/note-file";
import type { AssetRecord } from "./asset-library";
import type { ThumbRecord } from "./asset-catalog";
import { BlankPictureError, decodeAudio, decodeVideo } from "./video";
import { probeMp4 } from "./mp4-probe";
import { fillTextCentred, makeCard } from "./card";
import { externalFolder } from "../storage/external-folder";
import { artCardPicture, isArtFile } from "./art-preview";
import { makeFileCard } from "./card";
import { drawnFromFile } from "./adapters";
import { NOTE_THUMB_RATIO, chipOf, describeFile, isCard, isFontFile, isModelFile, isPdfFile } from "./file-kind";

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
  if (noteKindOf(rec.name) && !tooBigForNote(rec.name, rec.blob.size)) return makeNoteThumb(rec);
  if (isArtFile(rec.name)) return makeArtThumb(rec);
  if (isPdfFile(rec) || isModelFile(rec.name)) return makePictureThumb(rec);
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

/** What stands for an art file that keeps no picture this can read: its card, not kept, so a later reader may still find one. */
export async function artTile(rec: AssetRecord): Promise<Blob | null> {
  const bmp = await makeFileCard(chipOf(rec.name, rec.type));
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((r) => c.toBlob(r, "image/webp", THUMB_QUALITY));
}

/** An art file's thumbnail, from the picture it keeps; null when it has none. */
async function makeArtThumb(rec: AssetRecord): Promise<ThumbRecord | null> {
  const picture = await artCardPicture(await externalFolder.fileOf(rec), rec.name);
  if (!picture) return null;
  try {
    const bmp = await createImageBitmap(picture);
    const s = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", THUMB_QUALITY));
    return blob ? { hash: rec.hash, blob, w: c.width, h: c.height } : null;
  } catch {
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
    fillTextCentred(g, "Aa", THUMB_PX / 2, THUMB_PX / 2);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    return blob ? { hash: rec.hash, blob, w: c.width, h: c.height } : null;
  } catch {
    return null;
  } finally {
    if (face) document.fonts.delete(face);
  }
}

/** A canvas as a thumbnail, in the one format thumbnails are kept in. */
async function encodeThumb(hash: string, c: HTMLCanvasElement): Promise<ThumbRecord | null> {
  let blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", THUMB_QUALITY));
  if (blob?.type !== "image/webp") blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", THUMB_QUALITY));
  return blob ? { hash, blob, w: c.width, h: c.height } : null;
}

/** The thumbnail of a file whose card is drawn from its bytes (assets/adapters.ts): that picture, smaller. */
async function makePictureThumb(rec: AssetRecord): Promise<ThumbRecord | null> {
  const chip = describeFile(rec.name, rec.type).chip;
  const drawn = await drawnFromFile(rec.name, chip, async () => new Uint8Array(await rec.blob.arrayBuffer()), { edge: THUMB_PX, hash: rec.hash, fileSize: rec.blob.size });
  const bmp = drawn ?? (await makeFileCard(chip));
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  // (the plain card, because this time it could not be drawn, is shown and not kept: the next time may draw it)
  const made = await encodeThumb(rec.hash, c);
  return made && !drawn ? { ...made, notKept: true } : made;
}

/** A note's thumbnail: the top of its page (as on its card on a canvas, 4:3). Null when it cannot be drawn. */
async function makeNoteThumb(rec: AssetRecord): Promise<ThumbRecord | null> {
  try {
    const c = await notePicture(rec.name, await rec.blob.text(), THUMB_PX, Math.round(THUMB_PX / NOTE_THUMB_RATIO), rec.hash);
    return await encodeThumb(rec.hash, c);
  } catch {
    return null;
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
