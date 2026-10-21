/**
 * A tile's pixels in and out of storage (ADR 0165), the same in the page and in the engine's worker: straight RGBA, deflated (exact: a
 * PNG through a canvas would premultiply and shift the colour of soft edges), named by the SHA-256 of the pixels themselves.
 */
import { TILE } from "./tiles";

export const TILE_BYTES = TILE * TILE * 4;

const pipe = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());

export const deflate = async (rgba: Uint8Array): Promise<Blob> => new Blob([(await pipe(rgba, new CompressionStream("deflate"))) as BlobPart]);

/** The pixels of a stored tile (or `len` bytes of a brush's bitmap); null when it is not that (wrong size or not deflate data). */
export async function inflate(data: Blob, len = TILE_BYTES): Promise<Uint8Array | null> {
  try {
    const out = await pipe(new Uint8Array(await data.arrayBuffer()), new DecompressionStream("deflate"));
    return out.length === len ? out : null;
  } catch {
    return null;
  }
}

export async function hashOf(rgba: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", rgba as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether a tile has no paint at all (every alpha 0): such a tile is not stored. */
export function isEmpty(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return false;
  return true;
}
