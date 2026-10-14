import type { RasterSource } from "../render/draw-objects";
import { sha256Hex } from "./sha256";
import { done, idbGet, req } from "../storage/idb";
import type { CatalogEntry } from "./asset-catalog";
import { entryFromRecord } from "./asset-catalog";

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
}

/** Largest accepted import, to fail fast instead of exhausting memory. */
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;

export class ImportError extends Error {}

interface Decoded extends RasterSource {
  readonly pixelW: number;
  readonly pixelH: number;
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
/** An image asked for within this many ms is in use and is never released. */
const IN_USE_MS = 1500;

async function decode(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
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

function makeSource(img: CanvasImageSource & { width: number; height: number }): Decoded {
  let scratch: HTMLCanvasElement | null = null;
  let lastKey = "";
  let lastData = new Uint8ClampedArray(0);
  return {
    source: img,
    pixelW: img.width,
    pixelH: img.height,
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
  private readonly memoryOnly = new Map<string, AssetRecord>();
  private budget = DEFAULT_DECODED_BUDGET;
  private lastEvictCheck = 0;

  constructor(
    private readonly db: IDBDatabase | null,
    private readonly onReady: () => void,
  ) {}

  /** Import a file: hash, decode (validates it is an image), store once. */
  async importFile(file: Blob & { name?: string }): Promise<AssetRecord> {
    if (!file.type.startsWith("image/")) throw new ImportError(`unsupported file type "${file.type || "unknown"}"`);
    if (file.size > MAX_IMPORT_BYTES) throw new ImportError(`file is larger than ${MAX_IMPORT_BYTES / 2 ** 20} MiB`);
    const bytes = await file.arrayBuffer();
    const hash = await sha256Hex(bytes);
    const existing = await this.record(hash);
    if (existing) {
      const had = this.decoded.has(hash);
      await this.ensureDecoded(existing);
      this.missing.delete(hash);
      if (!had) this.onReady(); // e.g. a missing original restored: redraw what showed its placeholder
      if (this.db) await this.store(existing, false);
      return existing;
    }
    let img;
    try {
      img = await decode(file);
    } catch {
      throw new ImportError("the file could not be decoded as an image");
    }
    const record: AssetRecord = {
      hash,
      type: file.type,
      size: file.size,
      name: file.name ?? "",
      pixelW: img.width,
      pixelH: img.height,
      blob: new Blob([bytes], { type: file.type }),
      importedAt: Date.now(),
    };
    if (record.pixelW < 1 || record.pixelH < 1) throw new ImportError("image has no pixels");
    if (this.db) await this.store(record, true);
    else this.memoryOnly.set(hash, record);
    this.decoded.set(hash, makeSource(img));
    this.evict();
    this.missing.delete(hash);
    this.onReady(); // redraw any placeholder of this original (a restored missing asset)
    return record;
  }

  /**
   * Write the original (when new) and its catalog entry in one transaction.
   * Importing bytes that are already stored adds no copy; it only returns a
   * deleted or absent catalog entry to the library.
   */
  private async store(record: AssetRecord, writeBytes: boolean): Promise<void> {
    const tx = this.db!.transaction(["assets", "assetCatalog"], "readwrite", { durability: "strict" });
    const committed = done(tx);
    if (writeBytes) tx.objectStore("assets").put(record, record.hash);
    const e = await req(tx.objectStore("assetCatalog").get(record.hash) as IDBRequest<CatalogEntry | undefined>);
    if (!e) tx.objectStore("assetCatalog").put(entryFromRecord(record));
    else if (e.state !== "active") tx.objectStore("assetCatalog").put({ ...e, state: "active", deletedAt: null } satisfies CatalogEntry);
    await committed;
  }

  /** Decoded images held: how many, how many bytes, and the budget. */
  stats(): { count: number; bytes: number; budget: number } {
    let bytes = 0;
    for (const d of this.decoded.values()) bytes += d.bytes;
    return { count: this.decoded.size, bytes, budget: this.budget };
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

  /** Drop the decoded copy of an erased original (after garbage collection). */
  forget(hash: string): void {
    this.decoded.get(hash)?.release();
    this.decoded.delete(hash);
    this.missing.delete(hash);
  }

  /** Forget that a hash was missing so the next draw retries (after a restore). */
  retry(hash: string): void {
    this.missing.delete(hash);
  }

  async record(hash: string): Promise<AssetRecord | undefined> {
    if (this.db) return idbGet<AssetRecord>(this.db, "assets", hash);
    return this.memoryOnly.get(hash);
  }

  /** Decoded source if ready; otherwise starts loading and returns null. */
  get(hash: string): RasterSource | null {
    const d = this.decoded.get(hash);
    if (d) {
      const now = performance.now();
      d.lastUsed = now;
      if (now - this.lastEvictCheck > 500) this.evict(now); // images that fell idle since the last load
      return d;
    }
    if (!this.pending.has(hash) && !this.missing.has(hash)) void this.load(hash);
    return null;
  }

  isMissing(hash: string): boolean {
    return this.missing.has(hash);
  }

  private async ensureDecoded(rec: AssetRecord): Promise<void> {
    if (!this.decoded.has(rec.hash)) {
      this.decoded.set(rec.hash, makeSource(await decode(rec.blob)));
      this.evict();
    }
  }

  private async load(hash: string): Promise<void> {
    this.pending.add(hash);
    try {
      const rec = await this.record(hash);
      if (!rec) {
        this.missing.add(hash);
      } else {
        await this.ensureDecoded(rec);
      }
    } catch {
      this.missing.add(hash);
    } finally {
      this.pending.delete(hash);
      this.onReady();
    }
  }
}
