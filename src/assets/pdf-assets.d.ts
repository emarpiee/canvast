declare module "pdfjs-dist/build/pdf.worker.min.mjs" {
  const text: string;
  export default text;
}
declare module "pdfjs-dist/wasm/*.wasm" {
  const bytes: Uint8Array;
  export default bytes;
}
declare module "virtual:model-worker" {
  const text: string;
  export default text;
}
