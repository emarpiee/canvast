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
import { ICONS } from "./icons";

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
}

type Format = ShotFormat | "svg" | "pdf";
type Action = "download" | "copy" | "library";
type PadUnit = "px" | "%";
interface Prefs {
  unit: Unit;
  dpi: number;
  format: Format;
  quality: number;
  bg: Background;
  /** Room around what is exported, in px of the file or % of its longer side. */
  pad: number;
  padUnit: PadUnit;
  /** What Enter and Export again do. */
  action: Action;
}
const DEFAULTS: Prefs = { unit: "px", dpi: 300, format: "png", quality: 92, bg: "transparent", pad: 0, padUnit: "px", action: "download" };
const HEX = /^#[0-9a-f]{6}$/i;
const cleanBg = (v: unknown): Background => (v === "white" || v === "black" || v === "transparent" ? v : typeof v === "string" && HEX.test(v) ? (v.toLowerCase() as Background) : DEFAULTS.bg);
const KEY = "canvast.export";

const loadPrefs = (): Prefs => {
  try {
    return loadPrefsFrom(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>);
  } catch {
    return DEFAULTS;
  }
};
function loadPrefsFrom(raw: Partial<Record<keyof Prefs, unknown>>): Prefs {
  {
    return {
      unit: UNITS.includes(raw.unit as Unit) ? (raw.unit as Unit) : DEFAULTS.unit,
      dpi: DPIS.includes(Number(raw.dpi)) ? Number(raw.dpi) : DEFAULTS.dpi,
      format: raw.format === "png" || raw.format === "webp" || raw.format === "jpeg" || raw.format === "svg" || raw.format === "pdf" ? raw.format : DEFAULTS.format,
      quality: Math.min(100, Math.max(10, Number(raw.quality) || DEFAULTS.quality)),
      bg: cleanBg(raw.bg),
      pad: Math.min(1000, Math.max(0, Number(raw.pad) || 0)),
      padUnit: raw.padUnit === "%" ? "%" : "px",
      action: raw.action === "copy" || raw.action === "library" ? raw.action : "download",
    };
  }
}
const savePrefs = (p: Prefs): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // a browser that keeps nothing: the choices last for this dialog
  }
};

/** What an export preset keeps (a saved style of the kind "export"): the choices, and a size as a width or as times its size on screen. */
export interface ExportPreset {
  readonly format: Format;
  readonly quality: number;
  readonly bg: Background;
  readonly unit: Unit;
  readonly dpi: number;
  readonly pad: number;
  readonly padUnit: PadUnit;
  readonly size: { readonly w: number } | { readonly k: number } | null;
}
/** An export preset from stored data, or null. */
export function cleanExportPreset(d: unknown): ExportPreset | null {
  const r = d as Partial<Record<keyof ExportPreset, unknown>> | null;
  if (!r || typeof r !== "object") return null;
  const p = loadPrefsFrom(r);
  const z = r.size as { w?: unknown; k?: unknown } | null | undefined;
  const size = z && Number(z.k) > 0 && Number(z.k) <= 16 ? { k: Number(z.k) } : z && Number(z.w) >= 1 && Number(z.w) <= MAX_SIDE ? { w: Math.round(Number(z.w)) } : null;
  return { format: p.format, quality: p.quality, bg: p.bg, unit: p.unit, dpi: p.dpi, pad: p.pad, padUnit: p.padUnit, size };
}
/** One line about a preset. */
export const exportPresetSummary = (p: ExportPreset): string =>
  [p.format.toUpperCase(), p.size ? ("k" in p.size ? `${p.size.k}× on screen` : `${p.size.w} px wide`) : "", p.pad ? `padding ${p.pad} ${p.padUnit}` : "", p.bg === "transparent" ? "" : p.bg].filter(Boolean).join(" · ");

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
  let nameTouched = !!last?.name;
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
        ${deps.each?.length ? `<button type="button" class="adj-map-edit" data-ex="each" data-testid="export-each">Each on its own (${deps.each.length} pages or files)</button>` : deps.together ? `<button type="button" class="adj-map-edit" data-ex="together" data-testid="export-together">All as one picture</button>` : ""}
        <p class="ex-shape" data-testid="export-shape">${multi ? `<strong>${ts.length} ${noun}</strong> <span>· ${ownSizes() ? "each at its own pixels, until you set a width" : "each at this width, its own shape"}</span>` : `Shape <strong>${esc(formatRatio(t.ratio))}</strong>${preset ? ` <span>· ${esc(preset.short)}</span>` : ""}`}</p>
      </div>
      <div class="ex-panel">
        ${deps.presets ? `<label class="ex-field ex-preset">Preset <select data-ex="preset" aria-label="Export preset: saved choices, or save these"></select></label>` : ""}
        <section class="ex-sec" aria-label="Size">
          <div class="ex-row">
            <label class="ex-field">${multi ? "Width of each" : "Width"} <input type="number" data-ex="w" min="0" step="any" inputmode="decimal" aria-label="Width"></label>
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
          <div class="ex-row">
            <div class="seg" role="radiogroup" aria-label="Format" data-ex-formats>${(["png", "webp", "jpeg"] as const).map((f) => `<button type="button" role="radio" data-format="${f}" aria-checked="${f === prefs.format}">${f === "jpeg" ? "JPEG" : f.toUpperCase()}</button>`).join("")}${allVectors ? `<button type="button" role="radio" data-format="svg" aria-checked="${prefs.format === "svg"}" title="Stays sharp at any size">SVG</button>` : ""}<button type="button" role="radio" data-format="pdf" aria-checked="${prefs.format === "pdf"}" title="One page for each picture, at the physical size; plain shapes stay vectors">PDF</button></div>
            <label class="ex-field ex-quality" data-ex-quality>Quality <input type="range" data-ex="q" min="10" max="100" step="1" value="${prefs.quality}" aria-label="Quality"> <output data-ex-qout>${prefs.quality}%</output></label>
          </div>
          <div class="ex-row" data-ex-bgrow>
            <span class="ex-label" id="ex-bg-l">Background</span>
            <div class="seg" role="radiogroup" aria-labelledby="ex-bg-l" data-ex-bgs>${(["transparent", "white", "black"] as const).map((b) => `<button type="button" role="radio" data-bg="${b}" aria-checked="${b === prefs.bg}">${b[0]!.toUpperCase()}${b.slice(1)}</button>`).join("")}${deps.canvasColour ? `<button type="button" role="radio" data-bg="canvas" aria-checked="false" title="The canvas's own background colour">Canvas</button>` : ""}${deps.pickColour ? `<button type="button" role="radio" data-bg="pick" aria-checked="false" aria-haspopup="dialog" title="Any colour">Colour<span class="ex-swatch" data-ex-swatch></span></button>` : ""}</div>
          </div>
          <label class="ex-field ex-name">Name <input type="text" data-ex="name" spellcheck="false" autocomplete="off" aria-label="File name"><span data-ex-ext class="ex-ext"></span></label>
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
  /** The small pictures of several sheets, numbered as they will leave, each with buttons to move it earlier or later. */
  const drawMinis = (): void => {
    const box = dlg.querySelector<HTMLElement>("[data-ex-minis]");
    if (!box) {
      thumbs = [...dlg.querySelectorAll<HTMLCanvasElement>("[data-ex-thumb]")];
      return;
    }
    box.innerHTML = ts.map((x, i) => `<figure class="ex-mini" data-mini="${i}" draggable="true" title="Drag to change its place"><div class="ex-frame" data-ex-frame style="--shape:${Math.min(Math.max(x.ratio, 0.2), 5)}"><canvas class="ex-thumb" data-ex-thumb aria-label="Preview of ${esc(x.name)}"></canvas><b class="ex-page">${i + 1}</b></div><figcaption><button type="button" class="ex-move" data-move="-1" aria-label="Move ${esc(x.name)} earlier" ${i === 0 ? "disabled" : ""}>${ICONS.chevronLeft}</button><span>${esc(x.name)}</span><button type="button" class="ex-move" data-move="1" aria-label="Move ${esc(x.name)} later" ${i === ts.length - 1 ? "disabled" : ""}>${ICONS.chevronRight}</button></figcaption></figure>`).join("");
    thumbs = [...box.querySelectorAll<HTMLCanvasElement>("[data-ex-thumb]")];
  };
  drawMinis();
  const radios = (sel: string): HTMLElement[] => [...dlg.querySelectorAll<HTMLElement>(sel)];

  const px = (): { w: number; h: number; capped: boolean } => (whole && whole.w === widthPx ? { ...whole, capped: false } : clampSize(widthPx, widthPx / t.ratio));
  /** The pixel size of target `i` at the width chosen: its own height from its own shape (the first one's is `px()`). */
  const sizeOf = (i: number): { w: number; h: number } => (i === 0 && !multi ? px() : ownSizes() ? clampSize(ts[i]!.original!.w, ts[i]!.original!.h) : clampSize(widthPx, widthPx / ts[i]!.ratio));
  const ext = (): string => (prefs.format === "svg" ? "svg" : prefs.format === "pdf" ? "pdf" : SHOT_FORMATS[prefs.format].ext);

  const refreshName = (): void => {
    const s = px();
    if (!nameTouched) nameIn.value = multi ? `${slug(t.name)}-and-${ts.length - 1}-more` : `${slug(t.name)}-${prefs.format === "svg" ? "vector" : `${s.w}x${s.h}`}`;
    q("[data-ex-ext]").textContent = `.${ext()}`;
  };

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
      if (document.activeElement !== wIn) wIn.value = shown(fromPx(s.w, u, prefs.dpi), u);
      if (document.activeElement !== hIn) hIn.value = shown(fromPx(s.h, u, prefs.dpi), u);
    }
    wIn.step = hIn.step = u === "px" ? "1" : "any";
    const mp = (s.w * s.h) / 1e6;
    if (multi) {
      readout.innerHTML = ts.slice(0, 5).map((x, i) => `<span>${esc(x.name)}: <b>${sizeOf(i).w} × ${sizeOf(i).h} px</b></span>`).join("<br>") + (ts.length > 5 ? `<br>+ ${ts.length - 5} more` : "") + ` <span class="ex-at">at ${prefs.dpi} ppi</span>`;
    } else {
      // (the size in a print unit only when one is chosen, or for a PDF, whose pages are measured)
      const print: Unit = u === "px" ? "mm" : u;
      readout.innerHTML = `<b>${s.w} × ${s.h} px</b> · ${mp < 0.1 ? "<0.1" : mp.toFixed(mp < 10 ? 2 : 1)} MP${u !== "px" || prefs.format === "pdf" ? `<br>${shown(fromPx(s.w, print, prefs.dpi), print)} × ${shown(fromPx(s.h, print, prefs.dpi), print)} ${UNIT_LABEL[print]} <span class="ex-at">at ${prefs.dpi} ppi</span>` : ""}`;
      q("[data-ex-dim-w]").textContent = `${shown(fromPx(s.w, u, prefs.dpi), u)} ${UNIT_LABEL[u]}`;
      q("[data-ex-dim-h]").textContent = `${shown(fromPx(s.h, u, prefs.dpi), u)} ${UNIT_LABEL[u]}`;
    }
    // (the chips are made once: a press on one must not be lost to them being redrawn when the field it leaves fires its change)
    for (const b of chips.querySelectorAll<HTMLElement>("[data-chip]")) b.setAttribute("aria-pressed", String(suggestions[Number(b.dataset["chip"])]!.w === s.w));
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
  nameIn.addEventListener("input", () => (nameTouched = true));

  interface Made { name: string; blob: Blob; mime: string }
  const base = (): string => replaceInvalid(nameIn.value).trim() || slug(t.name);
  const sizeText = (i: number): { w: string; h: string } => {
    const z = sizeOf(i), u = prefs.unit;
    const one = (v: number): string => `${shown(fromPx(v, u, prefs.dpi), u)}${u === "px" ? "" : u}`;
    return { w: one(z.w), h: one(z.h) };
  };
  /** The files, each made at the size asked for (one for each sheet; a PDF is one file with a page for each). */
  const make = async (as: Format): Promise<Made[]> => {
    const bgFor = (f: Format): Background => (f === "jpeg" && prefs.bg === "transparent" ? "white" : prefs.bg);
    const stem = (i: number, e: string, withSize: boolean): string => (multi ? `${i + 1}-${slug(ts[i]!.name)}${withSize ? `-${sizeOf(i).w}x${sizeOf(i).h}` : ""}.${e}` : `${base()}.${e}`);
    if (as === "pdf") {
      const pages = [];
      for (let i = 0; i < ts.length; i++) {
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
      return [{ name: `${base()}.pdf`, blob: await pdfOf(pages), mime: "application/pdf" }];
    }
    const out: Made[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (as === "svg") {
        const svg = deps.svg(ts[i]!, sizeText(i));
        if (!svg) throw new Error("this cannot be made as SVG");
        out.push({ name: stem(i, "svg", false), blob: new Blob([svg], { type: "image/svg+xml" }), mime: "image/svg+xml" });
        continue;
      }
      const z = sizeOf(i);
      const canvas = await deps.render(ts[i]!, z.w, z.h, bgFor(as));
      const enc = await encodeShot(canvas, as, prefs.quality);
      // (the print resolution goes into the file: a 5 in picture says 5 in)
      const blob = enc.format === "png" ? await pngWithDpi(enc.blob, prefs.dpi) : enc.format === "jpeg" ? await jpegWithDpi(enc.blob, prefs.dpi) : enc.format === "webp" ? await webpWithDpi(enc.blob, prefs.dpi) : enc.blob;
      out.push({ name: stem(i, SHOT_FORMATS[enc.format].ext, true), blob, mime: SHOT_FORMATS[enc.format].mime });
    }
    return out;
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
            save(zip, `${base()}.zip`);
            note.textContent = `Saved “${base()}.zip”: ${plural(files.length, "picture")}, ${size(zip)}.`;
          }
        } else {
          for (const f of files) await deps.toLibrary(new File([f.blob], f.name, { type: f.mime }), ts);
          note.textContent = `Kept ${files.length === 1 ? `“${files[0]!.name}”` : `${files.length} files`} in the library (${size(new Blob(files.map((f) => f.blob)))}).`;
        }
      }
      if (what !== "copy") prefs.action = what;
      savePrefs(prefs);
      keepLast(key, { ...prefs, widthPx, ...(nameTouched ? { name: nameIn.value } : {}) });
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
  if (last?.name) nameIn.value = last.name;
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
