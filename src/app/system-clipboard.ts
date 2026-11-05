/**
 * The one way canvast puts something on the system clipboard (the library's Copy, a copy on the canvas, a screenshot, the Export dialog's Copy).
 * A picture goes as a PNG (the one picture type every program takes), with its SVG beside it when it is vectors, for the programs that can keep them;
 * no text: a program that is offered a picture and text beside it often takes the text, so the picture would not paste. Text goes with a picture only when the caller says the text is the point too (copied texts), and is the
 * fallback when the picture cannot be written. Best effort: the browser may refuse; the result says what landed.
 */
import { desktopBridge } from "../storage/desktop-bridge";

export type ClipboardResult = "image" | "text" | "failed";

export interface ClipboardParts {
  /** The picture as a PNG (or a promise of it: it is awaited before writing, see below). */
  readonly image?: Blob | Promise<Blob>;
  readonly text?: string;
  /** Put the text beside the picture too (copied texts, where a text field should get the words). */
  readonly withText?: boolean;
  /** The same picture as vectors, where the browser can put them there (a browser that cannot gives the PNG). */
  readonly svg?: string;
  /** What the SVG is called, as a file. */
  readonly name?: string;
}

/** Past this an SVG stays off the clipboard: most of it would be embedded images. */
export const MAX_COPIED_SVG = 1_000_000;
const SVG_TYPE = "image/svg+xml";

export async function writeSystemClipboard(p: ClipboardParts): Promise<ClipboardResult> {
  if (p.image && typeof ClipboardItem !== "undefined") {
    try {
      // The picture is made first and written as a plain Blob: Firefox refuses a ClipboardItem that holds a promise (NotAllowedError), Chromium takes either.
      const image = await p.image;
      // In the desktop app the SVG is a real file too: a program that takes files gets it as a file, one that takes pictures its SVG or PNG.
      const bridge = desktopBridge();
      if (bridge && p.svg && p.svg.length <= MAX_COPIED_SVG) {
        const file = p.name || "vector";
        const done = await bridge
          .copyFiles([], [{ name: /\.svg$/i.test(file) ? file : `${file}.svg`, bytes: new TextEncoder().encode(p.svg) }], { svg: p.svg, png: new Uint8Array(await image.arrayBuffer()) })
          .catch(() => 0);
        if (done) return "image";
      }
      const parts = { "image/png": image, ...(p.withText && p.text ? { "text/plain": new Blob([p.text], { type: "text/plain" }) } : {}) };
      const svg = p.svg && p.svg.length <= MAX_COPIED_SVG && ClipboardItem.supports?.(SVG_TYPE) ? new Blob([p.svg], { type: SVG_TYPE }) : null;
      // (refused with its SVG, the picture still goes)
      if (svg) await navigator.clipboard.write([new ClipboardItem({ [SVG_TYPE]: svg, ...parts })]).catch(() => navigator.clipboard.write([new ClipboardItem(parts)]));
      else await navigator.clipboard.write([new ClipboardItem(parts)]);
      return "image";
    } catch {
      // the picture could not be made or written: the text, if there is any, is the next best thing
    }
  }
  if (p.text && (await copyPlainText(p.text))) return "text";
  return "failed";
}

/** Words on the system clipboard, by the older way when the browser refuses the newer: whether it worked. */
export async function copyPlainText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.append(t);
    t.select();
    const done = document.execCommand("copy");
    t.remove();
    return done;
  }
}

/** One picture on the clipboard as two types is one file: its vectors, when there are both. */
export const onePerPicture = (files: readonly File[]): File[] => {
  const svg = files.filter((f) => f.type === SVG_TYPE);
  return svg.length === 1 && files.length === 2 && files.every((f) => f.type.startsWith("image/")) ? svg : [...files];
};

/** The pictures on the system clipboard, each with the words beside it; none when the browser does not let them be read. `vectors`: an SVG rather than the PNG beside it. */
export async function readClipboardPictures(vectors = false): Promise<Array<{ blob: Blob; type: string; text: string }>> {
  const out: Array<{ blob: Blob; type: string; text: string }> = [];
  for (const item of await navigator.clipboard.read()) {
    const pictures = item.types.filter((t) => t.startsWith("image/"));
    const type = pictures.find((t) => (t === SVG_TYPE) === vectors) ?? pictures[0];
    if (!type) continue;
    out.push({ blob: await item.getType(type), type, text: item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : "" });
  }
  return out;
}

/** A picture of any type the browser can show as a PNG (the clipboard takes no other picture type). */
export async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    // (a vector with no size of its own: at a size that can be seen, not one pixel)
    c.width = img.naturalWidth || 1024;
    c.height = img.naturalHeight || (img.naturalWidth ? 1 : 1024);
    c.getContext("2d")!.drawImage(img, 0, 0);
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no picture"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
