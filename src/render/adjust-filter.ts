/**
 * Adjustments for a picture that plays (a video or a GIF; ADR 0119): a playing picture cannot be repainted pixel by pixel, so it is
 * shown through an SVG filter (and the canvas draws its paused frame through the same one, so they look alike). The filter does what
 * `adjustPixel` does to a still, in the same order: exposure, highlights and shadows, temperature and tint, contrast, saturation and
 * vibrance, sharpen, grain; blur is a CSS blur after it. The filters live in one hidden SVG in the page and are made as they are needed.
 */
import type { Adjust } from "../doc/adjust";
import { adjustKey, curveFn, isNeutral, layersOf } from "../doc/adjust";
import type { CurvePoints, Levels } from "../doc/adjust";
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

/** The 33 samples of levels then curves for one channel, for a transfer table (null: nothing to do). */
function channelTable(levels: Array<Levels | undefined>, curves: Array<CurvePoints | undefined>): string | null {
  const ls = levels.filter((l) => l && ((l.black ?? 0) || (l.white ?? 255) !== 255 || (l.gamma ?? 1) !== 1));
  const cs = curves.filter((c) => c && c.some(([x, y]) => x !== y)).map((c) => curveFn(c!));
  if (!ls.length && !cs.length) return null;
  return Array.from({ length: 33 }, (_, i) => {
    let v = i / 32;
    for (const l of ls) v = Math.max(0, Math.min(1, (v - (l!.black ?? 0) / 255) / ((l!.white ?? 255) / 255 - (l!.black ?? 0) / 255))) ** (1 / (l!.gamma ?? 1));
    for (const c of cs) v = c(v * 255) / 255;
    return n(v);
  }).join(" ");
}

function build(top: Adjust, id: string, blurPx = 0): string {
  const f: string[] = [];
  layersOf(top).forEach((a, layer) => layerPrimitives(a, `${id}-${layer}`, f));
  if (blurPx) f.push(`<feGaussianBlur stdDeviation="${n(blurPx)}"/>`);
  const room = blurPx ? ' x="-30%" y="-30%" width="160%" height="160%"' : ' x="0" y="0" width="100%" height="100%"';
  return `<filter id="${id}" color-interpolation-filters="sRGB"${room}>${f.join("")}</filter>`;
}

/** An SVG `<filter>` of these adjustments for a file (the blur, if any, as `blurPx` of the object's size); "" when they change nothing. */
export const svgAdjustFilter = (a: Adjust, id: string, blurPx: number): string => (isNeutral(a) ? "" : build(a, id, blurPx));

/** The filter primitives of one layer of a stack (the blur of a layer is a CSS blur, taken from the first layer only). */
function layerPrimitives(a: Adjust, id: string, f: string[]): void {
  const e = (a.exposure ?? 0) / 100, c = (a.contrast ?? 0) / 100, t = (a.temperature ?? 0) / 100, ti = (a.tint ?? 0) / 100;
  const sh = (a.shadows ?? 0) / 100, hi = (a.highlights ?? 0) / 100;
  const transfer = (attrs: (ch: string) => string): string => ["R", "G", "B"].map((ch) => `<feFunc${ch} ${attrs(ch)}/>`).join("");
  if (e) f.push(`<feComponentTransfer>${transfer(() => `type="linear" slope="${n(2 ** (e * 1.5))}"`)}</feComponentTransfer>`);
  if (sh || hi) f.push(`<feComponentTransfer>${transfer(() => `type="table" tableValues="${toneTable(sh, hi)}"`)}</feComponentTransfer>`);
  if (t || ti || a.red || a.green || a.blue) {
    const gain = (v: number | undefined): number => 2 ** ((v ?? 0) / 100);
    const r = (1 + 0.25 * t + 0.06 * ti) * gain(a.red), g = (1 - 0.18 * ti) * gain(a.green), b = (1 - 0.25 * t + 0.06 * ti) * gain(a.blue);
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
  const tabs = (["r", "g", "b"] as const).map((ch) => channelTable([a.levels?.master, a.levels?.[ch]], [a.curves?.master, a.curves?.[ch]]));
  if (tabs.some(Boolean)) f.push(`<feComponentTransfer>${(["R", "G", "B"] as const).map((ch, k) => (tabs[k] ? `<feFunc${ch} type="table" tableValues="${tabs[k]}"/>` : "")).join("")}</feComponentTransfer>`);
}

/** The CSS `filter` for these adjustments: "" when there are none. */
/** `blurRef`: when given, a blur of 100 % is 2 % of it (px), as for stills; otherwise the fixed size a player uses. */
export function playingFilter(a: Adjust | undefined, blurRef?: number): string {
  if (isNeutral(a) || !a) return "";
  const key = adjustKey(a);
  let id = made.get(key);
  const needsSvg = layersOf(a).some((l) => !!(l.exposure || l.contrast || l.highlights || l.shadows || l.temperature || l.tint || l.saturation || l.vibrance || l.red || l.green || l.blue || l.sharpen || l.grain || l.map || l.levels || l.curves));
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
  return [needsSvg && id ? `url(#${id})` : "", a.blur ? `blur(${(blurRef === undefined ? (a.blur / 100) * 8 : (a.blur / 100) * 0.02 * blurRef).toFixed(2)}px)` : ""].filter(Boolean).join(" ");
}
