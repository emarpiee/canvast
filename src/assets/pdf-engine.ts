import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// pdf.js, for what the app draws of a PDF: its worker and decoders are inside the file (nothing is fetched), the bytes are given to it.

/** The longer side of a page's picture on a new card, in pixels. */
export const PDF_CARD_EDGE = 1600;
/** A PDF that takes longer than this for one picture keeps its plain card (a damaged file must not hold up an import). */
const PICTURE_MS = 20_000;

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<{ m: PdfJs; factory: unknown }> | null = null;
/** The library, set up at the first PDF. */
function pdfJs(): Promise<{ m: PdfJs; factory: unknown }> {
  lib ??= Promise.all([import("pdfjs-dist"), import("./pdf-inside")]).then(([m, { workerText, WASM }]) => {
    m.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([workerText], { type: "text/javascript" })));
    class InsideFactory {
      async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
        const bytes = kind === "wasmUrl" ? WASM[filename] : undefined;
        if (!bytes) throw new Error(`no ${kind} ${filename}`); // (fonts and character maps a PDF does not carry: the system's)
        return bytes.slice();
      }
    }
    return { m, factory: InsideFactory };
  });
  return lib;
}

/** Opens a PDF. Throws on a damaged file or one with a password. */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const { m, factory } = await pdfJs();
  // (a copy: the worker takes the bytes it is given)
  return m.getDocument({ data: bytes.slice(), isEvalSupported: false, useWorkerFetch: false, BinaryDataFactory: factory, useSystemFonts: true, verbosity: 0 } as Parameters<PdfJs["getDocument"]>[0]).promise;
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
    void doc.loadingTask.destroy();
  }
}

/** Draws a page on paper filling `canvas`: all of the page, centred, whatever the canvas's shape. */
export async function drawPage(page: PDFPageProxy, canvas: HTMLCanvasElement): Promise<void> {
  const s = pageSize(page);
  const k = Math.min(canvas.width / s.w, canvas.height / s.h);
  const viewport = page.getViewport({ scale: k, offsetX: (canvas.width - s.w * k) / 2, offsetY: (canvas.height - s.h * k) / 2 });
  await page.render({ canvas, viewport, background: "white" }).promise;
}

/** The picture of a page (1 is the first; past the end, the last), at `size` or else with its longer side `edge`. Null when the file cannot be read. */
export async function pdfPicture(bytes: Uint8Array, o: { page?: number; size?: { w: number; h: number } | undefined; edge?: number | undefined }): Promise<ImageBitmap | null> {
  let doc: PDFDocumentProxy | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    doc = await openPdf(bytes);
    const page = await doc.getPage(Math.max(1, Math.min(doc.numPages, o.page ?? 1)));
    const fit = o.size ?? pageFit(pageSize(page), o.edge ?? PDF_CARD_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = fit.w;
    canvas.height = fit.h;
    await drawPage(page, canvas);
    return createImageBitmap(canvas);
  })();
  try {
    return await Promise.race([work, new Promise<null>((done) => (timer = setTimeout(() => done(null), PICTURE_MS)))]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    void work.catch(() => null).finally(() => void (doc as PDFDocumentProxy | null)?.loadingTask.destroy());
  }
}
