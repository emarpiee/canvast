/**
 * The picker's stylesheet. Every colour, size and space is a `--cp-*` custom property, so a host themes the picker by setting them on
 * `.cp` (or any ancestor); the defaults below sit in `:where(.cp)` (specificity 0), so any rule of the host's wins. Variables:
 *
 *   --cp-bg --cp-fg --cp-muted --cp-border --cp-field --cp-hover --cp-accent --cp-accent-fg --cp-focus     colours
 *   --cp-text --cp-text-sm --cp-font --cp-mono                                                             type
 *   --cp-radius --cp-radius-sm --cp-gap --cp-gap-sm --cp-pad                                               shape and space
 *   --cp-thumb --cp-bar --cp-swatch --cp-size (the ring, set from the `size` option)                       sizes
 */
export const PICKER_CSS = `
:where(.cp) {
  --cp-bg: #ffffff; --cp-fg: #1f2329; --cp-muted: #5f6b76; --cp-border: rgba(31, 35, 41, 0.18); --cp-field: #f1f3f5; --cp-hover: rgba(31, 35, 41, 0.08);
  --cp-accent: #2563eb; --cp-accent-fg: #ffffff; --cp-focus: #2563eb;
  --cp-text: 13px; --cp-text-sm: 11px; --cp-font: ui-sans-serif, system-ui, sans-serif; --cp-mono: ui-monospace, Menlo, Consolas, monospace;
  --cp-radius: 8px; --cp-radius-sm: 5px; --cp-gap: 10px; --cp-gap-sm: 6px; --cp-pad: 0px;
  --cp-thumb: 16px; --cp-bar: 12px; --cp-swatch: 20px;
}
@media (prefers-color-scheme: dark) {
  :where(.cp) { --cp-bg: #1d2126; --cp-fg: #e8eaed; --cp-muted: #9aa4ae; --cp-border: rgba(232, 234, 237, 0.2); --cp-field: #2a3037; --cp-hover: rgba(232, 234, 237, 0.1); }
}
.cp { display: flex; flex-direction: column; gap: var(--cp-gap); padding: var(--cp-pad); width: calc(var(--cp-size) + var(--cp-pad) * 2); box-sizing: content-box; color: var(--cp-fg); font: var(--cp-text) / 1.3 var(--cp-font); user-select: none; -webkit-user-select: none; }
.cp *, .cp *::before, .cp *::after { box-sizing: border-box; }
.cp button, .cp input { font: inherit; color: inherit; }
.cp :focus-visible { outline: 2px solid var(--cp-focus); outline-offset: 1px; }

.cp-bar { display: flex; flex-direction: column; gap: var(--cp-gap-sm); }
.cp-seg { display: flex; padding: 2px; gap: 2px; background: var(--cp-field); border-radius: var(--cp-radius); }
.cp-seg button { flex: 1; border: 0; background: transparent; padding: 3px var(--cp-gap-sm); border-radius: var(--cp-radius-sm); font-size: var(--cp-text-sm); cursor: pointer; color: var(--cp-muted); }
.cp-seg button:hover { background: var(--cp-hover); color: var(--cp-fg); }
.cp-seg button[aria-checked="true"] { background: var(--cp-accent); color: var(--cp-accent-fg); }

.cp-wheel { position: relative; width: var(--cp-size); height: var(--cp-size); touch-action: none; cursor: crosshair; }
.cp[data-view="sliders"] .cp-wheel { display: none; }
.cp-ring { position: absolute; inset: 0; width: 100%; height: 100%; }
.cp-box { position: absolute; border-radius: var(--cp-radius-sm); box-shadow: 0 0 0 1px var(--cp-border); }
.cp-area { position: absolute; border-radius: var(--cp-radius-sm); pointer-events: none; }
.cp-hue { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }
.cp-thumb { position: absolute; width: var(--cp-thumb); height: var(--cp-thumb); margin: calc(var(--cp-thumb) / -2) 0 0 calc(var(--cp-thumb) / -2); border-radius: 50%; border: 2px solid var(--cp-accent-fg); box-shadow: 0 0 0 1px var(--cp-fg), 0 1px 3px var(--cp-border); pointer-events: none; }

.cp-fields { display: grid; gap: var(--cp-gap-sm); }
.cp-field { display: grid; grid-template-columns: 1.4em 1fr 3.6em; align-items: center; gap: var(--cp-gap-sm); }
.cp-field label { color: var(--cp-muted); font-size: var(--cp-text-sm); text-align: center; }
.cp[data-view="wheel"] .cp-fields { grid-template-columns: repeat(3, 1fr); }
.cp[data-view="wheel"] .cp-field { grid-template-columns: auto 1fr; }
.cp[data-view="wheel"] .cp-slider { display: none; }
.cp-num, .cp-hex { background: var(--cp-field); border: 1px solid transparent; border-radius: var(--cp-radius-sm); }
.cp-num { width: 100%; min-width: 0; padding: 3px var(--cp-gap-sm); text-align: right; font-family: var(--cp-mono); appearance: textfield; -moz-appearance: textfield; }
.cp-num::-webkit-outer-spin-button, .cp-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cp-num:focus, .cp-hex:focus-within { border-color: var(--cp-focus); outline: none; }

.cp-slider { -webkit-appearance: none; appearance: none; width: 100%; height: var(--cp-bar); margin: 0; border-radius: var(--cp-radius); background: var(--cp-track); box-shadow: inset 0 0 0 1px var(--cp-border); cursor: pointer; }
.cp-slider::-webkit-slider-thumb { -webkit-appearance: none; width: var(--cp-thumb); height: var(--cp-thumb); border-radius: 50%; background: var(--cp-thumb-fill); border: 2px solid var(--cp-accent-fg); box-shadow: 0 0 0 1px var(--cp-fg); }
.cp-slider::-moz-range-thumb { width: var(--cp-thumb); height: var(--cp-thumb); box-sizing: border-box; border-radius: 50%; background: var(--cp-thumb-fill); border: 2px solid var(--cp-accent-fg); box-shadow: 0 0 0 1px var(--cp-fg); }

.cp-value { display: flex; gap: var(--cp-gap-sm); align-items: center; }
.cp-preview { display: flex; flex: none; width: calc(var(--cp-swatch) * 2.4); height: calc(var(--cp-swatch) * 1.4); border-radius: var(--cp-radius-sm); overflow: hidden; box-shadow: 0 0 0 1px var(--cp-border); }
.cp-before { flex: 1; border: 0; padding: 0; cursor: pointer; }
.cp-after { flex: 1; }
.cp-hex { display: flex; align-items: center; flex: 1; min-width: 0; padding: 0 var(--cp-gap-sm); }
.cp-hex span { color: var(--cp-muted); font-family: var(--cp-mono); }
.cp-hex input { flex: 1; min-width: 0; padding: 3px 0 3px 2px; border: 0; background: transparent; font-family: var(--cp-mono); text-transform: uppercase; outline: none; }

.cp-groups { display: flex; flex-direction: column; gap: var(--cp-gap-sm); }
.cp-group-h { color: var(--cp-muted); font-size: var(--cp-text-sm); margin-bottom: 3px; }
.cp-swatches { display: flex; flex-wrap: wrap; gap: var(--cp-gap-sm); }
.cp-swatch { width: var(--cp-swatch); height: var(--cp-swatch); padding: 0; border-radius: 50%; border: 0; box-shadow: 0 0 0 1px var(--cp-border); cursor: pointer; }
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
