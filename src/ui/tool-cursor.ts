/**
 * The canvas's cursor for a tool that draws, picks by drawing or erases: a small crosshair where the pointer acts, and the tool's own icon
 * beside it, the one the rail shows (a shape tool shows the kind of shape, a pen the kind of pen). One cursor maker for every tool.
 */
import { ICONS } from "./icons";

/** The cursor's size and where it acts (the crosshair's middle). */
const SIZE = 32;
const HOT = 8;

/** A CSS `cursor` value: the crosshair and `icon` (an icon of `ICONS`, drawn black on a white halo so it reads on any canvas), then the crosshair if the browser draws no picture. */
export function toolCursor(icon: string): string {
  const inner = icon.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const at = (colour: string, width: number): string =>
    `<svg x='13' y='13' width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='${colour}' stroke-width='${width}' stroke-linecap='round' stroke-linejoin='round'>${inner.replace(/"/g, "'")}</svg>`;
  const cross = (colour: string, width: number): string =>
    `<path d='M${HOT} 1v5M${HOT} 10v5M1 ${HOT}h5M10 ${HOT}h5' stroke='${colour}' stroke-width='${width}' stroke-linecap='round'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}' viewBox='0 0 ${SIZE} ${SIZE}'>${cross("white", 3)}${cross("black", 1.2)}${at("white", 5)}${at("black", 2)}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${HOT} ${HOT}, crosshair`;
}
