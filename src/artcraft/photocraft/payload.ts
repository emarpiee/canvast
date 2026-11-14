/**
 * PhotoCraft's released web build, as the build put it in this file (scripts/artcraft/photocraft/package.mjs): an inert JSON block, read the first
 * time PhotoCraft opens. Its WebAssembly is the release's gzip, unpacked here by the browser.
 */
export interface PhotoCraftPayload {
  version: string;
  /** Its page's own style and body (its canvas, its loading and stopped messages). */
  style: string;
  body: string;
  /** Its wasm-bindgen code as one inline module that sets `globalThis.__photocraftInit`. */
  glue: string;
  /** The gzip of its WebAssembly, in base64. */
  wasm: string;
}

let cached: PhotoCraftPayload | null | undefined;

/** The build's PhotoCraft, or null when this build has none (CANVAST_PHOTOCRAFT=off). */
export function photoCraftPayload(): PhotoCraftPayload | null {
  if (cached !== undefined) return cached;
  const el = typeof document === "undefined" ? null : document.getElementById("photocraft-data");
  try {
    cached = el?.textContent ? (JSON.parse(el.textContent) as PhotoCraftPayload) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** The PhotoCraft version in this build ("" without one), for Settings. */
export const photoCraftVersion = (): string => photoCraftPayload()?.version ?? "";

/** Its WebAssembly, unpacked (about 40 MB), made in `realm` (the frame it runs in: its WebAssembly takes only its own arrays). */
export async function photoCraftWasm(p: PhotoCraftPayload, realm: typeof globalThis = globalThis): Promise<Uint8Array> {
  const bin = realm.atob(p.wasm);
  const gz = new realm.Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const stream = new realm.Blob([gz]).stream().pipeThrough(new realm.DecompressionStream("gzip"));
  return new realm.Uint8Array(await new realm.Response(stream).arrayBuffer());
}
