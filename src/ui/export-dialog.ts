/**
 * The Export dialog (ADR 0147). What is exported has a shape (its ratio) and no size: here the size is chosen, in px, inches, centimetres
 * or millimetres at a resolution, and every other length follows from the ratio. Pick one of the sizes the shape is made for (A4, Full HD,
 * a story, the picture's own pixels …), or type a width or a height; the preview shows the shape with its measures, and the file is
 * made at exactly that size. PNG, WebP and JPEG; SVG too when everything is vector.
 */
import { makeModal, showModal } from "./modal";
import { cleanName, replaceInvalid } from "../doc/file-names";
import { plural } from "../doc/plural";
import { forgetCopiedPicture } from "../app/actions";
import { writeSystemClipboard } from "../app/system-clipboard";
import { scrubNumbers } from "../colour-picker/scrub";
import type { Background, ExportTarget } from "../app/export-render";
import { paddedTarget } from "../app/export-render";
import { DPIS, MAX_AREA, MAX_SIDE, UNITS, clampSize, formatRatio, fromPx, presetOf, sizeSuggestions, toPx } from "../app/export-size";
import type { Unit } from "../app/export-size";
import { jpegWithDpi, pdfOf, pdfPageOf, pdfVectorPage, pngWithDpi, webpWithDpi } from "../app/export-files";
import type { PdfVector } from "../app/pdf-vector";
import { SHOT_FORMATS, encodeShot } from "../app/screenshot";
import { writeZip } from "../storage/zip";
import type { ShotFormat } from "../app/screenshot";
import { esc } from "./format";
import { DEFAULTS, HEX, cleanBg, cleanExportPreset, exportPresetSummary, loadPrefsFrom } from "../app/export-prefs";
import type { Action, ExportPreset, Format, PadUnit, Prefs } from "../app/export-prefs";
export { cleanExportPreset, exportPresetSummary };
export type { ExportPreset };
import { ICONS } from "./icons";
import { BUILT_IN_PATTERNS, DEFAULT_PATTERN, NAME_TOKENS, SIZE_RULES, VARIANTS, cleanSizeRule, nameFrom, sizeByRule, today, uniqueNames, variantName, variantScale, withoutExtension } from "../app/export-names";
import type { SizeRule, Variant } from "../app/export-names";

export interface ExportDeps {
  /** What is exported: one target, or one for each of several sheets (they leave together, as a ZIP or the pages of a PDF). */
  readonly targets: readonly ExportTarget[];
  /** Several things selected: each of them on its own (the other way to export them). */
  readonly each?: readonly ExportTarget[];
  /** Shown each on its own: all of them as one picture (the other way back). */
  readonly together?: readonly ExportTarget[];
  /** A target drawn at `w` × `h` px. */
  render(t: ExportTarget, w: number, h: number, bg: Background): Promise<HTMLCanvasElement>;
  /** The vectors of a target as SVG text of this size (width and height as SVG writes them), or null when it cannot be. */
  svg(t: ExportTarget, size: { w: string; h: string }): string | null;
  /** A warning for the SVG of these targets (what the file cannot hold as vectors), or null. */
  svgWarning?(targets: readonly ExportTarget[]): string | null;
  /** The vectors of a target as a PDF page of this size in points (ADR 0153), or null when the page needs a picture. */
  pdfVector(t: ExportTarget, wPt: number, hPt: number): PdfVector | null;
  /** Put the file in the library (and tell the person, with a way to see it). */
  toLibrary(file: File, targets: readonly ExportTarget[]): Promise<void>;
  /** A message for the person (the notice stack). */
  say(text: string): void;
  /** How big a target is on the screen now, in CSS px (null: not in view): the 1×, 2× … sizes. */
  screenSize?(t: ExportTarget): { w: number; h: number } | null;
  /** The canvas's background colour as #rrggbb (the Canvas background). */
  canvasColour?(): string;
  /** Export presets (saved styles of the kind "export"): listed, saved, updated, and managed in the Styles panel. */
  presets?: {
    list(): ReadonlyArray<{ id: string; name: string; data: ExportPreset }>;
    save(data: ExportPreset): Promise<{ id: string; name: string } | null>;
    update(id: string, data: ExportPreset): Promise<boolean>;
    manage(): void;
  };
  /** Pick a colour (the shared colour popover). */
  pickColour?(anchor: HTMLElement, value: string, onInput: (hex: string) => void): void;
  /** Name formats (saved styles of the kind "exportname"): listed beside the name, saved from it, managed in the Styles panel. */
  names?: {
    list(): ReadonlyArray<{ id: string; name: string; pattern: string }>;
    save(pattern: string): Promise<{ id: string; name: string } | null>;
    manage(): void;
  };
  /** The workspace's defaults (Settings > Saving to the library): the name pattern and how several things are sized. */
  defaults?(): { pattern: string; sizeRule: string };
  /** The open canvas's name ({canvas} in a name). */
  canvasName?(): string;
}

const KEY = "canvast.export";
const loadPrefs = (): Prefs => {
  try {
    return loadPrefsFrom(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>);
  } catch {
    return DEFAULTS;
  }
};
const savePrefs = (p: Prefs): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // a browser that keeps nothing: the choices last for this dialog
  }
};

/** The last export of each sheet or selection on this device, by what it is made of (Export again uses it). */
const LAST_KEY = "canvast.export.last";
const LAST_MAX = 200;
interface Last extends Prefs { widthPx: number; name?: string }
/** What names a target: its objects, the same however they were picked. */
export const exportKey = (ts: readonly ExportTarget[]): string => ts.map((x) => [...x.ids].sort().join(",")).join("|");
const readLast = (): Record<string, Last> => {
  try {
    return (JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, Last>) ?? {};
  } catch {
    return {};
  }
};
const lastOf = (key: string): Last | null => {
  const l = readLast()[key];
  return l && Number(l.widthPx) > 0 ? { ...loadPrefsFrom(l), widthPx: Number(l.widthPx), ...(typeof l.name === "string" ? { name: l.name } : {}) } : null;
};
const keepLast = (key: string, l: Last): void => {
  try {
    const all = readLast();
    delete all[key];
    all[key] = l;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - LAST_MAX))) delete all[k];
    localStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch {
    // a browser that keeps nothing: Export again is not offered
  }
};
/** Whether these targets were exported before on this device (Export again can run). */
export const exportedBefore = (ts: readonly ExportTarget[]): boolean => ts.length > 0 && lastOf(exportKey(ts)) !== null;

const slug = (s: string): string => cleanName(s, "clean", "export");
const UNIT_LABEL: Record<Unit, string> = { px: "px", in: "in", cm: "cm", mm: "mm" };
const decimals = (u: Unit): number => (u === "px" ? 0 : u === "in" ? 2 : 1);
const shown = (v: number, u: Unit): string => String(Number(v.toFixed(decimals(u))));
const PREVIEW_PX = 320;

function openEach(deps: ExportDeps): void {
  const { each, ...rest } = deps;
  openExportDialog({ ...rest, targets: each!, together: deps.targets });
}

function openTogether(deps: ExportDeps): void {
  const { together, ...rest } = deps;
  openDialog({ ...rest, targets: together!, each: deps.targets });
}

export function openExportDialog(deps: ExportDeps): void {
  // (a PDF of several things is a page for each, unless asked for as one picture)
  if (deps.each?.length && loadPrefs().format === "pdf") return openEach(deps);
  openDialog(deps);
}

/** Export these targets again as they were last time, with no dialog (the last action: download, copy or the library). */
export function exportAgain(deps: ExportDeps): void {
  openDialog(deps, true);
}

function openDialog(deps: ExportDeps, again = false): void {
  /** As picked, before any padding (in the order the pictures leave: the pages of a PDF, the files of a ZIP; the person can change it). */
  let raw = [...deps.targets];
  let ts = raw;
  let t = ts[0]!;
  const multi = ts.length > 1;
  const allVectors = ts.every((x) => x.vectors);
  const key = exportKey(raw);
  const last = lastOf(key);
  const prefs: Prefs = last ? (({ widthPx: _w, name: _n, ...p }) => p)(last) : loadPrefs();
  if (prefs.format === "svg" && !allVectors) prefs.format = "png";
  // (a first export of these things starts from the workspace's defaults: its name pattern and how several are sized)
  const defaults = deps.defaults?.();
  if (!prefs.pattern) prefs.pattern = defaults?.pattern ?? "";
  if (!last && defaults) prefs.sizeRule = cleanSizeRule(defaults.sizeRule);
  /** Left out of this export (unticked), by what was picked. */
  const out = new Set<ExportTarget>();
  /** A name typed for one thing ({name} in the pattern), by what was picked. */
  const own = new Map<ExportTarget, string>();
  /** Times its size on the canvas, for the Scale rule. */
  let scaleV = 1;
  /** Several things, shown as one picture: the way back to each on its own is in the Output choice. */
  const asOne = !multi && !!deps.each?.length;
  const canOne = multi ? !!deps.together?.length : asOne;
  // To begin with: the picture's own pixels, else the first size the shape is made for (A4, Full HD …), else the longer side 1920 px.
  const startW = t.ratio >= 1 ? 1920 : 1920 * t.ratio;
  const exact = multi ? undefined : sizeSuggestions(t.ratio, 8).find((s) => s.exact);
  let widthPx = last?.widthPx ?? (t.original && !multi ? t.original.w : (exact?.w ?? (multi ? 1080 : startW)));
  const noun = ts.every((x) => x.kind === "sheet") ? "sheets" : "items";
  // (several pictures leave at their own pixels, each page its picture's shape, until a width is set)
  const firstWidth = widthPx;
  const ownSizes = (): boolean => multi && ts.every((x) => x.original) && widthPx === firstWidth;
  // A size the shape is made for is taken whole (2480 × 3508 for A4), not worked out from a ratio that may differ in the last digit.
  let whole: { w: number; h: number } | null = multi ? null : t.original ? { w: t.original.w, h: t.original.h } : exact ? { w: exact.w, h: exact.h } : null;
  if (last && whole && whole.w !== last.widthPx) whole = null;
  /** The times-on-screen size chosen (a chip), kept by a preset; null once a width is typed. */
  let scaleK: number | null = null;
  /** The padding as a share of each target's longer side (px: of the size it leaves at). */
  const padFrac = (x: ExportTarget): number => {
    if (!(prefs.pad > 0)) return 0;
    if (prefs.padUnit === "%") return prefs.pad / 100;
    const cw = Math.max(1, widthPx - 2 * prefs.pad), ch = cw / x.ratio;
    return prefs.pad / Math.max(cw, ch);
  };
  let fracs = "";
  /** The targets with their padding (made again only when it changes, so the previews are kept). */
  const pad = (): void => {
    const f = raw.map(padFrac);
    const k = f.join(",");
    if (k === fracs && ts.length === raw.length) return;
    fracs = k;
    ts = raw.map((x, i) => paddedTarget(x, f[i]!));
    t = ts[0]!;
    if (prefs.pad > 0) whole = null;
  };
  pad();
  let busy = false;

    const preset = presetOf(t.ratio);
  const dlg = makeModal({
    className: multi ? "confirm export-dlg is-multi" : "confirm export-dlg",
    testid: "export-dialog",
    titleId: "ex-title",
    html: `
    <header class="ex-head">
      <h2 id="ex-title">Export <span class="ex-what">${multi ? `${ts.length} ${noun}` : esc(t.name)}</span></h2>
      <button type="button" class="layer-btn" data-ex="close" aria-label="Close" title="Close">${ICONS.x}</button>
    </header>
    <div class="ex-body">
      <div class="ex-stage">
        ${multi ? `<div class="ex-minis" data-ex-minis></div>` : `<div class="ex-frame" data-ex-frame style="--shape:${Math.min(Math.max(t.ratio, 0.2), 5)}">
          <canvas class="ex-thumb" data-ex-thumb aria-label="Preview"></canvas>
          <span class="ex-dim ex-dim-w" data-ex-dim-w></span>
          <span class="ex-dim ex-dim-h" data-ex-dim-h></span>
        </div>`}
        ${multi ? `<div class="ex-pick" data-ex-pick><span data-ex-count data-testid="export-count"></span><button type="button" class="adj-map-edit" data-ex="all">All</button><button type="button" class="adj-map-edit" data-ex="none">None</button></div>` : ""}
        <p class="ex-shape" data-testid="export-shape">${multi ? `<strong>${ts.length} ${noun}</strong> <span>· ${ownSizes() ? "each at its own pixels, until you set a width" : "each at this width, its own shape"}</span>` : `Shape <strong>${esc(formatRatio(t.ratio))}</strong>${preset ? ` <span>· ${esc(preset.short)}</span>` : ""}`}</p>
      </div>
      <div class="ex-panel">
        ${deps.presets ? `<label class="ex-field ex-preset">Preset <select data-ex="preset" aria-label="Export preset: saved choices, or save these"></select></label>` : ""}
        <section class="ex-sec" aria-label="Size">
          ${multi ? `<div class="ex-row"><div class="seg" role="radiogroup" aria-label="Size of each" data-ex-rules>${SIZE_RULES.map(([r, label, tip]) => `<button type="button" role="radio" data-rule="${r}" aria-checked="${r === prefs.sizeRule}" title="${esc(tip)}">${label}</button>`).join("")}</div></div>` : ""}
          <div class="ex-row">
            <label class="ex-field"><span data-ex-wlabel>${multi ? "Width of each" : "Width"}</span> <input type="number" data-ex="w" min="0" step="any" inputmode="decimal" aria-label="Width"></label>
            <span class="ex-times"${multi ? " hidden" : ""} title="The shape stays: change one side and the other follows" aria-hidden="true">×</span>
            <label class="ex-field"${multi ? " hidden" : ""}>Height <input type="number" data-ex="h" min="0" step="any" inputmode="decimal" aria-label="Height"></label>
            <div class="seg" role="radiogroup" aria-label="Unit" data-ex-units>${UNITS.map((u) => `<button type="button" role="radio" data-unit="${u}" aria-checked="${u === prefs.unit}">${UNIT_LABEL[u]}</button>`).join("")}</div>
          </div>
          <div class="ex-row ex-row-dpi">
            <label class="ex-field" data-ex-dpirow>Resolution <select data-ex="dpi" aria-label="Resolution, pixels per inch">${DPIS.map((d) => `<option value="${d}"${d === prefs.dpi ? " selected" : ""}>${d} ppi${d === 72 ? " · screen" : d === 96 ? " · CSS" : d === 300 ? " · print" : ""}</option>`).join("")}</select></label>
            <p class="ex-readout" data-ex-readout aria-live="polite"></p>
          </div>
          <p class="ex-hint" data-ex-dpi-hint hidden>Resolution counts for sizes in in, cm or mm and for PDF; a file in px only records it.</p>
          <div class="ex-row">
            <label class="ex-field">Padding <input type="number" data-ex="pad" min="0" max="1000" step="any" inputmode="decimal" value="${prefs.pad}" aria-label="Padding around it"></label>
            <div class="seg" role="radiogroup" aria-label="Padding unit" data-ex-padunits>${(["px", "%"] as const).map((u) => `<button type="button" role="radio" data-padunit="${u}" aria-checked="${u === prefs.padUnit}">${u}</button>`).join("")}</div>
          </div>
          <div class="ex-chips" role="group" aria-label="Sizes for this shape" data-ex-chips></div>
        </section>
        <section class="ex-sec" aria-label="File">
          ${multi || asOne ? `<div class="ex-row"><span class="ex-label" id="ex-out-l">Output</span><div class="seg" role="radiogroup" aria-labelledby="ex-out-l" data-ex-outputs><button type="button" role="radio" data-output="files" title="Each a file of its own, together in a ZIP" data-testid="export-each">Separate files</button><button type="button" role="radio" data-output="pdf" title="One PDF, a page for each">PDF pages</button>${canOne ? `<button type="button" role="radio" data-output="one" title="All of them as one picture" data-testid="export-together">One picture</button>` : ""}</div></div>` : ""}
          <div class="ex-row" data-ex-formatrow>
            <div class="seg" role="radiogroup" aria-label="Format" data-ex-formats>${(["png", "webp", "jpeg"] as const).map((f) => `<button type="button" role="radio" data-format="${f}" aria-checked="${f === prefs.format}">${f === "jpeg" ? "JPEG" : f.toUpperCase()}</button>`).join("")}${allVectors ? `<button type="button" role="radio" data-format="svg" aria-checked="${prefs.format === "svg"}" title="Stays sharp at any size">SVG</button>` : ""}${multi ? "" : `<button type="button" role="radio" data-format="pdf" aria-checked="${prefs.format === "pdf"}" title="One page for each picture, at the physical size; plain shapes stay vectors">PDF</button>`}</div>
            <label class="ex-field ex-quality" data-ex-quality>Quality <input type="range" data-ex="q" min="10" max="100" step="1" value="${prefs.quality}" aria-label="Quality"> <output data-ex-qout>${prefs.quality}%</output></label>
          </div>
          <div class="ex-row" data-ex-bgrow>
            <span class="ex-label" id="ex-bg-l">Background</span>
            <div class="seg" role="radiogroup" aria-labelledby="ex-bg-l" data-ex-bgs>${(["transparent", "white", "black"] as const).map((b) => `<button type="button" role="radio" data-bg="${b}" aria-checked="${b === prefs.bg}">${b[0]!.toUpperCase()}${b.slice(1)}</button>`).join("")}${deps.canvasColour ? `<button type="button" role="radio" data-bg="canvas" aria-checked="false" title="The canvas's own background colour">Canvas</button>` : ""}${deps.pickColour ? `<button type="button" role="radio" data-bg="pick" aria-checked="false" aria-haspopup="dialog" title="Any colour">Colour<span class="ex-swatch" data-ex-swatch></span></button>` : ""}</div>
          </div>
          <div class="ex-row ex-namerow">
            <label class="ex-field ex-name"><span data-ex-namelabel>Name</span> <input type="text" data-ex="name" spellcheck="false" autocomplete="off" maxlength="120" aria-label="File name: words and tokens"><span data-ex-ext class="ex-ext"></span></label>
            <select data-ex="namefmt" aria-label="Name formats: built-in and saved, or save this one" title="Name formats"></select>
          </div>
          <div class="ex-tokens" role="group" aria-label="Insert a token" data-ex-tokens>${NAME_TOKENS.map(([tok, what]) => `<button type="button" class="tag-chip is-suggest ex-token" data-token="${tok}" title="${esc(what)}">${tok}</button>`).join("")}</div>
          <p class="ex-names" data-ex-names data-testid="export-names" aria-live="polite"></p>
          <label class="ex-field ex-name" data-ex-packrow hidden><span data-ex-packlabel>ZIP name</span> <input type="text" data-ex="pack" spellcheck="false" autocomplete="off" maxlength="120" aria-label="Name of the ZIP or PDF"><span data-ex-packext class="ex-ext"></span></label>
          <div class="ex-row" data-ex-varrow><span class="ex-label" id="ex-var-l">Also</span><div class="seg" role="group" aria-labelledby="ex-var-l" data-ex-variants>${VARIANTS.filter(([v]) => v !== "svg" || allVectors).map(([v, label, tip]) => `<button type="button" role="checkbox" data-variant="${v}" aria-checked="${prefs.variants.includes(v)}" title="${esc(tip)}">${label}</button>`).join("")}</div></div>
        </section>
      </div>
    </div>
    <p class="ex-note" data-ex-note role="status" aria-live="polite"></p>
    <p class="ex-warn" data-ex-warn role="note" hidden></p>
    <footer class="ex-foot confirm-actions">
      <button type="button" data-ex="library" title="Keep it in the library of this workspace">${ICONS.save}<span>Save to library</span></button>
      <button type="button" data-ex="copy" title="Copy the picture to the clipboard (as PNG)">${ICONS.clipboardPlain}<span>Copy</span></button>
      <button type="button" class="is-primary" data-ex="download">${ICONS.download}<span>Download</span></button>
    </footer>`,
  });

  const q = <T extends HTMLElement>(sel: string): T => dlg.querySelector<T>(sel)!;
  scrubNumbers(dlg);
  const wIn = q<HTMLInputElement>('[data-ex="w"]'), hIn = q<HTMLInputElement>('[data-ex="h"]');
  const dpiSel = q<HTMLSelectElement>('[data-ex="dpi"]'), qIn = q<HTMLInputElement>('[data-ex="q"]'), nameIn = q<HTMLInputElement>('[data-ex="name"]');
  const note = q<HTMLElement>("[data-ex-note]"), readout = q<HTMLElement>("[data-ex-readout]"), chips = q<HTMLElement>("[data-ex-chips]");
  let thumbs: HTMLCanvasElement[] = [];
  /** A thing's name: one typed for it here, else its own. */
  const itemName = (i: number): string => own.get(raw[i]!) ?? raw[i]!.name;
  /** The places of the things that go (ticked), in order. */
  const chosen = (): number[] => raw.map((_, i) => i).filter((i) => !out.has(raw[i]!));
  /** Each ticked picture's number as it will leave; a dash on those left out; the count above them. */
  const renumber = (): void => {
    let n = 0;
    for (const f of dlg.querySelectorAll<HTMLElement>("[data-mini]")) {
      const i = Number(f.dataset["mini"]);
      const off = out.has(raw[i]!);
      f.classList.toggle("is-out", off);
      f.querySelector<HTMLInputElement>("[data-tick]")!.checked = !off;
      f.querySelector<HTMLElement>("[data-ex-page]")!.textContent = off ? "–" : String(++n);
    }
    const shape = dlg.querySelector<HTMLElement>('[data-testid="export-shape"] strong');
    if (shape && multi) shape.textContent = plural(n, noun.slice(0, -1));
    const count = dlg.querySelector<HTMLElement>("[data-ex-count]");
    if (count) count.textContent = n === raw.length ? `All ${plural(n, "item")}` : `${n} of ${raw.length} ${raw.length === 1 ? "item" : "items"}`;
  };
  /** The small pictures of several sheets, numbered as they will leave, each with buttons to move it earlier or later. */
  const drawMinis = (): void => {
    const box = dlg.querySelector<HTMLElement>("[data-ex-minis]");
    if (!box) {
      thumbs = [...dlg.querySelectorAll<HTMLCanvasElement>("[data-ex-thumb]")];
      return;
    }
    box.innerHTML = ts.map((x, i) => `<figure class="ex-mini${out.has(raw[i]!) ? " is-out" : ""}" data-mini="${i}" tabindex="0" draggable="true" title="Click to include it or leave it out (Ctrl+click several, Shift+click a run); drag to change its place"><div class="ex-frame" data-ex-frame style="--shape:${Math.min(Math.max(x.ratio, 0.2), 5)}"><canvas class="ex-thumb" data-ex-thumb aria-label="Preview of ${esc(itemName(i))}"></canvas><b class="ex-page" data-ex-page></b><input type="checkbox" class="ex-tick" data-tick tabindex="-1"${out.has(raw[i]!) ? "" : " checked"} aria-label="Include ${esc(itemName(i))}"></div><figcaption><button type="button" class="ex-move" data-move="-1" aria-label="Move ${esc(itemName(i))} earlier" ${i === 0 ? "disabled" : ""}>${ICONS.chevronLeft}</button><button type="button" class="ex-caption" data-rename title="Rename this file: ${esc(itemName(i))}">${esc(itemName(i))}</button><button type="button" class="ex-move" data-move="1" aria-label="Move ${esc(itemName(i))} later" ${i === ts.length - 1 ? "disabled" : ""}>${ICONS.chevronRight}</button></figcaption></figure>`).join("");
    renumber();
    thumbs = [...box.querySelectorAll<HTMLCanvasElement>("[data-ex-thumb]")];
  };
  drawMinis();
  const radios = (sel: string): HTMLElement[] => [...dlg.querySelectorAll<HTMLElement>(sel)];

  const px = (): { w: number; h: number; capped: boolean } => (whole && whole.w === widthPx ? { ...whole, capped: false } : clampSize(widthPx, widthPx / t.ratio));
  /** The pixel size of target `i` at the width chosen: its own height from its own shape (the first one's is `px()`). */
  const sizeOf = (i: number): { w: number; h: number } => {
    if (i === 0 && !multi) return px();
    if (ownSizes() && prefs.sizeRule === "width") return clampSize(ts[i]!.original!.w, ts[i]!.original!.h);
    const z = sizeByRule(prefs.sizeRule, prefs.sizeRule === "scale" ? scaleV : widthPx, ts[i]!.ratio, ts[i]!.world);
    return clampSize(z.w, z.h);
  };
  const ext = (): string => (prefs.format === "svg" ? "svg" : prefs.format === "pdf" ? "pdf" : SHOT_FORMATS[prefs.format].ext);

  const packIn = q<HTMLInputElement>('[data-ex="pack"]');
  /** Several things leave as files of their own (in a ZIP), not as the pages of one PDF. */
  const asFiles = (): boolean => multi && prefs.format !== "pdf";
  /** The name of each file (without its extension) for the things ticked, by the pattern; never two alike. */
  const stems = (): Map<number, string> => {
    const list = multi ? chosen() : [0];
    const canvas = deps.canvasName?.() ?? "canvas";
    const date = today();
    const raw0 = list.map((i, k) => {
      const z = sizeOf(i);
      return nameFrom(prefs.pattern || DEFAULT_PATTERN, { name: multi ? itemName(i) : own.get(raw[0]!) ?? t.name, n: k + 1, count: list.length, w: z.w, h: z.h, canvas, format: ext(), date });
    });
    const unique = uniqueNames(raw0);
    return new Map(list.map((i, k) => [i, unique[k]!]));
  };
  /** Every file this export makes, by name: each picture and its extra versions (a PDF of several is one file). */
  const fileNames = (): string[] => {
    if (multi && !asFiles()) return [`${packName()}.pdf`];
    const out: string[] = [];
    for (const stem of stems().values()) {
      out.push(`${stem}.${ext()}`);
      if (prefs.format !== "pdf") for (const v of prefs.variants) if (v !== "svg" || allVectors) out.push(variantName(stem, v, ext()));
    }
    return uniqueNames(out);
  };
  /** The ZIP's or the PDF's own name (several files, or one PDF of several). */
  const packName = (): string => replaceInvalid(packIn.value).trim() || `${slug(withoutExtension(itemName(chosen()[0] ?? 0)))}-and-${Math.max(0, chosen().length - 1)}-more`;
  const refreshName = (): void => {
    if (document.activeElement !== nameIn) nameIn.value = prefs.pattern || DEFAULT_PATTERN;
    const names = fileNames();
    const pack = multi || names.length > 1;
    const packExt = multi && !asFiles() ? "pdf" : "zip";
    q("[data-ex-ext]").textContent = multi && !asFiles() ? "" : `.${ext()}`;
    q("[data-ex-namelabel]").textContent = multi ? "File names" : "Name";
    q<HTMLElement>("[data-ex-packrow]").hidden = !pack;
    q("[data-ex-packlabel]").textContent = packExt === "pdf" ? "PDF name" : "ZIP name";
    q("[data-ex-packext]").textContent = `.${packExt}`;
    if (!packTouched) packIn.value = multi ? `${slug(withoutExtension(itemName(chosen()[0] ?? 0)))}-and-${Math.max(0, chosen().length - 1)}-more` : (stems().get(0) ?? "export");
    // (the name pattern names the files inside; a PDF of several is one file, named by its own field)
    const patternShown = !(multi && !asFiles());
    q<HTMLElement>(".ex-namerow").hidden = !patternShown;
    q<HTMLElement>("[data-ex-tokens]").hidden = !patternShown;
    const shownNames = names.slice(0, 3).map(esc).join(", ");
    q("[data-ex-names]").innerHTML = names.length ? `${pack ? `In <b>${esc(packName())}.${packExt}</b>: ` : ""}${shownNames}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : "Nothing is ticked.";
    q<HTMLElement>("[data-ex-varrow]").hidden = prefs.format === "pdf";
    for (const b of radios("[data-variant]")) b.setAttribute("aria-checked", String(prefs.variants.includes(b.dataset["variant"] as Variant)));
  };
  let packTouched = !!last?.name;

  // Previews: a single one is drawn at once; the pictures of several sheets are drawn small, one at a time, only when they are on screen (as the
  // list scrolls), and kept for as long as the background stays the same, so moving a page about redraws nothing.
  let thumbToken = 0;
  const cache = new Map<ExportTarget, HTMLCanvasElement>();
  let cacheBg: Background | "" = "";
  const seen = new Set<HTMLElement>();
  let observer: IntersectionObserver | null = null;
  const previewBg = (): Background => (prefs.format === "jpeg" || prefs.format === "svg" ? "white" : prefs.bg);
  const paintThumb = async (i: number, token: number): Promise<void> => {
    const x = ts[i]!, th = thumbs[i]!;
    const bg = previewBg();
    const edge = multi ? (ts.length > 8 ? 96 : 140) : PREVIEW_PX;
    const w = Math.max(8, Math.round(x.ratio >= 1 ? edge : edge * x.ratio)), h = Math.max(8, Math.round(w / x.ratio));
    try {
      let c = cache.get(x);
      if (!c) {
        c = await deps.render(x, w, h, bg);
        if (token !== thumbToken) return;
        cache.set(x, c);
      }
      th.width = w;
      th.height = h;
      th.getContext("2d")!.clearRect(0, 0, w, h);
      th.getContext("2d")!.drawImage(c, 0, 0);
      th.dataset["ready"] = "1";
      th.closest(".ex-frame")!.classList.toggle("is-checker", bg === "transparent");
      th.dataset["bg"] = bg;
    } catch {
      // no preview: the numbers still work
    }
  };
  const refreshThumb = async (): Promise<void> => {
    const token = ++thumbToken;
    if (cacheBg !== previewBg()) {
      cache.clear();
      cacheBg = previewBg();
    }
    for (let i = 0; i < thumbs.length; i++) {
      // (several sheets: only those on screen now; the others when they scroll into view)
      if (multi && observer && !seen.has(thumbs[i]!.closest<HTMLElement>("[data-mini]")!)) continue;
      await paintThumb(i, token);
      if (token !== thumbToken) return;
      if (multi) await new Promise((r) => setTimeout(r)); // (a breath between pictures: the dialog stays responsive)
    }
  };
  /** After the list is drawn again: watch which pictures are on screen. */
  const watchMinis = (): void => {
    observer?.disconnect();
    seen.clear();
    const box = dlg.querySelector<HTMLElement>("[data-ex-minis]");
    if (!box || typeof IntersectionObserver === "undefined") {
      for (const f of dlg.querySelectorAll<HTMLElement>("[data-mini]")) seen.add(f);
      return;
    }
    observer = new IntersectionObserver((entries) => {
      let any = false;
      for (const en of entries) {
        if (en.isIntersecting && !seen.has(en.target as HTMLElement)) {
          seen.add(en.target as HTMLElement);
          any = true;
        }
      }
      if (any) void refreshThumb();
    }, { root: box });
    for (const f of box.querySelectorAll<HTMLElement>("[data-mini]")) observer.observe(f);
  };

  watchMinis();

  // The sizes to press: as big as it is on screen (1× to 4×, one thing), then the widths and paper sizes its shape is made for (several: widths only,
  // as each has its own shape). Made again when the padding changes the shape.
  interface Chip { label: string; title: string; w: number; h: number; dpi: number | null; exact: boolean; k?: number }
  let suggestions: Chip[] = [];
  const onScreen = !multi && deps.screenSize ? deps.screenSize(raw[0]!) : null;
  /** The width of the file for `k` times its size on screen, with the padding. */
  const scaledWidth = (k: number): number => {
    const cw = onScreen!.w * k;
    return Math.max(1, Math.round(prefs.padUnit === "px" ? cw + 2 * prefs.pad : cw * (1 + (2 * prefs.pad * Math.max(raw[0]!.ratio, 1)) / 100 / raw[0]!.ratio)));
  };
  const buildChips = (): void => {
    if (multi && prefs.sizeRule === "scale") {
      suggestions = [1, 2, 3, 4].map((k): Chip => ({ label: `${k}×`, title: `${k}× its size on the canvas`, w: 0, h: 0, dpi: null, exact: false, k }));
      chips.innerHTML = suggestions.map((c, i) => `<button type="button" class="ex-chip" data-chip="${i}" aria-pressed="${c.k === scaleV}" title="${esc(c.title)}"><b>${esc(c.label)}</b><span>of its size</span></button>`).join("");
      return;
    }
    const sized = multi ? sizeSuggestions(1, 12).filter((c) => !c.exact).map((c) => ({ ...c, h: 0 })) : sizeSuggestions(t.ratio, 8);
    if (t.original && !multi) sized.unshift({ label: "Original", w: t.original.w, h: t.original.h, dpi: null, exact: true });
    const scaled = onScreen && onScreen.w > 0 ? [1, 2, 3, 4].map((k): Chip => { const w = scaledWidth(k); return { label: `${k}×`, title: `${k}× its size on screen`, w, h: Math.round(w / t.ratio), dpi: null, exact: false, k }; }) : [];
    suggestions = [...scaled, ...sized.map((c): Chip => ({ ...c, title: c.label }))];
    chips.innerHTML = suggestions.map((c, i) => `<button type="button" class="ex-chip${c.exact ? " is-exact" : ""}" data-chip="${i}" aria-pressed="false" title="${esc(c.title)}: ${c.h ? `${c.w} × ${c.h}` : c.w} px${c.dpi ? ` at ${c.dpi} ppi` : ""}"><b>${esc(c.label)}</b><span>${c.h ? `${c.w} × ${c.h}` : `${c.w} px`}</span></button>`).join("");
  };
  buildChips();
  chips.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-chip]");
    if (!b) return;
    const c = suggestions[Number(b.dataset["chip"])]!;
    if (multi && prefs.sizeRule === "scale") {
      scaleV = c.k ?? 1;
      for (const x of chips.querySelectorAll<HTMLElement>("[data-chip]")) x.setAttribute("aria-pressed", String(x === b));
      refresh();
      return;
    }
    widthPx = c.w;
    whole = c.k || prefs.pad > 0 ? null : { w: c.w, h: c.h };
    scaleK = c.k ?? null;
    if (c.dpi) {
      prefs.dpi = c.dpi;
      dpiSel.value = String(c.dpi);
    }
    refresh();
    void refreshThumb();
  });

  // Drag a picture to where it should go (the others move over): the same order as the buttons set.
  const moveTo = (from: number, to: number): void => {
    if (from === to || from < 0 || to < 0 || from >= ts.length || to >= ts.length) return;
    const next = [...raw];
    const [one] = next.splice(from, 1);
    next.splice(to, 0, one!);
    raw = next;
    fracs = "";
    pad();
    drawMinis();
    watchMinis();
    refresh();
    void refreshThumb();
  };
  let dragging = -1;
  const minis = dlg.querySelector<HTMLElement>("[data-ex-minis]");
  minis?.addEventListener("dragstart", (e) => {
    dragging = Number((e.target as HTMLElement).closest<HTMLElement>("[data-mini]")?.dataset["mini"] ?? -1);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(dragging));
    }
  });
  minis?.addEventListener("dragover", (e) => {
    if (dragging >= 0 && (e.target as HTMLElement).closest("[data-mini]")) e.preventDefault();
  });
  minis?.addEventListener("drop", (e) => {
    const to = Number((e.target as HTMLElement).closest<HTMLElement>("[data-mini]")?.dataset["mini"] ?? -1);
    e.preventDefault();
    if (dragging >= 0 && to >= 0) moveTo(dragging, to);
    dragging = -1;
  });
  minis?.addEventListener("dragend", () => (dragging = -1));
  dlg.querySelector("[data-ex-minis]")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-move]");
    const at = Number(b?.closest<HTMLElement>("[data-mini]")?.dataset["mini"]);
    if (!b || b.disabled || !Number.isInteger(at)) return;
    const to = at + Number(b.dataset["move"]);
    if (to < 0 || to >= ts.length) return;
    raw = raw.map((x, i, all) => (i === at ? all[to]! : i === to ? all[at]! : x)); // (the two change places)
    fracs = "";
    pad();
    drawMinis();
    watchMinis();
    refresh();
    void refreshThumb();
    dlg.querySelector<HTMLButtonElement>(`[data-mini="${to}"] [data-move="${b.dataset["move"]}"]`)?.focus();
  });

  /** Everything that follows from the width and the choices: the fields, the readout, the chips, the file name. */
  const refresh = (opts: { fields?: boolean } = {}): void => {
    const shapeWas = t.ratio;
    pad();
    if (t.ratio !== shapeWas) {
      buildChips();
      q<HTMLElement>("[data-ex-frame]")?.style.setProperty("--shape", String(Math.min(Math.max(t.ratio, 0.2), 5)));
      void refreshThumb();
    }
    const s = px();
    const u = prefs.unit;
    dlg.dataset["px"] = `${s.w}x${s.h}`; // (what the file will be: read by tests and by anyone inspecting)
    if (opts.fields !== false) {
      if (document.activeElement !== wIn) wIn.value = multi ? (prefs.sizeRule === "scale" ? String(scaleV) : shown(fromPx(widthPx, u, prefs.dpi), u)) : shown(fromPx(s.w, u, prefs.dpi), u);
      if (document.activeElement !== hIn) hIn.value = shown(fromPx(s.h, u, prefs.dpi), u);
    }
    if (multi) {
      q("[data-ex-wlabel]").textContent = prefs.sizeRule === "scale" ? "Scale (× its size on the canvas)" : prefs.sizeRule === "height" ? "Height of each" : prefs.sizeRule === "long" ? "Longest side of each" : "Width of each";
      q<HTMLElement>("[data-ex-units]").hidden = prefs.sizeRule === "scale";
      for (const b of radios("[data-rule]")) b.setAttribute("aria-checked", String(b.dataset["rule"] === prefs.sizeRule));
      const outNow = prefs.format === "pdf" ? "pdf" : "files";
      for (const b of radios("[data-output]")) b.setAttribute("aria-checked", String(b.dataset["output"] === outNow));
      q<HTMLElement>("[data-ex-formatrow]").hidden = prefs.format === "pdf";
      const none = chosen().length === 0;
      for (const k of ["download", "library"]) q<HTMLButtonElement>(`[data-ex="${k}"]`).disabled = busy || none;
    } else if (asOne) for (const b of radios("[data-output]")) b.setAttribute("aria-checked", String(b.dataset["output"] === "one"));
    wIn.step = hIn.step = u === "px" ? "1" : "any";
    const mp = (s.w * s.h) / 1e6;
    if (multi) {
      const on = chosen();
      readout.innerHTML = on.slice(0, 5).map((i) => `<span>${esc(itemName(i))}: <b>${sizeOf(i).w} × ${sizeOf(i).h} px</b></span>`).join("<br>") + (on.length > 5 ? `<br>+ ${on.length - 5} more` : "") + ` <span class="ex-at">at ${prefs.dpi} ppi</span>`;
    } else {
      // (the size in a print unit only when one is chosen, or for a PDF, whose pages are measured)
      const print: Unit = u === "px" ? "mm" : u;
      readout.innerHTML = `<b>${s.w} × ${s.h} px</b> · ${mp < 0.1 ? "<0.1" : mp.toFixed(mp < 10 ? 2 : 1)} MP${u !== "px" || prefs.format === "pdf" ? `<br>${shown(fromPx(s.w, print, prefs.dpi), print)} × ${shown(fromPx(s.h, print, prefs.dpi), print)} ${UNIT_LABEL[print]} <span class="ex-at">at ${prefs.dpi} ppi</span>` : ""}`;
      q("[data-ex-dim-w]").textContent = `${shown(fromPx(s.w, u, prefs.dpi), u)} ${UNIT_LABEL[u]}`;
      q("[data-ex-dim-h]").textContent = `${shown(fromPx(s.h, u, prefs.dpi), u)} ${UNIT_LABEL[u]}`;
    }
    // (the chips are made once: a press on one must not be lost to them being redrawn when the field it leaves fires its change)
    if (!(multi && prefs.sizeRule === "scale")) for (const b of chips.querySelectorAll<HTMLElement>("[data-chip]")) b.setAttribute("aria-pressed", String(suggestions[Number(b.dataset["chip"])]!.w === (multi ? widthPx : s.w)));
    note.textContent = s.capped ? `Capped at ${MAX_SIDE.toLocaleString("en")} px a side and ${(MAX_AREA / 1e6).toFixed(0)} MP: that is the most a picture can be.` : mp > 40 ? "A big picture: it can take a moment and a lot of memory." : "";
    const warn = prefs.format === "svg" ? (deps.svgWarning?.(ts) ?? null) : null;
    q("[data-ex-warn]").hidden = !warn;
    q("[data-ex-warn]").textContent = warn ? `⚠ ${warn}` : "";
    const lossy = prefs.format === "webp" || prefs.format === "jpeg";
    q("[data-ex-quality]").hidden = !lossy;
    q("[data-ex-bgrow]").hidden = prefs.format === "svg";
    const quietDpi = u === "px" && prefs.format !== "pdf";
    q("[data-ex-dpirow]").classList.toggle("is-quiet", quietDpi);
    q("[data-ex-dpi-hint]").hidden = !quietDpi;
    for (const b of radios("[data-padunit]")) b.setAttribute("aria-checked", String(b.dataset["padunit"] === prefs.padUnit));
    const canvasHex = deps.canvasColour?.() ?? null;
    const shownBg: Background = prefs.format === "jpeg" && prefs.bg === "transparent" ? "white" : prefs.bg;
    const own = HEX.test(shownBg) ? (shownBg === canvasHex ? "canvas" : "pick") : shownBg;
    dlg.querySelector<HTMLElement>("[data-ex-swatch]")?.style.setProperty("--swatch", HEX.test(shownBg) && own === "pick" ? shownBg : "transparent");
    q("[data-ex-quality]").hidden = !(lossy || prefs.format === "pdf");
    for (const b of radios("[data-bg]")) {
      b.setAttribute("aria-checked", String(b.dataset["bg"] === own));
      if (b.dataset["bg"] === "transparent") (b as HTMLButtonElement).disabled = prefs.format === "jpeg";
    }
    for (const b of radios("[data-unit]")) b.setAttribute("aria-checked", String(b.dataset["unit"] === u));
    for (const b of radios("[data-format]")) b.setAttribute("aria-checked", String(b.dataset["format"] === prefs.format));
    q<HTMLButtonElement>('[data-ex="copy"]').disabled = busy || multi || prefs.format === "pdf";
    q<HTMLButtonElement>('[data-ex="copy"]').title = multi || prefs.format === "pdf" ? "Copy works for one picture (PNG)" : "Copy the picture to the clipboard (as PNG)";
    refreshName();
  };

  // The two sides move together: the shape stays.
  const fromField = (which: "w" | "h"): void => {
    const v = Number(which === "w" ? wIn.value : hIn.value);
    if (!(v > 0) || !Number.isFinite(v)) return;
    if (multi && prefs.sizeRule === "scale") {
      scaleV = Math.min(64, Math.max(0.05, v));
      refresh({ fields: false });
      return;
    }
    const p = toPx(v, prefs.unit, prefs.dpi);
    whole = null;
    scaleK = null;
    widthPx = which === "w" ? p : p * t.ratio;
    refresh({ fields: false });
    if (which === "w") hIn.value = shown(fromPx(px().h, prefs.unit, prefs.dpi), prefs.unit);
    else wIn.value = shown(fromPx(px().w, prefs.unit, prefs.dpi), prefs.unit);
  };
  wIn.addEventListener("input", () => fromField("w"));
  hIn.addEventListener("input", () => fromField("h"));
  for (const el of [wIn, hIn]) el.addEventListener("change", () => { refresh(); void refreshThumb(); });
  dlg.addEventListener("keydown", (e) => {
    // arrows step a field by what is natural for its unit (shift: ten times)
    const el = e.target as HTMLElement;
    if ((el === wIn || el === hIn) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const step = (prefs.unit === "px" ? 1 : prefs.unit === "in" ? 0.1 : prefs.unit === "cm" ? 0.1 : 1) * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
      const input = el as HTMLInputElement;
      input.value = String(Math.max(0, Number(input.value) + step));
      fromField(el === wIn ? "w" : "h");
    }
  });
  q("[data-ex-units]").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-unit]");
    if (!b) return;
    prefs.unit = b.dataset["unit"] as Unit;
    refresh();
  });
  dpiSel.addEventListener("change", () => {
    const old = prefs.dpi;
    prefs.dpi = Number(dpiSel.value);
    // a physical size stays what it is (5 in is 5 in), so its pixels change; px stay px
    if (prefs.unit !== "px") {
      widthPx = (widthPx / old) * prefs.dpi;
      whole = null;
    }
    refresh();
    void refreshThumb();
  });
  q("[data-ex-formats]").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-format]");
    if (!b) return;
    prefs.format = b.dataset["format"] as Format;
    refresh();
    void refreshThumb();
  });
  const setBg = (bg: Background): void => {
    prefs.bg = bg;
    refresh();
    void refreshThumb();
  };
  q("[data-ex-bgs]").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-bg]");
    if (!b || b.disabled) return;
    const v = b.dataset["bg"]!;
    if (v === "canvas") return setBg(cleanBg(deps.canvasColour?.()));
    if (v === "pick") return deps.pickColour?.(b, HEX.test(prefs.bg) ? prefs.bg : "#ffffff", (hex) => setBg(cleanBg(hex.slice(0, 7))));
    setBg(v as Background);
  });
  const padIn = q<HTMLInputElement>('[data-ex="pad"]');
  padIn.addEventListener("input", () => {
    const v = Number(padIn.value);
    prefs.pad = v > 0 && Number.isFinite(v) ? Math.min(1000, v) : 0;
    if (scaleK !== null) widthPx = scaledWidth(scaleK);
    refresh();
  });
  padIn.addEventListener("change", () => void refreshThumb());
  q("[data-ex-padunits]").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-padunit]");
    if (!b) return;
    prefs.padUnit = b.dataset["padunit"] as PadUnit;
    if (scaleK !== null) widthPx = scaledWidth(scaleK);
    refresh();
    void refreshThumb();
  });
  // Presets: the saved choices of a kind of export (saved styles of the kind "export", in the workspace), and saving these.
  const presetSel = dlg.querySelector<HTMLSelectElement>('[data-ex="preset"]');
  let presetId: string | null = null;
  const current = (): ExportPreset => ({ format: prefs.format, quality: prefs.quality, bg: prefs.bg, unit: prefs.unit, dpi: prefs.dpi, pad: prefs.pad, padUnit: prefs.padUnit, size: scaleK !== null ? { k: scaleK } : multi ? null : { w: widthPx } });
  const showPresets = (): void => {
    if (!presetSel || !deps.presets) return;
    const list = deps.presets.list();
    const chosen = list.find((p) => p.id === presetId);
    presetSel.innerHTML = `<option value="">${chosen ? esc(chosen.name) : "Choose…"}</option>${list.length ? `<optgroup label="Presets">${list.map((p) => `<option value="p:${p.id}">${esc(p.name)} · ${esc(exportPresetSummary(p.data))}</option>`).join("")}</optgroup>` : ""}<optgroup label="Presets of these choices"><option value="save">Save these as a preset…</option>${chosen ? `<option value="update">Update “${esc(chosen.name)}”</option>` : ""}${list.length ? `<option value="manage">Manage presets…</option>` : ""}</optgroup>`;
    presetSel.value = "";
  };
  const usePreset = (p: ExportPreset): void => {
    prefs.format = p.format === "svg" && !allVectors ? "png" : p.format;
    prefs.quality = p.quality;
    qIn.value = String(p.quality);
    q("[data-ex-qout]").textContent = `${p.quality}%`;
    prefs.bg = p.bg;
    prefs.unit = p.unit;
    prefs.dpi = p.dpi;
    dpiSel.value = String(p.dpi);
    prefs.pad = p.pad;
    prefs.padUnit = p.padUnit;
    padIn.value = String(p.pad);
    scaleK = null;
    if (p.size && "k" in p.size && onScreen) {
      scaleK = p.size.k;
      widthPx = scaledWidth(p.size.k);
    } else if (p.size && "w" in p.size) widthPx = p.size.w;
    whole = null;
    refresh();
    void refreshThumb();
  };
  presetSel?.addEventListener("change", () => {
    const v = presetSel.value;
    presetSel.value = "";
    const list = deps.presets!.list();
    if (v.startsWith("p:")) {
      const p = list.find((x) => x.id === v.slice(2));
      if (p) {
        presetId = p.id;
        usePreset(p.data);
      }
    } else if (v === "save") void deps.presets!.save(current()).then((made) => { if (made) presetId = made.id; showPresets(); });
    else if (v === "update" && presetId) void deps.presets!.update(presetId, current()).then(showPresets);
    else if (v === "manage") {
      dlg.close();
      deps.presets!.manage();
    }
    showPresets();
  });
  showPresets();
  qIn.addEventListener("input", () => {
    prefs.quality = Number(qIn.value);
    q("[data-ex-qout]").textContent = `${prefs.quality}%`;
  });
  nameIn.addEventListener("input", () => {
    prefs.pattern = nameIn.value.trim() === DEFAULT_PATTERN ? "" : nameIn.value;
    refreshName();
  });
  packIn.addEventListener("input", () => {
    packTouched = true;
    refreshName();
  });
  // Tokens go in where the cursor is.
  q("[data-ex-tokens]").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-token]");
    if (!b) return;
    const at = nameIn.selectionStart ?? nameIn.value.length, to = nameIn.selectionEnd ?? at;
    nameIn.value = nameIn.value.slice(0, at) + b.dataset["token"]! + nameIn.value.slice(to);
    nameIn.focus();
    nameIn.setSelectionRange(at + b.dataset["token"]!.length, at + b.dataset["token"]!.length);
    nameIn.dispatchEvent(new Event("input"));
  });
  // Name formats: the built-in ones, those saved (styles of the workspace), and saving this one.
  const fmtSel = q<HTMLSelectElement>('[data-ex="namefmt"]');
  const showFormats = (): void => {
    const saved = deps.names?.list() ?? [];
    fmtSel.innerHTML = `<option value="">Formats…</option><optgroup label="Built in">${BUILT_IN_PATTERNS.map((pt) => `<option value="b:${esc(pt)}">${esc(pt)}</option>`).join("")}</optgroup>${saved.length ? `<optgroup label="Saved">${saved.map((s) => `<option value="b:${esc(s.pattern)}">${esc(s.name)} · ${esc(s.pattern)}</option>`).join("")}</optgroup>` : ""}${deps.names ? `<optgroup label="This format"><option value="save">Save it as a name format…</option>${saved.length ? `<option value="manage">Manage name formats…</option>` : ""}</optgroup>` : ""}`;
    fmtSel.value = "";
  };
  fmtSel.addEventListener("change", () => {
    const v = fmtSel.value;
    fmtSel.value = "";
    if (v.startsWith("b:")) {
      prefs.pattern = v.slice(2) === DEFAULT_PATTERN ? "" : v.slice(2);
      nameIn.value = v.slice(2);
      refresh();
    } else if (v === "save") void deps.names?.save(prefs.pattern || DEFAULT_PATTERN).then(showFormats);
    else if (v === "manage") {
      dlg.close();
      deps.names?.manage();
    }
  });
  showFormats();
  // Output of several: files of their own (a ZIP), the pages of one PDF, or all as one picture (the other dialog).
  dlg.querySelector("[data-ex-outputs]")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-output]");
    if (!b) return;
    const o = b.dataset["output"];
    if (multi) {
      if (o === "one") {
        savePrefs(prefs);
        dlg.close();
        return openTogether(deps);
      }
      prefs.format = o === "pdf" ? "pdf" : prefs.format === "pdf" ? "png" : prefs.format;
      refresh();
      void refreshThumb();
    } else if (asOne && o !== "one") {
      prefs.format = o === "pdf" ? "pdf" : prefs.format === "pdf" ? "png" : prefs.format;
      savePrefs(prefs);
      dlg.close();
      openEach(deps);
    }
  });
  dlg.querySelector("[data-ex-rules]")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-rule]");
    if (!b) return;
    prefs.sizeRule = b.dataset["rule"] as SizeRule;
    whole = null;
    buildChips();
    refresh();
  });
  q("[data-ex-variants]").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-variant]");
    if (!b) return;
    const v = b.dataset["variant"] as Variant;
    prefs.variants = prefs.variants.includes(v) ? prefs.variants.filter((x) => x !== v) : [...prefs.variants, v];
    refreshName();
  });
  // Ticks: what goes. A click on the box, Space on a picture, All and None; Delete leaves the picture out.
  const setOut = (i: number, off: boolean): void => {
    if (off) out.add(raw[i]!);
    else out.delete(raw[i]!);
  };
  const ticked = (): void => {
    renumber();
    refresh();
  };
  // A click anywhere on a picture ticks or unticks it (Ctrl or ⌘ as well, for one more); Shift+click sets every picture from the last one
  // clicked to this one as the last one is now. The arrows, the name and dragging keep their own jobs.
  let anchor = -1;
  const minisBox = dlg.querySelector<HTMLElement>("[data-ex-minis]");
  minisBox?.addEventListener("mousedown", (e) => {
    if (e.shiftKey && (e.target as HTMLElement).closest("[data-mini]")) e.preventDefault(); // (no text selected by a Shift+click)
  });
  minisBox?.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const fig = el.closest<HTMLElement>("[data-mini]");
    if (!fig || el.closest("[data-move], [data-rename], .ex-caption-edit")) return;
    const i = Number(fig.dataset["mini"]);
    if (e.shiftKey && anchor >= 0 && anchor < raw.length) {
      const off = out.has(raw[anchor]!);
      for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) setOut(k, off);
    } else {
      setOut(i, !out.has(raw[i]!));
      anchor = i;
    }
    ticked();
  });
  dlg.querySelector("[data-ex-minis]")?.addEventListener("keydown", (e) => {
    const f = e as KeyboardEvent;
    const fig = (f.target as HTMLElement).closest<HTMLElement>("[data-mini]");
    if (!fig || f.target !== fig) return;
    const i = Number(fig.dataset["mini"]);
    if (f.key === " ") setOut(i, !out.has(raw[i]!));
    else if (f.key === "Delete" || f.key === "Backspace") setOut(i, true);
    else return;
    f.preventDefault();
    ticked();
  });
  dlg.querySelector("[data-ex-pick]")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ex]");
    if (!b || (b.dataset["ex"] !== "all" && b.dataset["ex"] !== "none")) return;
    raw.forEach((_, i) => setOut(i, b.dataset["ex"] === "none"));
    ticked();
  });
  // A picture's own name: its caption is a button that becomes a field.
  dlg.querySelector("[data-ex-minis]")?.addEventListener("click", (e) => {
    const cap = (e.target as HTMLElement).closest<HTMLElement>("[data-rename]");
    const i = Number(cap?.closest<HTMLElement>("[data-mini]")?.dataset["mini"]);
    if (!cap || !Number.isInteger(i)) return;
    const field = document.createElement("input");
    field.type = "text";
    field.className = "ex-caption-edit";
    field.value = itemName(i);
    field.maxLength = 120;
    field.setAttribute("aria-label", `Name of ${itemName(i)}`);
    cap.replaceWith(field);
    field.focus();
    field.select();
    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const v = field.value.trim();
      if (keep) {
        if (v && v !== raw[i]!.name) own.set(raw[i]!, v);
        else own.delete(raw[i]!);
      }
      drawMinis();
      watchMinis();
      refresh();
      void refreshThumb();
    };
    field.addEventListener("keydown", (k) => {
      if (k.key === "Enter") (k.preventDefault(), k.stopPropagation(), finish(true));
      else if (k.key === "Escape") (k.preventDefault(), k.stopPropagation(), finish(false));
    });
    field.addEventListener("blur", () => finish(true));
  });

  interface Made { name: string; blob: Blob; mime: string }
  const sizeText = (i: number): { w: string; h: string } => {
    const z = sizeOf(i), u = prefs.unit;
    const one = (v: number): string => `${shown(fromPx(v, u, prefs.dpi), u)}${u === "px" ? "" : u}`;
    return { w: one(z.w), h: one(z.h) };
  };
  /** The files, each made at the size asked for (one for each sheet; a PDF is one file with a page for each). */
  const make = async (as: Format): Promise<Made[]> => {
    const bgFor = (f: Format): Background => (f === "jpeg" && prefs.bg === "transparent" ? "white" : prefs.bg);
    const names = stems();
    const list = multi ? chosen() : [0];
    if (as === "pdf") {
      const pages = [];
      for (const i of list) {
        const z = sizeOf(i);
        const wPt = (z.w / prefs.dpi) * 72, hPt = (z.h / prefs.dpi) * 72;
        const vec = deps.pdfVector(ts[i]!, wPt, hPt);
        if (vec) {
          pages.push(pdfVectorPage(wPt, hPt, vec));
          continue;
        }
        const bg = prefs.bg;
        const canvas = await deps.render(ts[i]!, z.w, z.h, bg);
        const jpeg = bg === "transparent" ? null : new Uint8Array(await (await encodeShot(canvas, "jpeg", prefs.quality)).blob.arrayBuffer());
        pages.push(pdfPageOf(canvas, wPt, hPt, jpeg));
      }
      return [{ name: `${multi ? packName() : names.get(0)!}.pdf`, blob: await pdfOf(pages), mime: "application/pdf" }];
    }
    const made: Made[] = [];
    /** One picture of target `i` at `k` times its size, encoded as `as`. */
    const picture = async (i: number, k: number): Promise<{ blob: Blob; ext: string; mime: string }> => {
      const z0 = sizeOf(i), z = k === 1 ? z0 : clampSize(z0.w * k, z0.h * k);
      const canvas = await deps.render(ts[i]!, z.w, z.h, bgFor(as));
      const enc = await encodeShot(canvas, as as ShotFormat, prefs.quality);
      // (the print resolution goes into the file: a 5 in picture says 5 in)
      const blob = enc.format === "png" ? await pngWithDpi(enc.blob, prefs.dpi * k) : enc.format === "jpeg" ? await jpegWithDpi(enc.blob, prefs.dpi * k) : enc.format === "webp" ? await webpWithDpi(enc.blob, prefs.dpi * k) : enc.blob;
      return { blob, ext: SHOT_FORMATS[enc.format].ext, mime: SHOT_FORMATS[enc.format].mime };
    };
    const svgOf = (i: number): Blob => {
      const svg = deps.svg(ts[i]!, sizeText(i));
      if (!svg) throw new Error("this cannot be made as SVG");
      return new Blob([svg], { type: "image/svg+xml" });
    };
    for (const i of list) {
      const stem = names.get(i)!;
      if (as === "svg") made.push({ name: `${stem}.svg`, blob: svgOf(i), mime: "image/svg+xml" });
      else {
        const one = await picture(i, 1);
        made.push({ name: `${stem}.${one.ext}`, blob: one.blob, mime: one.mime });
      }
      // the extra versions of it: bigger copies, and its vectors as an SVG
      for (const v of prefs.variants) {
        if (v === "svg") {
          if (as !== "svg" && ts[i]!.vectors) made.push({ name: variantName(stem, "svg", "svg"), blob: svgOf(i), mime: "image/svg+xml" });
          continue;
        }
        if (as === "svg") continue;
        const big = await picture(i, variantScale(v));
        made.push({ name: variantName(stem, v, big.ext), blob: big.blob, mime: big.mime });
      }
    }
    const unique = uniqueNames(made.map((m) => m.name));
    return made.map((m, k) => ({ ...m, name: unique[k]! }));
  };
  const size = (b: Blob): string => (b.size < 1024 * 1024 ? `${Math.max(1, Math.round(b.size / 1024))} KB` : `${(b.size / 1024 / 1024).toFixed(1)} MB`);
  const save = (blob: Blob, name: string): void => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };

  const run = async (what: "download" | "copy" | "library"): Promise<void> => {
    if (busy) return;
    busy = true;
    dlg.classList.add("is-busy");
    note.textContent = "Making the picture…";
    try {
      const s = px();
      if (what === "copy") {
        const [made] = await make("png");
        if ((await writeSystemClipboard({ image: made!.blob })) !== "image") throw new Error("the clipboard refused");
        forgetCopiedPicture(); // (what canvast copied before is not on the clipboard any more)
        note.textContent = `Copied ${s.w} × ${s.h} px (${size(made!.blob)}).`;
        prefs.action = "copy";
      } else {
        const files = await make(prefs.format);
        if (what === "download") {
          if (files.length === 1) {
            save(files[0]!.blob, files[0]!.name);
            note.textContent = `Saved “${files[0]!.name}”: ${prefs.format === "svg" ? "vector" : prefs.format === "pdf" ? `${ts.length} page${ts.length === 1 ? "" : "s"}` : `${s.w} × ${s.h} px`}, ${size(files[0]!.blob)}.`;
          } else {
            const zip = await writeZip(files.map((f) => ({ name: f.name, data: f.blob })));
            save(zip, `${packName()}.zip`);
            note.textContent = `Saved “${packName()}.zip”: ${plural(files.length, "file")}, ${size(zip)}.`;
          }
        } else {
          for (const f of files) await deps.toLibrary(new File([f.blob], f.name, { type: f.mime }), ts);
          note.textContent = `Kept ${files.length === 1 ? `“${files[0]!.name}”` : `${files.length} files`} in the library (${size(new Blob(files.map((f) => f.blob)))}).`;
        }
      }
      if (what !== "copy") prefs.action = what;
      savePrefs(prefs);
      keepLast(key, { ...prefs, widthPx, ...(packTouched ? { name: packIn.value } : {}) });
    } catch (err) {
      note.textContent = `Could not export: ${(err as Error).message}`;
    } finally {
      busy = false;
      dlg.classList.remove("is-busy");
    }
  };

  dlg.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ex]");
    if (!b) return;
    const k = b.dataset["ex"];
    if (k === "each" || k === "together") {
      dlg.close();
      return k === "each" ? openEach(deps) : openTogether(deps);
    }
    if (k === "close") dlg.close();
    else if (k === "download" || k === "copy" || k === "library") void run(k);
  });
  // Enter exports as last time (Download at first); Ctrl+C copies, unless words are selected in a field.
  dlg.addEventListener("keydown", (e) => {
    const el = e.target as HTMLElement;
    if (el.closest(".colour-pop, .pop-menu")) return; // (a colour or a menu opened from the dialog keeps its keys)
    if (e.key === "Enter" && !e.isComposing && !el.closest("button, select, textarea, [role=radio]")) {
      e.preventDefault();
      if (el === wIn || el === hIn) fromField(el === wIn ? "w" : "h");
      refresh();
      const action = prefs.action === "copy" && (multi || prefs.format === "pdf") ? "download" : prefs.action;
      void run(action);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !e.shiftKey && !e.altKey) {
      const field = el as HTMLInputElement;
      if (el.matches("input, textarea") && field.selectionStart !== field.selectionEnd) return;
      if (q<HTMLButtonElement>('[data-ex="copy"]').disabled) return;
      e.preventDefault();
      void run("copy");
    }
  });
  if (last?.name) packIn.value = last.name;
  refresh();
  if (again) {
    // Export again: as last time, with no dialog to see; what happened is said as a notice.
    const action = prefs.action === "copy" && (multi || prefs.format === "pdf") ? "download" : prefs.action;
    void run(action).then(() => {
      deps.say(note.textContent || "Exported again.");
      dlg.remove();
    });
    return;
  }
  showModal(dlg, () => savePrefs(prefs));
  void refreshThumb();
  wIn.focus();
  wIn.select();
}
