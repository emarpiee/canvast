import type { RasterSource } from "../render/draw-objects";
import { sha256Hex } from "./sha256";
import { idbGet, idbPut } from "../storage/idb";

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
}

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
      await this.ensureDecoded(existing);
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
    if (this.db) await idbPut(this.db, "assets", hash, record);
    else this.memoryOnly.set(hash, record);
    this.decoded.set(hash, makeSource(img));
    return record;
  }

  async record(hash: string): Promise<AssetRecord | undefined> {
    if (this.db) return idbGet<AssetRecord>(this.db, "assets", hash);
    return this.memoryOnly.get(hash);
  }

  /** Decoded source if ready; otherwise starts loading and returns null. */
  get(hash: string): RasterSource | null {
    const d = this.decoded.get(hash);
    if (d) return d;
    if (!this.pending.has(hash) && !this.missing.has(hash)) void this.load(hash);
    return null;
  }

  isMissing(hash: string): boolean {
    return this.missing.has(hash);
  }

  private async ensureDecoded(rec: AssetRecord): Promise<void> {
    if (!this.decoded.has(rec.hash)) this.decoded.set(rec.hash, makeSource(await decode(rec.blob)));
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
