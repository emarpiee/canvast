/**
 * Adjustments for a picture that plays (a video or a GIF; ADR 0119): a playing picture cannot be repainted pixel by pixel, so it is
 * shown through an SVG filter (and the canvas draws its paused frame through the same one, so they look alike). The filter does what
 * `adjustPixel` does to a still, in the same order: exposure, highlights and shadows, temperature and tint, contrast, saturation and
 * vibrance, sharpen, grain; blur is a CSS blur after it. The filters live in one hidden SVG in the page and are made as they are needed.
 */
import type { Adjust } from "../doc/adjust";
import { adjustKey, isNeutral } from "../doc/adjust";
import { stopsAt } from "../doc/paint";

const NS = "http://www.w3.org/2000/svg";
const MAX_FILTERS = 40;
const made = new Map<string, string>();
let host: SVGDefsElement | null = null;

const n = (v: number): string => String(Math.round(v * 10000) / 10000);

/** Samples of a curve for a transfer table: lifts the shadows and pulls down the highlights as `adjustPixel` does. */
function toneTable(shadows: number, highlights: number): string {
  const out: string[] = [];
  for (let i = 0; i <= 16; i++) {
    const v = i / 16;
    out.push(n(Math.max(0, Math.min(1, v + shadows * 0.5 * (1 - v) ** 2 - highlights * 0.5 * v ** 2))));
  }
  return out.join(" ");
}

function build(a: Adjust, id: string): string {
  const f: string[] = [];
  const e = (a.exposure ?? 0) / 100, c = (a.contrast ?? 0) / 100, t = (a.temperature ?? 0) / 100, ti = (a.tint ?? 0) / 100;
  const sh = (a.shadows ?? 0) / 100, hi = (a.highlights ?? 0) / 100;
  const transfer = (attrs: (ch: string) => string): string => ["R", "G", "B"].map((ch) => `<feFunc${ch} ${attrs(ch)}/>`).join("");
  if (e) f.push(`<feComponentTransfer>${transfer(() => `type="linear" slope="${n(2 ** (e * 1.5))}"`)}</feComponentTransfer>`);
  if (sh || hi) f.push(`<feComponentTransfer>${transfer(() => `type="table" tableValues="${toneTable(sh, hi)}"`)}</feComponentTransfer>`);
  if (t || ti) {
    const r = 1 + 0.25 * t + 0.06 * ti, g = 1 - 0.18 * ti, b = 1 - 0.25 * t + 0.06 * ti;
    f.push(`<feColorMatrix type="matrix" values="${n(r)} 0 0 0 0  0 ${n(g)} 0 0 0  0 0 ${n(b)} 0 0  0 0 0 1 0"/>`);
  }
  if (c) f.push(`<feComponentTransfer>${transfer(() => `type="linear" slope="${n(1 + c)}" intercept="${n(0.5 - 0.5 * (1 + c))}"`)}</feComponentTransfer>`);
  if (a.saturation || a.vibrance) f.push(`<feColorMatrix type="saturate" values="${n(Math.max(0, 1 + (a.saturation ?? 0) / 100 + ((a.vibrance ?? 0) / 100) * 0.5))}"/>`);
  if (a.map) {
    // the gradient map: brightness, looked up in a table of the gradient, mixed back with the picture by the amount
    const k = a.map.amount / 100;
    const at = (t: number): readonly number[] => stopsAt(a.map!.stops, t);
    const table = (ch: 0 | 1 | 2): string => Array.from({ length: 33 }, (_, i) => n(at(i / 32)[ch]! / 255)).join(" ");
    f.push(
      `<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="pre-${id}"/>` +
        `<feColorMatrix in="pre-${id}" type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0"/>` +
        `<feComponentTransfer result="map-${id}"><feFuncR type="table" tableValues="${table(0)}"/><feFuncG type="table" tableValues="${table(1)}"/><feFuncB type="table" tableValues="${table(2)}"/></feComponentTransfer>` +
        `<feComposite in="map-${id}" in2="pre-${id}" operator="arithmetic" k1="0" k2="${n(k)}" k3="${n(1 - k)}" k4="0"/>`,
    );
  }
  if (a.sharpen) {
    const k = (a.sharpen / 100) * 1.5 * 0.25 * 4; // the unsharp mask of the stills: the pixel plus `amount` times its difference from its four neighbours
    const m = k / 4;
    f.push(`<feConvolveMatrix order="3" kernelMatrix="0 ${n(-m)} 0 ${n(-m)} ${n(1 + k)} ${n(-m)} 0 ${n(-m)} 0" preserveAlpha="true" edgeMode="duplicate"/>`);
  }
  if (a.grain) {
    const amt = (a.grain / 100) * 0.24;
    f.push(
      `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3" result="n-${id}"/>` +
        `<feColorMatrix in="n-${id}" type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" result="g-${id}"/>` +
        `<feComposite in="SourceGraphic" in2="g-${id}" operator="arithmetic" k1="0" k2="1" k3="${n(amt)}" k4="${n(-amt / 2)}"/>`,
    );
  }
  return `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">${f.join("")}</filter>`;
}

/** The CSS `filter` for these adjustments: "" when there are none. */
export function playingFilter(a: Adjust | undefined): string {
  if (isNeutral(a) || !a) return "";
  const key = adjustKey(a);
  let id = made.get(key);
  const needsSvg = !!(a.exposure || a.contrast || a.highlights || a.shadows || a.temperature || a.tint || a.saturation || a.vibrance || a.sharpen || a.grain || a.map);
  if (needsSvg && !id) {
    if (!host) {
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.setAttribute("aria-hidden", "true");
      svg.style.position = "absolute";
      host = document.createElementNS(NS, "defs");
      svg.appendChild(host);
      document.body.appendChild(svg);
    }
    id = `adj-${made.size}-${Math.abs([...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7))}`;
    if (made.size >= MAX_FILTERS) {
      const [oldKey, oldId] = made.entries().next().value as [string, string];
      host.querySelector(`#${oldId}`)?.remove();
      made.delete(oldKey);
    }
    host.insertAdjacentHTML("beforeend", build(a, id));
    made.set(key, id);
  }
  return [needsSvg && id ? `url(#${id})` : "", a.blur ? `blur(${((a.blur / 100) * 8).toFixed(2)}px)` : ""].filter(Boolean).join(" ");
}
