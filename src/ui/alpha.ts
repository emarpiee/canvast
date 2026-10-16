/**
 * Whether a picture has see-through pixels (so it can be shown on a chequered ground that tells it apart from a plain background).
 * The picture is drawn small and its alpha is read: anything under fully opaque counts, so a small transparent corner still shows
 * after the shrinking. An image that cannot be read (not loaded yet, cross-origin) is taken as opaque.
 */
const SIDE = 32;
let probe: CanvasRenderingContext2D | null | undefined;

export function hasAlpha(img: HTMLImageElement): boolean {
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) return false;
  if (probe === undefined) {
    const c = document.createElement("canvas");
    c.width = c.height = SIDE;
    probe = c.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return false;
  try {
    probe.clearRect(0, 0, SIDE, SIDE);
    probe.drawImage(img, 0, 0, SIDE, SIDE);
    const d = probe.getImageData(0, 0, SIDE, SIDE).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]! < 250) return true;
  } catch {
    // unreadable: shown as opaque
  }
  return false;
}
