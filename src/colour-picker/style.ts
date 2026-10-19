/**
 * The picker's stylesheet. Every colour, size and space is a `--cp-*` custom property, so a host themes the picker by setting them on
 * `.cp` (or any ancestor); the defaults below sit in `:where(.cp)` (specificity 0), so any rule of the host's wins. Variables:
 *
 *   --cp-bg --cp-fg --cp-muted --cp-border --cp-field --cp-hover --cp-accent --cp-accent-fg --cp-focus     colours
 *   --cp-check-a --cp-check-b                                                                              the chequer behind transparency
 *   --cp-text --cp-text-sm --cp-font --cp-mono                                                             type
 *   --cp-radius --cp-radius-sm --cp-gap --cp-gap-sm --cp-pad                                               shape and space
 *   --cp-thumb --cp-bar --cp-swatch --cp-field-h --cp-dot --cp-size (the ring, set from the `size` option)          sizes
 */
export const PICKER_CSS = `
:where(.cp) {
  --cp-bg: #ffffff; --cp-fg: #1f2329; --cp-muted: #5f6b76; --cp-border: rgba(31, 35, 41, 0.18); --cp-field: #f1f3f5; --cp-hover: rgba(31, 35, 41, 0.08);
  --cp-accent: #2563eb; --cp-accent-fg: #ffffff; --cp-focus: #2563eb; --cp-check-a: #d5d9dd; --cp-check-b: #ffffff;
  --cp-text: 13px; --cp-text-sm: 11px; --cp-font: ui-sans-serif, system-ui, sans-serif; --cp-mono: ui-monospace, Menlo, Consolas, monospace;
  --cp-radius: 8px; --cp-radius-sm: 5px; --cp-gap: 10px; --cp-gap-sm: 6px; --cp-pad: 0px;
  --cp-thumb: 16px; --cp-bar: 12px; --cp-swatch: 20px;
}
@media (prefers-color-scheme: dark) {
  :where(.cp) { --cp-bg: #1d2126; --cp-fg: #e8eaed; --cp-muted: #9aa4ae; --cp-border: rgba(232, 234, 237, 0.2); --cp-field: #2a3037; --cp-hover: rgba(232, 234, 237, 0.1); --cp-check-a: #3a4048; --cp-check-b: #272c32; }
}
.cp { --cp-check: conic-gradient(var(--cp-check-a) 25%, var(--cp-check-b) 0 50%, var(--cp-check-a) 0 75%, var(--cp-check-b) 0) 0 0 / 8px 8px; display: flex; flex-direction: column; gap: var(--cp-gap); padding: var(--cp-pad); width: calc(var(--cp-size) + var(--cp-pad) * 2); box-sizing: content-box; color: var(--cp-fg); font: var(--cp-text) / 1.3 var(--cp-font); user-select: none; -webkit-user-select: none; }
.cp *, .cp *::before, .cp *::after { box-sizing: border-box; }
.cp [hidden] { display: none; }
.cp button, .cp input, .cp select { font: inherit; color: inherit; }
.cp :focus-visible { outline: 2px solid var(--cp-focus); outline-offset: 1px; }

.cp-bar { display: flex; flex-direction: column; gap: var(--cp-gap-sm); }
.cp-row { display: flex; gap: var(--cp-gap-sm); }
.cp-seg { display: flex; padding: 2px; gap: 2px; background: var(--cp-field); border-radius: var(--cp-radius); }
.cp-seg button { flex: 1; border: 0; background: transparent; padding: 3px var(--cp-gap-sm); border-radius: var(--cp-radius-sm); font-size: var(--cp-text-sm); cursor: pointer; color: var(--cp-muted); }
.cp-seg button:hover { background: var(--cp-hover); color: var(--cp-fg); }
.cp-seg button[aria-checked="true"] { background: var(--cp-accent); color: var(--cp-accent-fg); }
.cp-select { min-width: 0; min-height: var(--cp-field-h, 0px); padding: 3px var(--cp-gap-sm); background: var(--cp-field); border: 1px solid transparent; border-radius: var(--cp-radius-sm); font-size: var(--cp-text-sm); cursor: pointer; }
.cp-select:hover { background: var(--cp-hover); }
.cp-view { flex: 1; }
.cp-tool { flex: none; display: grid; place-items: center; width: 28px; min-height: var(--cp-field-h, 0px); padding: 0; background: var(--cp-field); border: 0; border-radius: var(--cp-radius-sm); cursor: pointer; color: var(--cp-muted); }
.cp-tool:hover { background: var(--cp-hover); color: var(--cp-fg); }

.cp-wheel { position: relative; width: var(--cp-size); height: var(--cp-size); touch-action: none; cursor: crosshair; }
.cp[data-view="plane"] .cp-wheel, .cp[data-view="sliders"] .cp-wheel { display: none; }
.cp-ring { position: absolute; inset: 0; border-radius: 50%; -webkit-mask: radial-gradient(circle farthest-side, transparent 79%, #000 80%); mask: radial-gradient(circle farthest-side, transparent 79%, #000 80%); }
.cp-box { position: absolute; border-radius: var(--cp-radius-sm); box-shadow: 0 0 0 1px var(--cp-border); }
.cp-area { position: absolute; border-radius: var(--cp-radius-sm); pointer-events: none; }
.cp-hue { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }
.cp-thumb { position: absolute; left: 0; top: 0; width: var(--cp-thumb); height: var(--cp-thumb); margin: calc(var(--cp-thumb) / -2) 0 0 calc(var(--cp-thumb) / -2); border-radius: var(--cp-dot, 50%); border: 2px solid var(--cp-accent-fg); box-shadow: 0 0 0 1px var(--cp-fg), 0 1px 3px var(--cp-border); pointer-events: none; will-change: transform; }

.cp-plane { display: none; position: relative; width: var(--cp-size); touch-action: none; cursor: crosshair; }
.cp[data-view="plane"] .cp-plane { display: block; }
.cp-plane-box { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: var(--cp-radius); box-shadow: 0 0 0 1px var(--cp-border); }
.cp-plane .cp-area { inset: 0; border-radius: var(--cp-radius); }

.cp-fields { display: grid; gap: var(--cp-gap-sm); }
.cp[data-view="wheel"] .cp-fields { display: none; }
.cp[data-view="plane"] .cp-field[data-row="1"], .cp[data-view="plane"] .cp-field[data-row="2"], .cp[data-view="plane"] .cp-field[data-row="0"] .cp-num { display: none; }
.cp[data-view="plane"] .cp-field[data-row="0"] { grid-template-columns: 1.4em 1fr; }
.cp-field { display: grid; grid-template-columns: 1.4em 1fr 3.6em; align-items: center; gap: var(--cp-gap-sm); }
.cp-field label { color: var(--cp-muted); font-size: var(--cp-text-sm); text-align: center; }
.cp-alpha { display: none; }
.cp[data-alpha="true"] .cp-alpha { display: grid; }
.cp-nums { display: none; grid-template-columns: repeat(3, 1fr); gap: var(--cp-gap-sm); }
.cp[data-view="wheel"] .cp-nums, .cp[data-view="plane"] .cp-nums { display: grid; }
.cp-numcell { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--cp-gap-sm); color: var(--cp-muted); font-size: var(--cp-text-sm); }
.cp-num, .cp-hex { background: var(--cp-field); border: 1px solid transparent; border-radius: var(--cp-radius-sm); }
.cp .cp-num { width: 100%; min-width: 0; min-height: var(--cp-field-h, 0px); padding: 3px var(--cp-gap-sm); text-align: right; font-family: var(--cp-mono); color: var(--cp-fg); appearance: textfield; -moz-appearance: textfield; }
.cp-num::-webkit-outer-spin-button, .cp-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
label[data-scrubbable] { cursor: ew-resize; user-select: none; }
input[data-scrub-input] { cursor: ew-resize; user-select: text; }
input[data-scrub-input]:focus { cursor: text; }
.cp-num:focus, .cp-hex:focus-within { border-color: var(--cp-focus); outline: none; }

.cp-slider { -webkit-appearance: none; appearance: none; width: 100%; height: var(--cp-bar); margin: 0; border-radius: var(--cp-radius); background: var(--cp-track); box-shadow: inset 0 0 0 1px var(--cp-border); cursor: pointer; }
.cp-slider::-webkit-slider-thumb { -webkit-appearance: none; width: var(--cp-thumb); height: var(--cp-thumb); border-radius: var(--cp-dot, 50%); background: var(--cp-thumb-fill); border: 2px solid var(--cp-accent-fg); box-shadow: 0 0 0 1px var(--cp-fg); }
.cp-slider::-moz-range-thumb { width: var(--cp-thumb); height: var(--cp-thumb); box-sizing: border-box; border-radius: var(--cp-dot, 50%); background: var(--cp-thumb-fill); border: 2px solid var(--cp-accent-fg); box-shadow: 0 0 0 1px var(--cp-fg); }

.cp-value { display: flex; flex-wrap: wrap; gap: var(--cp-gap-sm); align-items: center; }
.cp-preview { display: flex; flex: none; width: calc(var(--cp-swatch) * 2); height: calc(var(--cp-swatch) * 1.4); border-radius: var(--cp-radius-sm); overflow: hidden; background: var(--cp-check); box-shadow: 0 0 0 1px var(--cp-border); }
.cp-before { flex: 1; border: 0; padding: 0; cursor: pointer; }
.cp-after { flex: 1; }
.cp-hex { display: flex; align-items: center; flex: 1; min-width: 0; min-height: var(--cp-field-h, 0px); padding: 0 var(--cp-gap-sm); }
.cp-hex span { color: var(--cp-muted); font-family: var(--cp-mono); }
.cp-hex input { flex: 1; min-width: 0; padding: 3px 0 3px 2px; border: 0; background: transparent; font-family: var(--cp-mono); outline: none; }
.cp-fmt { flex: none; padding-inline: 2px; }
.cp[data-format="hex"] .cp-fmt { width: 4.4em; }
/* A long text (rgb(), oklch()) gets a row of its own, under the preview and the format switch. */
.cp[data-format="rgb"] .cp-hex, .cp[data-format="oklch"] .cp-hex { order: 3; flex: 1 1 100%; }
.cp[data-format="rgb"] .cp-fmt, .cp[data-format="oklch"] .cp-fmt { flex: 1; }
.cp-contrast { color: var(--cp-muted); font-size: var(--cp-text-sm); }
.cp-contrast:empty { display: none; }

.cg { gap: var(--cp-gap); }
.cg-barrow { display: flex; align-items: center; gap: var(--cp-gap-sm); } /* (the swap and remove buttons stand either side of the bar they act on) */
.cg-barrow .cg-bar { flex: 1; min-width: 0; }
.cg-bar { position: relative; height: calc(var(--cp-bar) * 2); margin: calc(var(--cp-thumb) / 2) calc(var(--cp-thumb) / 2) var(--cp-gap-sm); touch-action: none; cursor: copy; }
.cg-track { position: absolute; inset: 0; border-radius: var(--cp-radius-sm); box-shadow: inset 0 0 0 1px var(--cp-border); }
.cg-stop { position: absolute; top: 100%; width: var(--cp-thumb); height: var(--cp-thumb); margin: 2px 0 0 calc(var(--cp-thumb) / -2); padding: 0; border: 2px solid var(--cp-accent-fg); border-radius: var(--cp-dot, 50%); background: var(--cg-stop); box-shadow: 0 0 0 1px var(--cp-fg); cursor: grab; }
.cg-stop::before { content: ""; position: absolute; left: 50%; bottom: 100%; width: 0; height: var(--cp-gap-sm); border-left: 1px solid var(--cp-fg); }
.cg-stop.is-on { box-shadow: 0 0 0 2px var(--cp-accent); }
/* Each line is a label on the left and its number in the same column as the numbers of the sliders below (3.6em at the right edge). */
.cg-row { display: grid; grid-template-columns: 1fr 3.6em; gap: var(--cp-gap-sm); align-items: center; color: var(--cp-muted); font-size: var(--cp-text-sm); white-space: nowrap; }
.cg-field { display: contents; }
.cg-field .cp-num { width: 100%; }
.cg-barrow .cp-tool { flex: none; }
.cg-text { width: 28px; font-size: var(--cp-text); }
.cg-text:disabled { opacity: 0.4; cursor: default; }
.cg[data-type="linear"] .cg-radial, .cg[data-type="radial"] .cg-linear, .cg[data-type="angular"] .cg-r { display: none; }
.cp-groups { display: flex; flex-direction: column; gap: var(--cp-gap-sm); }
.cp-groups:empty { display: none; }
.cp-group-h { color: var(--cp-muted); font-size: var(--cp-text-sm); margin-bottom: 3px; }
.cp-swatches { display: flex; flex-wrap: wrap; gap: var(--cp-gap-sm); width: 0; min-width: 100%; max-height: calc(4 * var(--cp-swatch) + 3 * var(--cp-gap-sm) + 4px); overflow-y: auto; padding: 2px; margin: -2px; } /* (a long list wraps in the width of the picker and scrolls after four rows: it never makes the picker wider) */
.cp-swatch { width: var(--cp-swatch); height: var(--cp-swatch); padding: 0; border-radius: var(--cp-dot, 50%); border: 0; box-shadow: 0 0 0 1px var(--cp-border); cursor: pointer; }
.cp-swatch:hover { box-shadow: 0 0 0 2px var(--cp-fg); }
.cp-swatch.is-on { box-shadow: 0 0 0 2px var(--cp-bg), 0 0 0 4px var(--cp-accent); }
`;

let injected = false;
/** Add the stylesheet to the document once. */
export function ensureStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.setAttribute("data-colour-picker", "");
  style.textContent = PICKER_CSS;
  // First in the head, so a host's own rules (same specificity) come after and win.
  document.head.prepend(style);
}
