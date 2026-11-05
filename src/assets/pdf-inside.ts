/// <reference path="./pdf-assets.d.ts" />
// What pdf.js needs from inside the file: its worker and the decoders a scanned page asks for (JPEG 2000, JBIG2).
export { default as workerText } from "pdfjs-dist/build/pdf.worker.min.mjs";
import jbig2 from "pdfjs-dist/wasm/jbig2.wasm";
import openjpeg from "pdfjs-dist/wasm/openjpeg.wasm";
export const WASM: Readonly<Record<string, Uint8Array>> = { "openjpeg.wasm": openjpeg, "jbig2.wasm": jbig2 };
