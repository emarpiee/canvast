/**
 * The Export dialog (ADR 0147). What is exported has a shape (its ratio) and no size: here the size is chosen, in px, inches, centimetres
 * or millimetres at a resolution, and every other length follows from the ratio. Pick one of the sizes the shape is made for (A4, Full HD,
 * a story, the picture's own pixels …), or type a width or a height; the preview shows the shape with its measures, and the file is
 * made at exactly that size. PNG, WebP and JPEG; SVG too when everything is vector.
 */
import { scrubNumbers } from "../colour-picker/scrub";
import type { Background, ExportTarget } from "../app/export-render";
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
  /** A target drawn at `w` × `h` px. */
  render(t: ExportTarget, w: number, h: number, bg: Background): Promise<HTMLCanvasElement>;
  /** The vectors of a target as SVG text of this size (width and height as SVG writes them), or null when it cannot be. */
  svg(t: ExportTarget, size: { w: string; h: string }): string | null;
  /** The vectors of a target as a PDF page of this size in points (ADR 0153), or null when the page needs a picture. */
  pdfVector(t: ExportTarget, wPt: number, hPt: number): PdfVector | null;
  /** Put the file in the library (and tell the person, with a way to see it). */
  toLibrary(file: File, targets: readonly ExportTarget[]): Promise<void>;
  /** A message for the person (the notice stack). */
  say(text: string): void;
}

type Format = ShotFormat | "svg" | "pdf";
interface Prefs {
  unit: Unit;
  dpi: number;
  format: Format;
  quality: number;
  bg: Background;
}
const DEFAULTS: Prefs = { unit: "px", dpi: 300, format: "png", quality: 92, bg: "transparent" };
const KEY = "canvast.export";

const loadPrefs = (): Prefs => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return {
      unit: UNITS.includes(raw.unit as Unit) ? (raw.unit as Unit) : DEFAULTS.unit,
      dpi: DPIS.includes(Number(raw.dpi)) ? Number(raw.dpi) : DEFAULTS.dpi,
      format: raw.format === "png" || raw.format === "webp" || raw.format === "jpeg" || raw.format === "svg" || raw.format === "pdf" ? raw.format : DEFAULTS.format,
      quality: Math.min(100, Math.max(10, Number(raw.quality) || DEFAULTS.quality)),
      bg: raw.bg === "white" || raw.bg === "black" || raw.bg === "transparent" ? raw.bg : DEFAULTS.bg,
    };
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

const slug = (s: string): string => s.normalize("NFC").toLowerCase().replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").replace(/^[.\-_]+|[.\-_]+$/g, "") || "export";
const UNIT_LABEL: Record<Unit, string> = { px: "px", in: "in", cm: "cm", mm: "mm" };
const decimals = (u: Unit): number => (u === "px" ? 0 : u === "in" ? 2 : 1);
const shown = (v: number, u: Unit): string => String(Number(v.toFixed(decimals(u))));
const PREVIEW_PX = 320;

export function openExportDialog(deps: ExportDeps): void {
  let ts = [...deps.targets]; // (in the order the pictures leave: the pages of a PDF, the files of a ZIP; the person can change it)
  const t = ts[0]!;
  const multi = ts.length > 1;
  const allVectors = ts.every((x) => x.vectors);
  const prefs = loadPrefs();
  if (prefs.format === "svg" && !allVectors) prefs.format = "png";
  // To begin with: the picture's own pixels, else the first size the shape is made for (A4, Full HD …), else the longer side 1920 px.
  const startW = t.ratio >= 1 ? 1920 : 1920 * t.ratio;
  const exact = multi ? undefined : sizeSuggestions(t.ratio, 8).find((s) => s.exact);
  let widthPx = t.original && !multi ? t.original.w : (exact?.w ?? (multi ? 1080 : startW));
  // A size the shape is made for is taken whole (2480 × 3508 for A4), not worked out from a ratio that may differ in the last digit.
  let whole: { w: number; h: number } | null = multi ? null : t.original ? { w: t.original.w, h: t.original.h } : exact ? { w: exact.w, h: exact.h } : null;
  let nameTouched = false;
  let busy = false;

  const dlg = document.createElement("dialog");
  dlg.className = multi ? "export-dlg is-multi" : "export-dlg";
  dlg.dataset["testid"] = "export-dialog";
  dlg.setAttribute("aria-labelledby", "ex-title");
  const preset = presetOf(t.ratio);
  dlg.innerHTML = `
    <header class="ex-head">
      <h2 id="ex-title">Export <span class="ex-what">${multi ? `${ts.length} sheets` : esc(t.name)}</span></h2>
      <button type="button" class="ex-x" data-ex="close" aria-label="Close">${ICONS.x}</button>
    </header>
    <div class="ex-body">
      <div class="ex-stage">
        ${multi ? `<div class="ex-minis" data-ex-minis></div>` : `<div class="ex-frame" data-ex-frame style="--shape:${Math.min(Math.max(t.ratio, 0.2), 5)}">
          <canvas class="ex-thumb" data-ex-thumb aria-label="Preview"></canvas>
          <span class="ex-dim ex-dim-w" data-ex-dim-w></span>
          <span class="ex-dim ex-dim-h" data-ex-dim-h></span>
        </div>`}
        <p class="ex-shape" data-testid="export-shape">${multi ? `<strong>${ts.length} sheets</strong> <span>· each at this width, its own shape</span>` : `Shape <strong>${esc(formatRatio(t.ratio))}</strong>${preset ? ` <span>· ${esc(preset.short)}</span>` : ""}`}</p>
      </div>
      <div class="ex-panel">
        <section class="ex-sec" aria-label="Size">
          <div class="ex-row">
            <label class="ex-field">${multi ? "Width of each" : "Width"} <input type="number" data-ex="w" min="0" step="any" inputmode="decimal" aria-label="Width"></label>
            <span class="ex-times"${multi ? " hidden" : ""} title="The shape stays: change one side and the other follows" aria-hidden="true">×</span>
            <label class="ex-field"${multi ? " hidden" : ""}>Height <input type="number" data-ex="h" min="0" step="any" inputmode="decimal" aria-label="Height"></label>
            <div class="ex-seg" role="radiogroup" aria-label="Unit" data-ex-units>${UNITS.map((u) => `<button type="button" role="radio" data-unit="${u}" aria-checked="${u === prefs.unit}">${UNIT_LABEL[u]}</button>`).join("")}</div>
          </div>
          <div class="ex-row ex-row-dpi">
            <label class="ex-field">Resolution <select data-ex="dpi" aria-label="Resolution, pixels per inch">${DPIS.map((d) => `<option value="${d}"${d === prefs.dpi ? " selected" : ""}>${d} ppi${d === 72 ? " · screen" : d === 96 ? " · CSS" : d === 300 ? " · print" : ""}</option>`).join("")}</select></label>
            <p class="ex-readout" data-ex-readout aria-live="polite"></p>
          </div>
          <div class="ex-chips" role="group" aria-label="Sizes for this shape" data-ex-chips></div>
        </section>
        <section class="ex-sec" aria-label="File">
          <div class="ex-row">
            <div class="ex-seg" role="radiogroup" aria-label="Format" data-ex-formats>${(["png", "webp", "jpeg"] as const).map((f) => `<button type="button" role="radio" data-format="${f}" aria-checked="${f === prefs.format}">${f === "jpeg" ? "JPEG" : f.toUpperCase()}</button>`).join("")}${allVectors ? `<button type="button" role="radio" data-format="svg" aria-checked="${prefs.format === "svg"}" title="Stays sharp at any size">SVG</button>` : ""}<button type="button" role="radio" data-format="pdf" aria-checked="${prefs.format === "pdf"}" title="One page for each picture, at the physical size; plain shapes stay vectors">PDF</button></div>
            <label class="ex-field ex-quality" data-ex-quality>Quality <input type="range" data-ex="q" min="10" max="100" step="1" value="${prefs.quality}" aria-label="Quality"> <output data-ex-qout>${prefs.quality}%</output></label>
          </div>
          <div class="ex-row" data-ex-bgrow>
            <span class="ex-label" id="ex-bg-l">Background</span>
            <div class="ex-seg" role="radiogroup" aria-labelledby="ex-bg-l" data-ex-bgs>${(["transparent", "white", "black"] as const).map((b) => `<button type="button" role="radio" data-bg="${b}" aria-checked="${b === prefs.bg}">${b[0]!.toUpperCase()}${b.slice(1)}</button>`).join("")}</div>
          </div>
          <label class="ex-field ex-name">Name <input type="text" data-ex="name" spellcheck="false" autocomplete="off" aria-label="File name"><span data-ex-ext class="ex-ext"></span></label>
        </section>
      </div>
    </div>
    <p class="ex-note" data-ex-note role="status" aria-live="polite"></p>
    <footer class="ex-foot">
      <button type="button" class="ex-btn" data-ex="library" title="Keep it in the library of this workspace">${ICONS.library}<span>Save to library</span></button>
      <button type="button" class="ex-btn" data-ex="copy" title="Copy the picture to the clipboard (as PNG)">${ICONS.clipboardPlain}<span>Copy</span></button>
      <button type="button" class="ex-btn is-primary" data-ex="download">${ICONS.download}<span>Download</span></button>
    </footer>`;
  document.body.appendChild(dlg);

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
  const sizeOf = (i: number): { w: number; h: number } => (i === 0 && !multi ? px() : clampSize(widthPx, widthPx / ts[i]!.ratio));
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

  // (several sheets: widths only, as each has its own shape)
  const suggestions = multi ? sizeSuggestions(1, 12).filter((s) => !s.exact).map((s) => ({ ...s, h: 0 })) : sizeSuggestions(t.ratio, 8);
  if (t.original && !multi) suggestions.unshift({ label: "Original", w: t.original.w, h: t.original.h, dpi: null, exact: true });
  chips.innerHTML = suggestions.map((c, i) => `<button type="button" class="ex-chip${c.exact ? " is-exact" : ""}" data-chip="${i}" aria-pressed="false" title="${esc(c.label)}: ${c.h ? `${c.w} × ${c.h}` : c.w} px${c.dpi ? ` at ${c.dpi} ppi` : ""}"><b>${esc(c.label)}</b><span>${c.h ? `${c.w} × ${c.h}` : `${c.w} px`}</span></button>`).join("");
  chips.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-chip]");
    if (!b) return;
    const c = suggestions[Number(b.dataset["chip"])]!;
    widthPx = c.w;
    whole = { w: c.w, h: c.h };
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
    const next = [...ts];
    const [one] = next.splice(from, 1);
    next.splice(to, 0, one!);
    ts = next;
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
    ts = ts.map((x, i, all) => (i === at ? all[to]! : i === to ? all[at]! : x)); // (the two change places)
    drawMinis();
    watchMinis();
    refresh();
    void refreshThumb();
    dlg.querySelector<HTMLButtonElement>(`[data-mini="${to}"] [data-move="${b.dataset["move"]}"]`)?.focus();
  });

  /** Everything that follows from the width and the choices: the fields, the readout, the chips, the file name. */
  const refresh = (opts: { fields?: boolean } = {}): void => {
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
      readout.innerHTML = `<b>${s.w} × ${s.h} px</b> · ${mp < 0.1 ? "<0.1" : mp.toFixed(mp < 10 ? 2 : 1)} MP<br>${[["in", 2], ["cm", 1], ["mm", 0]].map(([k, d]) => `${Number(fromPx(s.w, k as Unit, prefs.dpi).toFixed(d as number))} × ${Number(fromPx(s.h, k as Unit, prefs.dpi).toFixed(d as number))} ${k}`).join(" · ")} <span class="ex-at">at ${prefs.dpi} ppi</span>`;
      q("[data-ex-dim-w]").textContent = `${shown(fromPx(s.w, u, prefs.dpi), u)} ${UNIT_LABEL[u]}`;
      q("[data-ex-dim-h]").textContent = `${shown(fromPx(s.h, u, prefs.dpi), u)} ${UNIT_LABEL[u]}`;
    }
    // (the chips are made once: a press on one must not be lost to them being redrawn when the field it leaves fires its change)
    for (const b of chips.querySelectorAll<HTMLElement>("[data-chip]")) b.setAttribute("aria-pressed", String(suggestions[Number(b.dataset["chip"])]!.w === s.w));
    note.textContent = s.capped ? `Capped at ${MAX_SIDE.toLocaleString("en")} px a side and ${(MAX_AREA / 1e6).toFixed(0)} MP: that is the most a picture can be.` : mp > 40 ? "A big picture: it can take a moment and a lot of memory." : "";
    const lossy = prefs.format === "webp" || prefs.format === "jpeg";
    q("[data-ex-quality]").hidden = !lossy;
    q("[data-ex-bgrow]").hidden = prefs.format === "svg";
    q("[data-ex-quality]").hidden = !(lossy || prefs.format === "pdf");
    for (const b of radios("[data-bg]")) {
      b.setAttribute("aria-checked", String(b.dataset["bg"] === (prefs.format === "jpeg" && prefs.bg === "transparent" ? "white" : prefs.bg)));
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
  q("[data-ex-bgs]").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-bg]");
    if (!b || b.disabled) return;
    prefs.bg = b.dataset["bg"] as Background;
    refresh();
    void refreshThumb();
  });
  qIn.addEventListener("input", () => {
    prefs.quality = Number(qIn.value);
    q("[data-ex-qout]").textContent = `${prefs.quality}%`;
  });
  nameIn.addEventListener("input", () => (nameTouched = true));

  interface Made { name: string; blob: Blob; mime: string }
  const base = (): string => nameIn.value.trim().replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "-") || slug(t.name);
  const sizeText = (i: number): { w: string; h: string } => {
    const z = sizeOf(i), u = prefs.unit;
    const one = (v: number): string => `${shown(fromPx(v, u, prefs.dpi), u)}${u === "px" ? "" : u}`;
    return { w: one(z.w), h: one(z.h) };
  };
  /** The files, each made at the size asked for (one for each sheet; a PDF is one file with a page for each). */
  const make = async (as: Format): Promise<Made[]> => {
    const bgFor = (f: Format): Background => (f === "jpeg" ? (prefs.bg === "black" ? "black" : "white") : prefs.bg);
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
        await navigator.clipboard.write([new ClipboardItem({ "image/png": made!.blob })]);
        note.textContent = `Copied ${s.w} × ${s.h} px (${size(made!.blob)}).`;
      } else {
        const files = await make(prefs.format);
        if (what === "download") {
          if (files.length === 1) {
            save(files[0]!.blob, files[0]!.name);
            note.textContent = `Saved “${files[0]!.name}”: ${prefs.format === "svg" ? "vector" : prefs.format === "pdf" ? `${ts.length} page${ts.length === 1 ? "" : "s"}` : `${s.w} × ${s.h} px`}, ${size(files[0]!.blob)}.`;
          } else {
            const zip = await writeZip(files.map((f) => ({ name: f.name, data: f.blob })));
            save(zip, `${base()}.zip`);
            note.textContent = `Saved “${base()}.zip”: ${files.length} pictures, ${size(zip)}.`;
          }
        } else {
          for (const f of files) await deps.toLibrary(new File([f.blob], f.name, { type: f.mime }), ts);
          note.textContent = `Kept ${files.length === 1 ? `“${files[0]!.name}”` : `${files.length} files`} in the library (${size(new Blob(files.map((f) => f.blob)))}).`;
        }
      }
      savePrefs(prefs);
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
    if (k === "close") dlg.close();
    else if (k === "download" || k === "copy" || k === "library") void run(k);
  });
  dlg.addEventListener("close", () => {
    savePrefs(prefs);
    dlg.remove();
  });
  dlg.showModal();
  refresh();
  void refreshThumb();
  wIn.focus();
  wIn.select();
}
