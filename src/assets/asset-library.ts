import type { RasterSource } from "../render/draw-objects";
import { plural } from "../doc/plural";
import { sha256Hex } from "./sha256";
import type { OriginalStore } from "../storage/store";
import { makeThumb } from "./thumb";
import { BlankPictureError, decodeAudio, decodeVideo } from "./video";
import { GifFrames } from "./gif";
import { probeMp4 } from "./mp4-probe";
import { makeFileCardFrom } from "./adapters";
import { FILE_CARD_H, FILE_CARD_W, makeCard } from "./card";
import { describeFile, isCard, isMediaType } from "./file-kind";

/**
 * Shared, content-addressed source files. A placed image is an *instance*
 * referencing an asset by SHA-256; the original bytes are stored once no
 * matter how many instances exist, and are never modified.
 */
export interface AssetRecord {
  hash: string;
  type: string;
  size: number;
  name: string;
  pixelW: number;
  pixelH: number;
  blob: Blob;
  importedAt: number;
  /** Video, audio and animated GIF: length in seconds. */
  duration?: number;
  /** Kept as a card: the browser cannot show this file (ADR 0078). Always set for files that are not pictures, video or audio. */
  card?: boolean;
  /** Animated GIF: number of frames (absent on a still GIF and on one imported before frames were read). */
  frames?: number;
  /** 1 on a stub: the bytes are a file of the library folder (ADR 0159) and `blob` is empty. `size` is the file's size. */
  ext?: 1;
  /** On a stub: the file's name in the folder (hash and extension). Absent on a stub made before names had extensions: then the hash alone. */
  file?: string;
}

/** Largest accepted import, to fail fast instead of exhausting memory. */
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;

export class ImportError extends Error {}

export interface ImportOutcome {
  record: AssetRecord;
  /** The bytes were already in the library: "present", or "restored" from the deleted list; null for a new original. */
  duplicate: "present" | "restored" | null;
}

/** One line for the user about files that were already in the library (null when none were). */
export function duplicateNotice(names: ReadonlyArray<{ name: string; duplicate: "present" | "restored" }>, total: number): string | null {
  if (!names.length) return null;
  const restored = names.filter((n) => n.duplicate === "restored").length;
  if (names.length === 1) {
    const n = names[0]!;
    const label = n.name ? `“${n.name}”` : "This image";
    return n.duplicate === "restored" ? `${label} was in the deleted list and is back in your library.` : `${label} is already in your library: no second copy is stored.`;
  }
  return `${names.length} of ${plural(total, "file")} were already in your library: no second copies are stored${restored ? ` (${restored} restored from the deleted list)` : ""}.`;
}

interface Decoded extends RasterSource {
  readonly pixelW: number;
  readonly pixelH: number;
  readonly scale?: number;
  /** Memory the decoded pixels take (RGBA, 4 bytes a pixel). */
  readonly bytes: number;
  /** Last time a frame asked for it (performance.now). */
  lastUsed: number;
  /** Free the decoded pixels now (an ImageBitmap is released at once; an <img> when it is collected). */
  release(): void;
}

/**
 * Decoded images are cached for drawing, which costs memory far beyond the stored file (a 1920x1080 PNG of 1 MB is
 * 8 MB decoded). They are a cache: the original stays stored and is decoded again when needed. Over the budget, the
 * least recently used ones that no recent frame asked for are released (ADR 0027).
 */
export const DEFAULT_DECODED_BUDGET = 384 * 2 ** 20;
/** Key suffix of the reduced copy of an image in the decoded cache. */
const SMALL_KEY = "@small";
/**
 * Images are decoded at most this many at a time. Hundreds of images asking at once (a big batch placed on the canvas)
 * would otherwise decode in parallel, each briefly holding its full pixels: gigabytes for a few seconds (ADR 0030).
 */
export const MAX_DECODES = 3;
/** A queued decode nothing has asked for within this many ms is dropped (the image left the view). */
const QUEUE_STALE_MS = 1500;
/** An image asked for within this many ms is in use and is never released. */
const IN_USE_MS = 1500;

/** `at` is the part after `#` of a decoded key: milliseconds for a video, a frame index for a GIF (doc/model.ts rasterKey). */
async function decode(blob: Blob, at = 0): Promise<CanvasImageSource & { width: number; height: number }> {
  if (blob.type.startsWith("video/")) return (await decodeVideo(blob, at / 1000)).bitmap;
  if (blob.type === "image/gif") {
    try {
      const g = new GifFrames(new Uint8Array(await blob.arrayBuffer()));
      return await createImageBitmap(new ImageData(g.frame(Math.min(at, g.count - 1)), g.width, g.height));
    } catch {
      // not a GIF this decoder reads: the browser's own picture (first frame)
    }
  }
  if (blob.type.startsWith("audio/")) return (await decodeAudio(blob)).bitmap;
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // fall back to an <img> element (e.g. SVG in some engines)
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * An image drawn small (at most half of SMALL_EDGE CSS px on its longer side) is drawn from a reduced copy of this
 * longer side, decoded straight at that size: a 1920x1080 image then costs 0.6 MB instead of 8 MB, and drawing it
 * is faster. Only images whose longer side is above SMALL_EDGE have one (ADR 0030).
 */
export const SMALL_EDGE = 512;

function makeSource(img: CanvasImageSource & { width: number; height: number }, fullW = img.width): Decoded {
  let scratch: HTMLCanvasElement | null = null;
  let lastKey = "";
  let lastData = new Uint8ClampedArray(0);
  return {
    source: img,
    pixelW: img.width,
    pixelH: img.height,
    ...(img.width !== fullW ? { scale: img.width / fullW } : {}),
    bytes: img.width * img.height * 4,
    lastUsed: performance.now(),
    release() {
      scratch = null;
      lastData = new Uint8ClampedArray(0);
      (img as Partial<ImageBitmap>).close?.();
    },
    readPixels(x, y, w, h) {
      const key = `${x},${y},${w},${h}`;
      if (key === lastKey) return lastData;
      scratch ??= document.createElement("canvas");
      scratch.width = w;
      scratch.height = h;
      const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      lastData = ctx.getImageData(0, 0, w, h).data;
      lastKey = key;
      return lastData;
    },
  };
}

export class AssetLibrary {
  private readonly decoded = new Map<string, Decoded>();
  private readonly pending = new Set<string>();
  private readonly missing = new Set<string>();
  /** Of the missing: hidden items' encrypted files while the Hidden items are locked (drawn with a padlock). */
  private readonly locked = new Set<string>();
  /** Originals the browser could not decode at a reduced size. */
  private readonly noReduced = new Set<string>();
  private readonly memoryOnly = new Map<string, AssetRecord>();
  private budget = DEFAULT_DECODED_BUDGET;
  private running = 0;
  maxRunning = 0;
  private readonly queue = new Map<string, { hash: string; small: boolean; wanted: number }>();
  private lastEvictCheck = 0;

  constructor(
    private readonly store: OriginalStore | null,
    private readonly onReady: () => void,
  ) {
    if (store) store.onNotice = (text) => this.onNotice?.(text);
  }

  /** Told once when storage is nearly full (set by the app, which shows it as a notice). */
  onNotice: ((text: string) => void) | null = null;

  /** Import a file: hash, decode (validates it is an image), store once. */
  async importFile(file: Blob & { name?: string }): Promise<AssetRecord> {
    return (await this.importFileDetailed(file)).record;
  }

  /**
   * Like `importFile`, and says whether these bytes were already in the library: "present" (nothing stored again) or
   * "restored" (it had been deleted from the library and is back).
   */
  async importFileDetailed(file: Blob & { name?: string }, keepDecoded = true): Promise<ImportOutcome> {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportError(`file is larger than ${MAX_IMPORT_BYTES / 2 ** 20} MiB`);
    const type = file.type || "application/octet-stream";
    const bytes = await file.arrayBuffer();
    const hash = await sha256Hex(bytes);
    const existing = await this.record(hash);
    if (existing) {
      const state = this.store ? await this.store.entryState(hash) : undefined;
      const duplicate: ImportOutcome["duplicate"] = state && state !== "active" ? "restored" : "present";
      const had = this.decoded.has(hash);
      if (keepDecoded || Math.max(existing.pixelW, existing.pixelH) <= SMALL_EDGE) await this.ensureDecoded(existing);
      this.missing.delete(hash);
      if (!had) this.onReady(); // e.g. a missing original restored: redraw what showed its placeholder
      if (this.store) await this.save(existing, false);
      return { record: existing, duplicate };
    }
    let img!: CanvasImageSource & { width: number; height: number };
    let duration: number | undefined;
    let frames: number | undefined;
    let size: { w: number; h: number } | undefined;
    // Anything the browser cannot show (a 3D model, a document, a picture or sound of a format it cannot read) is kept as it is
    // and shown as a card with its extension, name and kind (ADR 0078).
    let carded = false;
    const asCard = async (): Promise<void> => {
      carded = true;
      img = await makeFileCardFrom(file.name ?? "", describeFile(file.name ?? "", type).chip, new Uint8Array(bytes));
      size = { w: FILE_CARD_W, h: FILE_CARD_H };
      duration = undefined;
    };
    if (!isMediaType(type)) await asCard();
    else {
      try {
        if (type.startsWith("video/") || type.startsWith("audio/")) {
          try {
            const m = type.startsWith("video/") ? await decodeVideo(file) : await decodeAudio(file);
            img = m.bitmap;
            duration = m.duration;
          } catch (e) {
            // A video this browser cannot decode is still kept (for another browser or player), as a card of its own shape.
            const pr = type.startsWith("video/") ? probeMp4(new Uint8Array(bytes)) : null;
            if (!pr) {
              if (!(e instanceof BlankPictureError)) throw e;
              img = e.result.bitmap; // nothing better to show than the flat picture
              duration = e.result.duration;
            } else {
              img = await makeCard(pr.w, pr.h, pr.codec);
              duration = pr.duration;
              size = { w: pr.w, h: pr.h };
            }
          }
        } else {
          img = await decode(file);
          if (!(img.width >= 1 && img.height >= 1)) throw new Error("no pixels"); // e.g. an SVG with no size: kept as a card
        }
        if (type === "image/gif") {
          try {
            const g = new GifFrames(new Uint8Array(bytes));
            if (g.count > 1) {
              frames = g.count;
              duration = g.duration;
            }
          } catch {
            // shown as a still
          }
        }
      } catch {
        await asCard();
      }
    }
    const record: AssetRecord = {
      hash,
      type,
      size: file.size,
      name: file.name ?? "",
      pixelW: size?.w ?? img.width,
      pixelH: size?.h ?? img.height,
      blob: new Blob([bytes], { type }),
      importedAt: Date.now(),
      ...(duration !== undefined ? { duration } : {}),
      ...(frames !== undefined ? { frames } : {}),
      ...(carded ? { card: true } : {}),
    };
    if (record.pixelW < 1 || record.pixelH < 1) throw new ImportError("image has no pixels");
    if (this.store) await this.save(record, true);
    else this.memoryOnly.set(hash, record);
    if (keepDecoded || Math.max(record.pixelW, record.pixelH) <= SMALL_EDGE) this.decoded.set(hash, makeSource(img, record.pixelW));
    else (img as Partial<ImageBitmap>).close?.(); // part of a big batch: it is decoded again, reduced, when it is drawn
    this.evict();
    this.missing.delete(hash);
    this.onReady(); // redraw any placeholder of this original (a restored missing asset)
    return { record, duplicate: null };
  }

  /** Store the original (when new) and its library entry; a new one gets its thumbnail made in the background. */
  private async save(record: AssetRecord, writeBytes: boolean): Promise<void> {
    await this.store!.put(record, writeBytes);
    if (writeBytes) this.queueThumb(record);
  }

  private thumbQueue: Promise<void> = Promise.resolve();
  /** Make the new asset's thumbnail in the background, one at a time (a big import must not decode them all at once). */
  private queueThumb(record: AssetRecord): void {
    const store = this.store!;
    this.thumbQueue = this.thumbQueue
      .then(async () => {
        const t = await makeThumb(record);
        if (t) await store.putThumb(t);
      })
      .catch(() => undefined); // derived data: made again when the library is viewed
  }

  /** Decoded images held: how many, how many bytes, and the budget. */
  stats(): { count: number; bytes: number; budget: number } {
    let bytes = 0;
    for (const d of this.decoded.values()) bytes += d.bytes;
    return { count: this.decoded.size, bytes, budget: this.budget };
  }

  /** Decodes waiting for a slot and decodes running now. */
  decodeLoad(): { queued: number; running: number } {
    return { queued: this.queue.size, running: this.running };
  }

  setBudget(bytes: number): void {
    this.budget = bytes;
    this.evict();
  }

  /** Release the least recently used decoded images, not those in use, until the rest fits the budget. */
  evict(now = performance.now()): void {
    this.lastEvictCheck = now;
    let bytes = this.stats().bytes;
    if (bytes <= this.budget) return;
    const idle = [...this.decoded.entries()].filter(([, d]) => now - d.lastUsed > IN_USE_MS).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [hash, d] of idle) {
      if (bytes <= this.budget) break;
      this.decoded.delete(hash);
      d.release();
      bytes -= d.bytes;
    }
  }

  /** Put a picture under a decoded key: what a player showed when it paused, so the canvas draws exactly that. */
  setPoster(key: string, bmp: ImageBitmap): void {
    this.decoded.get(key)?.release();
    this.decoded.set(key, makeSource(bmp));
    this.evict();
    this.onReady();
  }

  /** Drop the decoded copy of an erased original (after garbage collection). */
  forget(hash: string): void {
    for (const k of [...this.decoded.keys()]) {
      if (k === hash || k.startsWith(hash + "#") || k === hash + SMALL_KEY) {
        this.decoded.get(k)?.release();
        this.decoded.delete(k);
      }
    }
    this.missing.delete(hash);
    this.locked.delete(hash);
  }

  /** Forget every missing hash so the next draw retries (the library folder came back, the hidden items were opened). */
  retryAll(): void {
    this.missing.clear();
    this.locked.clear();
    this.onReady();
  }

  /** The hidden items were locked: their decoded pictures leave memory, and draw as locked. */
  async dropLocked(): Promise<void> {
    if (!this.store) return;
    const bases = new Set([...this.decoded.keys()].map((k) => k.split("#")[0]!.replace(SMALL_KEY, "")));
    for (const h of bases) if (await this.store.locked(h)) this.forget(h);
    this.onReady();
  }

  isLocked(hash: string): boolean {
    return this.locked.has(hash);
  }

  /** Forget that a hash was missing so the next draw retries (after a restore). */
  retry(hash: string): void {
    this.missing.delete(hash);
  }

  async record(hash: string): Promise<AssetRecord | undefined> {
    return this.store ? this.store.get(hash) : this.memoryOnly.get(hash);
  }

  /** Names changed (ADR 0085): the cards drawn from them are made again, here and on the canvas. */
  renamed(hashes: readonly string[]): void {
    for (const h of hashes) this.forget(h);
    this.onReady();
  }

  /**
   * Decoded source if ready; otherwise starts loading and returns null. `shownPx` is how many CSS px the image's
   * longer side takes on screen and `edge` its longer side in source pixels: a big image shown small is served from a
   * reduced copy (made without decoding the whole image), and while the copy wanted is not ready the other one is used.
   */
  get(hash: string, shownPx = Infinity, edge = 0): RasterSource | null {
    const now = performance.now();
    const small = edge > SMALL_EDGE && shownPx <= SMALL_EDGE / 2 && !this.noReduced.has(hash);
    const full = this.decoded.get(hash);
    const reduced = this.decoded.get(hash + SMALL_KEY);
    const pick = small ? (reduced ?? full) : (full ?? reduced);
    if (pick) {
      pick.lastUsed = now;
      if (now - this.lastEvictCheck > 500) this.evict(now); // images that fell idle since the last load
    }
    const wanted = small ? reduced : full;
    if (!wanted && !this.missing.has(hash)) this.request(hash, small, now);
    return pick ?? null;
  }

  /** Whether the copy `get` should serve for this size is ready (not a stopgap or a placeholder): tiles drawn before this must be redrawn. */
  wantedReady(hash: string, shownPx = Infinity, edge = 0): boolean {
    const small = edge > SMALL_EDGE && shownPx <= SMALL_EDGE / 2 && !this.noReduced.has(hash);
    return this.decoded.has(hash + (small ? SMALL_KEY : ""));
  }

  isMissing(hash: string): boolean {
    return this.missing.has(hash);
  }

  /** `key` is the hash, or `hash#ms` for the picture of a video at a time (doc/model.ts rasterKey). */
  private async ensureDecoded(rec: AssetRecord, key = rec.hash): Promise<void> {
    if (!this.decoded.has(key)) {
      const ms = key.includes("#") ? Number(key.slice(key.indexOf("#") + 1)) : 0;
      let img: CanvasImageSource & { width: number; height: number };
      const card = async (): Promise<ImageBitmap> => makeFileCardFrom(rec.name, describeFile(rec.name, rec.type).chip, new Uint8Array(await rec.blob.arrayBuffer()));
      try {
        img = isCard(rec) ? await card() : await decode(rec.blob, ms);
      } catch (e) {
        if (!rec.type.startsWith("video/")) img = await card();
        else {
          const pr = probeMp4(new Uint8Array(await rec.blob.arrayBuffer()));
          if (!pr) {
            if (!(e instanceof BlankPictureError)) img = await card();
            else img = e.result.bitmap;
          } else img = await makeCard(pr.w, pr.h, pr.codec);
        }
      }
      if (this.decoded.has(key)) {
        (img as Partial<ImageBitmap>).close?.(); // a player put the picture it showed here meanwhile (setPoster): that one wins
        return;
      }
      this.decoded.set(key, makeSource(img, rec.pixelW));
      this.evict();
    }
  }

  /** Ask for a decode: queued, and run when one of the few decode slots is free (the most recently asked first). */
  private request(hash: string, small: boolean, now: number): void {
    const key = hash + (small ? SMALL_KEY : "");
    const q = this.queue.get(key);
    if (q) {
      q.wanted = now; // still in view: keep its place
      return;
    }
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.queue.set(key, { hash, small, wanted: now });
    this.pump();
  }

  private pump(): void {
    const now = performance.now();
    while (this.running < MAX_DECODES && this.queue.size) {
      let bestKey = "";
      let best = -Infinity;
      for (const [k, q] of this.queue) {
        if (now - q.wanted > QUEUE_STALE_MS) {
          this.queue.delete(k); // left the view while waiting: forget it (it is asked for again if it comes back)
          this.pending.delete(k);
        } else if (q.wanted > best) {
          best = q.wanted;
          bestKey = k;
        }
      }
      const q = this.queue.get(bestKey);
      if (!q) return;
      this.queue.delete(bestKey);
      this.running++;
      this.maxRunning = Math.max(this.maxRunning, this.running);
      void this.load(q.hash, q.small).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async load(hash: string, small = false): Promise<void> {
    const key = hash + (small ? SMALL_KEY : "");
    try {
      const rec = await this.record(hash.split("#")[0]!);
      if (!rec) {
        this.missing.add(hash);
        if (await this.store?.locked(hash.split("#")[0]!)) this.locked.add(hash);
      } else if (small && Math.max(rec.pixelW, rec.pixelH) > SMALL_EDGE) {
        await this.ensureReduced(rec);
      } else {
        await this.ensureDecoded(rec, hash);
      }
    } catch {
      this.missing.add(hash);
    } finally {
      this.pending.delete(key);
      this.onReady();
    }
  }

  /** The reduced copy, decoded straight from the stored bytes at the smaller size. */
  private async ensureReduced(rec: AssetRecord): Promise<void> {
    const key = rec.hash + SMALL_KEY;
    if (this.decoded.has(key)) return;
    const s = SMALL_EDGE / Math.max(rec.pixelW, rec.pixelH);
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(rec.blob, { resizeWidth: Math.max(1, Math.round(rec.pixelW * s)), resizeHeight: Math.max(1, Math.round(rec.pixelH * s)), resizeQuality: "medium" });
    } catch {
      this.noReduced.add(rec.hash); // this browser cannot decode at a size: use the full image from now on
      return this.ensureDecoded(rec);
    }
    this.decoded.set(key, makeSource(bmp, rec.pixelW));
    this.evict();
  }
}
