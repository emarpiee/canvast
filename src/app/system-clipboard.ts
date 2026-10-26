/**
 * The one way canvast puts something on the system clipboard (the library's Copy, a copy on the canvas, a screenshot, the Export dialog's Copy).
 * A picture goes alone, as a PNG (the one picture type every program takes): a program that is offered a picture and text beside it often takes
 * the text, so the picture would not paste. Text goes with a picture only when the caller says the text is the point too (copied texts), and is the
 * fallback when the picture cannot be written. Best effort: the browser may refuse; the result says what landed.
 */
export type ClipboardResult = "image" | "text" | "failed";

export interface ClipboardParts {
  /** The picture as a PNG (or a promise of it: the browser starts writing at once and waits for it). */
  readonly image?: Blob | Promise<Blob>;
  readonly text?: string;
  /** Put the text beside the picture too (copied texts, where a text field should get the words). */
  readonly withText?: boolean;
}

export async function writeSystemClipboard(p: ClipboardParts): Promise<ClipboardResult> {
  if (p.image && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": p.image, ...(p.withText && p.text ? { "text/plain": new Blob([p.text], { type: "text/plain" }) } : {}) })]);
      return "image";
    } catch {
      // the picture could not be made or written: the text, if there is any, is the next best thing
    }
  }
  if (p.text) {
    try {
      await navigator.clipboard.writeText(p.text);
      return "text";
    } catch {
      // refused: nothing was put there
    }
  }
  return "failed";
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
    c.width = img.naturalWidth || 1;
    c.height = img.naturalHeight || 1;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no picture"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
