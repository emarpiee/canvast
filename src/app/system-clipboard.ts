/**
 * The one way canvast puts something on the system clipboard (the library's Copy, a copy on the canvas, a screenshot, the Export dialog's Copy).
 * A picture goes as a PNG (the one picture type every program takes), with its SVG beside it when it is vectors, for the programs that can keep them;
 * no text: a program that is offered a picture and text beside it often takes the text, so the picture would not paste. Text goes with a picture only when the caller says the text is the point too (copied texts), and is the
 * fallback when the picture cannot be written. Best effort: the browser may refuse; the result says what landed.
 */
import { plural } from "../doc/plural";
import { desktopBridge } from "../storage/desktop-bridge";

export type ClipboardResult = "image" | "files" | "text" | "failed";

/** Real files, as the desktop app's `copyFiles` takes them: its workspace's, and readable copies. */
export interface ClipboardFiles {
  readonly files: readonly string[];
  readonly copies: ReadonlyArray<{ name: string; bytes: Uint8Array | string }>;
}

export interface ClipboardParts {
  /** The picture as a PNG (or a promise of it: it is awaited before writing, see below). */
  readonly image?: Blob | Promise<Blob>;
  readonly text?: string;
  /** Put the text beside the picture too (copied texts, where a text field should get the words). */
  readonly withText?: boolean;
  /** The same picture as vectors, where the browser can put them there (a browser that cannot gives the PNG). */
  readonly svg?: string;
  /** In the desktop app: the SVG as a file of this name too. */
  readonly svgFile?: string;
  /** In the desktop app: real files too. A browser cannot put a file on the clipboard. */
  readonly files?: ClipboardFiles;
  /** It holds hidden items: it leaves the clipboard again, after the time Settings > Privacy gives. */
  readonly hidden?: boolean;
}

/** Past this an SVG stays off the clipboard: most of it would be embedded images. */
export const MAX_COPIED_SVG = 1_000_000;
const SVG_TYPE = "image/svg+xml";

/** An SVG as a readable copy for `copyFiles`, by this name. */
export const svgCopy = (name: string, svg: string): { name: string; bytes: Uint8Array } => ({ name: /\.svg$/i.test(name) ? name : `${name}.svg`, bytes: new TextEncoder().encode(svg) });

/** How long a copied hidden item stays (Settings > Privacy; 0: it stays), and how to say what became of it. */
let hiddenSeconds = 30;
let sayHidden: (text: string) => void = () => undefined;
export const setHiddenCopySeconds = (seconds: number): void => void (hiddenSeconds = seconds);
export const onHiddenCopyNotice = (say: (text: string) => void): void => void (sayHidden = say);
let hiddenTimer: ReturnType<typeof setTimeout> | undefined;

/** A browser's clipboard can be read only with the focus, and is cleared the same way: if it still holds what was written. */
async function clearInBrowser(text: string | undefined, size: number | undefined): Promise<boolean> {
  if (!document.hasFocus()) return false;
  const [item] = await navigator.clipboard.read();
  const png = item?.types.includes("image/png") ? await item.getType("image/png") : null;
  const words = item?.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : null;
  if ((png ? png.size !== size : size !== undefined) || (!png && words !== text)) return false;
  await navigator.clipboard.writeText("");
  return true;
}

/** Copy, and when it holds hidden items, start their time. */
export async function writeSystemClipboard(p: ClipboardParts): Promise<ClipboardResult> {
  const done = await writeNow(p);
  if (!p.hidden || done === "failed") return done;
  clearTimeout(hiddenTimer);
  const seconds = hiddenSeconds;
  if (seconds <= 0) return done;
  const size = desktopBridge() || !p.image ? undefined : (await Promise.resolve(p.image).catch(() => undefined))?.size;
  // (after the message of the copy itself)
  setTimeout(() => sayHidden(`Copied. It leaves the clipboard in ${plural(seconds, "second")}.`), 50);
  hiddenTimer = setTimeout(() => {
    const bridge = desktopBridge();
    void (bridge ? bridge.forgetHiddenCopy() : clearInBrowser(p.text, size)).then((gone) => gone && sayHidden("The copied hidden item left the clipboard."), () => undefined);
  }, seconds * 1000);
  return done;
}

async function writeNow(p: ClipboardParts): Promise<ClipboardResult> {
  const bridge = desktopBridge();
  const svgNow = p.svg && p.svg.length <= MAX_COPIED_SVG ? p.svg : undefined;
  const own = svgNow && p.svgFile ? [svgCopy(p.svgFile, svgNow)] : [];
  const copies = [...(p.files?.copies ?? []), ...own], files = p.files?.files ?? [];
  if (bridge && (files.length + copies.length > 0 || p.image)) {
    // Every way a program may want it: one that takes files gets the files, one that takes pictures or words those. (The words go beside a picture only as below.)
    // Through the app itself: the page may no longer have the focus when a picture is ready, and a page without it is refused.
    const image = await Promise.resolve(p.image).catch(() => undefined);
    const also = { ...(svgNow ? { svg: svgNow } : {}), ...(image ? { png: new Uint8Array(await image.arrayBuffer()) } : {}), ...(p.text && (!image || p.withText) ? { text: p.text } : {}), ...(p.hidden ? { hidden: true } : {}) };
    if (await bridge.copyFiles(files, copies, also).catch(() => 0)) return image ? "image" : "files";
  }
  if (p.image && typeof ClipboardItem !== "undefined") {
    try {
      // The picture is made first and written as a plain Blob: Firefox refuses a ClipboardItem that holds a promise (NotAllowedError), Chromium takes either.
      const image = await p.image;
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

/** The mark of the hidden field the older way copies from: its copy event is not a copy by the user (it keeps what this window copied as its own). */
export const COPY_FIELD = "canvastCopy";
/** Whether a copy or cut event is the older way's own writing (see COPY_FIELD). */
export const isOwnWriting = (e: Event): boolean => (e.target as HTMLElement | null)?.dataset?.[COPY_FIELD] !== undefined;

/** Words on the system clipboard, by the older way when the browser refuses the newer: whether it worked. */
export async function copyPlainText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // (its copy event is our own writing, not a new copy: see COPY_FIELD; the focus goes back where it was, so the canvas keeps the keys and a paste)
    const was = document.activeElement as HTMLElement | null;
    const t = document.createElement("textarea");
    t.value = text;
    t.dataset[COPY_FIELD] = "";
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.append(t);
    t.select();
    const done = document.execCommand("copy");
    t.remove();
    was?.focus?.({ preventScroll: true });
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
