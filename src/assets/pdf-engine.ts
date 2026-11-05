import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// pdf.js, for what the app draws of a PDF: its worker and decoders are inside the file (nothing is fetched), the bytes are given to it.

/** The longer side of a page's picture on a new card, in pixels. */
export const PDF_CARD_EDGE = 1600;
/** A PDF that takes longer than this for one picture keeps its plain card (a damaged file must not hold up an import). */
const PICTURE_MS = 20_000;


type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<{ m: PdfJs; factory: unknown; workerUrl: string }> | null = null;
/** The library, set up at the first PDF. */
function pdfJs(): Promise<{ m: PdfJs; factory: unknown; workerUrl: string }> {
  lib ??= Promise.all([import("pdfjs-dist"), import("./pdf-inside")]).then(([m, { workerText, WASM }]) => {
    class InsideFactory {
      async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
        const bytes = kind === "wasmUrl" ? WASM[filename] : undefined;
        if (!bytes) throw new Error(`no ${kind} ${filename}`); // (fonts and character maps a PDF does not carry: the system's)
        return bytes.slice();
      }
    }
    return { m, factory: InsideFactory, workerUrl: URL.createObjectURL(new Blob([workerText], { type: "text/javascript" })) };
  });
  return lib;
}

/** Whether an error is a PDF asking for its password (or refusing the one given). */
export const needsPassword = (e: unknown): boolean => (e as { name?: string } | null)?.name === "PasswordException";

/** How each open PDF is closed. */
const closers = new WeakMap<PDFDocumentProxy, () => void>();
/** Closes a PDF: its worker goes with it, so nothing stays running or held. */
export const closePdf = (doc: PDFDocumentProxy): void => closers.get(doc)?.();

/**
 * Opens a PDF. Throws on a damaged file or one whose password is not given (`needsPassword`). Each has a worker of its own: one shared by several dies with the
 * first of them closed, and one being closed refuses the next.
 */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const { m, factory, workerUrl } = await pdfJs();
  const port = new Worker(workerUrl);
  const worker = new m.PDFWorker({ port } as unknown as ConstructorParameters<PdfJs["PDFWorker"]>[0]);
  const stop = (): void => {
    worker.destroy();
    port.terminate();
  };
  // (a copy: the worker takes the bytes it is given)
  const task = m.getDocument({ data: bytes.slice(), worker, ...(password === undefined ? {} : { password }), isEvalSupported: false, useWorkerFetch: false, BinaryDataFactory: factory, useSystemFonts: true, verbosity: 0 } as Parameters<PdfJs["getDocument"]>[0]);
  try {
    const doc = await task.promise;
    closers.set(doc, () => void task.destroy().finally(stop));
    return doc;
  } catch (e) {
    void task.destroy().finally(stop);
    throw e;
  }
}

/** The PDF's text layer maker, for selecting its words. */
export const pdfTextLayer = async (): Promise<PdfJs["TextLayer"]> => (await pdfJs()).m.TextLayer;

/** A page's size at a scale that makes its longer side `edge`. */
export function pageFit(page: { w: number; h: number }, edge: number): { w: number; h: number } {
  const k = edge / Math.max(page.w, page.h);
  return { w: Math.max(1, Math.round(page.w * k)), h: Math.max(1, Math.round(page.h * k)) };
}

/** A page's size at scale 1, turned as it is shown. */
export function pageSize(page: PDFPageProxy): { w: number; h: number } {
  const v = page.getViewport({ scale: 1 });
  return { w: v.width, h: v.height };
}

/** The shape of a PDF's first page as a card's pixels, null when the file cannot be read. */
export async function pdfCardShape(bytes: Uint8Array): Promise<{ w: number; h: number } | null> {
  const doc = await openPdf(bytes).catch(() => null);
  if (!doc) return null;
  try {
    return pageFit(pageSize(await doc.getPage(1)), PDF_CARD_EDGE);
  } catch {
    return null;
  } finally {
    closePdf(doc);
  }
}

/** A page's words on one line. */
export async function pageWords(page: PDFPageProxy): Promise<string> {
  const { items } = await page.getTextContent();
  return items.map((i) => ("str" in i ? `${i.str}${i.hasEOL ? " " : ""}` : "")).join("");
}

/** The most pages read for the library's search, and the largest file: past them it is found by its name. */
const MAX_WORD_PAGES = 2000;
export const MAX_WORDS_BYTES = 128 * 2 ** 20;
/** All of a PDF's words, for the library's search; "" when it cannot be read. */
export async function pdfWords(bytes: Uint8Array): Promise<string> {
  const doc = await openPdf(bytes).catch(() => null);
  if (!doc) return "";
  try {
    const out: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_WORD_PAGES); n++) out.push(await pageWords(await doc.getPage(n)));
    return out.join(" ");
  } catch {
    return "";
  } finally {
    closePdf(doc);
  }
}

/** Draws a page on paper filling `canvas`: all of the page, centred, whatever the canvas's shape. */
export async function drawPage(page: PDFPageProxy, canvas: HTMLCanvasElement): Promise<void> {
  const s = pageSize(page);
  const k = Math.min(canvas.width / s.w, canvas.height / s.h);
  const viewport = page.getViewport({ scale: k, offsetX: (canvas.width - s.w * k) / 2, offsetY: (canvas.height - s.h * k) / 2 });
  await page.render({ canvas, viewport, background: "white" }).promise;
}

/** The last file drawn stays open a little: a card's pages and sizes come in a row, and opening a PDF is the slow part. */
const KEEP_OPEN_MS = 10_000;
let open: { hash: string; doc: PDFDocumentProxy; timer: ReturnType<typeof setTimeout> } | null = null;
const closeOpen = (): void => {
  if (!open) return;
  clearTimeout(open.timer);
  closePdf(open.doc);
  open = null;
};
/** Pictures are drawn one at a time: pages of many cards at once would take every core. */
let queue: Promise<unknown> = Promise.resolve();

/** The picture of a page (1 is the first; past the end, the last), at `size` or else with its longer side `edge`. Null when the file cannot be read. */
export function pdfPicture(read: () => Promise<Uint8Array>, o: { hash?: string | undefined; page?: number; size?: { w: number; h: number } | undefined; edge?: number | undefined }): Promise<ImageBitmap | null> {
  const run = async (): Promise<ImageBitmap | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      if (!o.hash || open?.hash !== o.hash) {
        closeOpen();
        const doc = await openPdf(await read());
        open = { hash: o.hash ?? "", doc, timer: setTimeout(() => undefined, 0) };
      }
      clearTimeout(open!.timer);
      open!.timer = setTimeout(closeOpen, KEEP_OPEN_MS);
      const { doc } = open!;
      const page = await doc.getPage(Math.max(1, Math.min(doc.numPages, o.page ?? 1)));
      const fit = o.size ?? pageFit(pageSize(page), o.edge ?? PDF_CARD_EDGE);
      const canvas = document.createElement("canvas");
      canvas.width = fit.w;
      canvas.height = fit.h;
      await drawPage(page, canvas);
      page.cleanup();
      return createImageBitmap(canvas);
    })();
    try {
      return await Promise.race([work, new Promise<null>((done) => (timer = setTimeout(() => done(null), PICTURE_MS)))]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const done = queue.then(run, run);
  queue = done.catch(() => null);
  return done;
}
