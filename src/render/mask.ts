/**
 * Drawing an object through a mask (ADR 0144). The object is drawn on a scratch layer, the mask on another; what the mask lets through
 * is kept: by its opacity (`alpha`), or by its brightness (`luminance`, the mask drawn on black and turned into opacity by an SVG filter,
 * so a soft edge is a soft edge), or the opposite (`invert`). The result is put on the canvas as one picture. Blend modes of a masked object
 * apply inside its layer (there is no backdrop there). Each layer is as big as the canvas it serves and is kept for the next frame.
 */
const NS = "http://www.w3.org/2000/svg";
const LUMA = "canvast-luma";
let host: SVGSVGElement | null = null;
const layers: HTMLCanvasElement[] = [];

function lumaFilter(): string {
  if (!host || !host.isConnected) {
    host = document.createElementNS(NS, "svg");
    host.setAttribute("width", "0");
    host.setAttribute("height", "0");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "absolute";
    host.innerHTML = `<defs><filter id="${LUMA}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.2126 0.7152 0.0722 0 0"/></filter></defs>`;
    document.body.appendChild(host);
  }
  return `url(#${LUMA})`;
}

function layer(i: number, w: number, h: number): CanvasRenderingContext2D {
  const c = (layers[i] ??= document.createElement("canvas"));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.filter = "none";
  g.clearRect(0, 0, w, h);
  return g;
}

export function drawMasked(ctx: CanvasRenderingContext2D, body: (c: CanvasRenderingContext2D) => void, mask: (c: CanvasRenderingContext2D) => void, mode: "alpha" | "luminance", invert: boolean): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const t = ctx.getTransform();
  const a = layer(0, w, h);
  a.setTransform(t);
  body(a);
  const m = layer(1, w, h);
  if (mode === "luminance") {
    m.fillStyle = "#000000";
    m.fillRect(0, 0, w, h);
  }
  m.setTransform(t);
  mask(m);
  m.setTransform(1, 0, 0, 1, 0, 0);
  let cut = m.canvas;
  if (mode === "luminance") {
    const l = layer(2, w, h);
    l.filter = lumaFilter();
    l.drawImage(m.canvas, 0, 0);
    l.filter = "none";
    cut = l.canvas;
  }
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalCompositeOperation = invert ? "destination-out" : "destination-in";
  a.drawImage(cut, 0, 0);
  a.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(a.canvas, 0, 0);
  ctx.restore();
}
