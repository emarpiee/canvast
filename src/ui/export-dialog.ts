/**
 * The Export dialog (ADR 0147). What is exported has a shape (its ratio) and no size: here the size is chosen, in px, inches, centimetres
 * or millimetres at a resolution, and every other length follows from the ratio. Pick one of the sizes the shape is made for (A4, Full HD,
 * a story, the picture's own pixels …), or type a width or a height; the preview shows the shape with its measures, and the file is
 * made at exactly that size. PNG, WebP and JPEG; SVG too when everything is vector.
 */
import type { Background, ExportTarget } from "../app/export-render";
import { DPIS, MAX_AREA, MAX_SIDE, UNITS, clampSize, formatRatio, fromPx, presetOf, sizeSuggestions, toPx } from "../app/export-size";
import type { Unit } from "../app/export-size";
import { SHOT_FORMATS, encodeShot } from "../app/screenshot";
import type { ShotFormat } from "../app/screenshot";
import { esc } from "./format";
import { ICONS } from "./icons";

export interface ExportDeps {
  readonly target: ExportTarget;
  /** The target drawn at `w` × `h` px. */
  render(w: number, h: number, bg: Background): Promise<HTMLCanvasElement>;
  /** The vectors as SVG text of this size (width and height as SVG writes them), or null when it cannot be. */
  svg(size: { w: string; h: string }): string | null;
  /** Put the file in the library (and tell the person, with a way to see it). */
  toLibrary(file: File): Promise<void>;
  /** A message for the person (the notice stack). */
  say(text: string): void;
}

type Format = ShotFormat | "svg";
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
      format: raw.format === "png" || raw.format === "webp" || raw.format === "jpeg" || raw.format === "svg" ? raw.format : DEFAULTS.format,
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
  const t = deps.target;
  const prefs = loadPrefs();
  if (prefs.format === "svg" && !t.vectors) prefs.format = "png";
  // To begin with: the picture's own pixels, else the first size the shape is made for (A4, Full HD …), else the longer side 1920 px.
  const startW = t.ratio >= 1 ? 1920 : 1920 * t.ratio;
  const exact = sizeSuggestions(t.ratio, 8).find((s) => s.exact);
  let widthPx = t.original ? t.original.w : (exact?.w ?? startW);
  // A size the shape is made for is taken whole (2480 × 3508 for A4), not worked out from a ratio that may differ in the last digit.
  let whole: { w: number; h: number } | null = t.original ? { w: t.original.w, h: t.original.h } : exact ? { w: exact.w, h: exact.h } : null;
  let nameTouched = false;
  let busy = false;

  const dlg = document.createElement("dialog");
  dlg.className = "export-dlg";
  dlg.dataset["testid"] = "export-dialog";
  dlg.setAttribute("aria-labelledby", "ex-title");
  const preset = presetOf(t.ratio);
  dlg.innerHTML = `
    <header class="ex-head">
      <h2 id="ex-title">Export <span class="ex-what">${esc(t.name)}</span></h2>
      <button type="button" class="ex-x" data-ex="close" aria-label="Close">${ICONS.x}</button>
    </header>
    <div class="ex-body">
      <div class="ex-stage">
        <div class="ex-frame" data-ex-frame style="--shape:${Math.min(Math.max(t.ratio, 0.2), 5)}">
          <canvas class="ex-thumb" data-ex-thumb aria-label="Preview"></canvas>
          <span class="ex-dim ex-dim-w" data-ex-dim-w></span>
          <span class="ex-dim ex-dim-h" data-ex-dim-h></span>
        </div>
        <p class="ex-shape" data-testid="export-shape">Shape <strong>${esc(formatRatio(t.ratio))}</strong>${preset ? ` <span>· ${esc(preset.short)}</span>` : ""}</p>
      </div>
      <div class="ex-panel">
        <section class="ex-sec" aria-label="Size">
          <div class="ex-row">
            <label class="ex-field">Width <input type="number" data-ex="w" min="0" step="any" inputmode="decimal" aria-label="Width"></label>
            <span class="ex-times" title="The shape stays: change one side and the other follows" aria-hidden="true">×</span>
            <label class="ex-field">Height <input type="number" data-ex="h" min="0" step="any" inputmode="decimal" aria-label="Height"></label>
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
            <div class="ex-seg" role="radiogroup" aria-label="Format" data-ex-formats>${(["png", "webp", "jpeg"] as const).map((f) => `<button type="button" role="radio" data-format="${f}" aria-checked="${f === prefs.format}">${f === "jpeg" ? "JPEG" : f.toUpperCase()}</button>`).join("")}${t.vectors ? `<button type="button" role="radio" data-format="svg" aria-checked="${prefs.format === "svg"}" title="Stays sharp at any size">SVG</button>` : ""}</div>
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
  const wIn = q<HTMLInputElement>('[data-ex="w"]'), hIn = q<HTMLInputElement>('[data-ex="h"]');
  const dpiSel = q<HTMLSelectElement>('[data-ex="dpi"]'), qIn = q<HTMLInputElement>('[data-ex="q"]'), nameIn = q<HTMLInputElement>('[data-ex="name"]');
  const note = q<HTMLElement>("[data-ex-note]"), readout = q<HTMLElement>("[data-ex-readout]"), chips = q<HTMLElement>("[data-ex-chips]");
  const thumb = q<HTMLCanvasElement>("[data-ex-thumb]");
  const radios = (sel: string): HTMLElement[] => [...dlg.querySelectorAll<HTMLElement>(sel)];

  const px = (): { w: number; h: number; capped: boolean } => (whole && whole.w === widthPx ? { ...whole, capped: false } : clampSize(widthPx, widthPx / t.ratio));
  const ext = (): string => (prefs.format === "svg" ? "svg" : SHOT_FORMATS[prefs.format].ext);

  const refreshName = (): void => {
    const s = px();
    if (!nameTouched) nameIn.value = `${slug(t.name)}-${prefs.format === "svg" ? "vector" : `${s.w}x${s.h}`}`;
    q("[data-ex-ext]").textContent = `.${ext()}`;
  };

  let thumbToken = 0;
  const refreshThumb = async (): Promise<void> => {
    const token = ++thumbToken;
    const w = Math.max(8, Math.round(t.ratio >= 1 ? PREVIEW_PX : PREVIEW_PX * t.ratio)), h = Math.max(8, Math.round(w / t.ratio));
    try {
      const bg: Background = prefs.format === "jpeg" || prefs.format === "svg" ? "white" : prefs.bg;
      const c = await deps.render(w, h, bg);
      if (token !== thumbToken) return;
      thumb.width = w;
      thumb.height = h;
      thumb.getContext("2d")!.clearRect(0, 0, w, h);
      thumb.getContext("2d")!.drawImage(c, 0, 0);
      thumb.dataset["ready"] = "1";
      q("[data-ex-frame]").classList.toggle("is-checker", bg === "transparent");
      thumb.dataset["bg"] = bg;
    } catch {
      // no preview: the numbers still work
    }
  };

  const suggestions = sizeSuggestions(t.ratio, 8);
  if (t.original) suggestions.unshift({ label: "Original", w: t.original.w, h: t.original.h, dpi: null, exact: true });
  chips.innerHTML = suggestions.map((c, i) => `<button type="button" class="ex-chip${c.exact ? " is-exact" : ""}" data-chip="${i}" aria-pressed="false" title="${esc(c.label)}: ${c.w} × ${c.h} px${c.dpi ? ` at ${c.dpi} ppi` : ""}"><b>${esc(c.label)}</b><span>${c.w} × ${c.h}</span></button>`).join("");
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
    readout.innerHTML = `<b>${s.w} × ${s.h} px</b> · ${mp < 0.1 ? "<0.1" : mp.toFixed(mp < 10 ? 2 : 1)} MP<br>${[["in", 2], ["cm", 1], ["mm", 0]].map(([k, d]) => `${Number(fromPx(s.w, k as Unit, prefs.dpi).toFixed(d as number))} × ${Number(fromPx(s.h, k as Unit, prefs.dpi).toFixed(d as number))} ${k}`).join(" · ")} <span class="ex-at">at ${prefs.dpi} ppi</span>`;
    q("[data-ex-dim-w]").textContent = `${shown(fromPx(s.w, u, prefs.dpi), u)} ${UNIT_LABEL[u]}`;
    q("[data-ex-dim-h]").textContent = `${shown(fromPx(s.h, u, prefs.dpi), u)} ${UNIT_LABEL[u]}`;
    // (the chips are made once: a press on one must not be lost to them being redrawn when the field it leaves fires its change)
    for (const b of chips.querySelectorAll<HTMLElement>("[data-chip]")) b.setAttribute("aria-pressed", String(suggestions[Number(b.dataset["chip"])]!.w === s.w));
    note.textContent = s.capped ? `Capped at ${MAX_SIDE.toLocaleString("en")} px a side and ${(MAX_AREA / 1e6).toFixed(0)} MP: that is the most a picture can be.` : mp > 40 ? "A big picture: it can take a moment and a lot of memory." : "";
    const lossy = prefs.format === "webp" || prefs.format === "jpeg";
    q("[data-ex-quality]").hidden = !lossy;
    q("[data-ex-bgrow]").hidden = prefs.format === "svg";
    for (const b of radios("[data-bg]")) {
      b.setAttribute("aria-checked", String(b.dataset["bg"] === (prefs.format === "jpeg" && prefs.bg === "transparent" ? "white" : prefs.bg)));
      if (b.dataset["bg"] === "transparent") (b as HTMLButtonElement).disabled = prefs.format === "jpeg";
    }
    for (const b of radios("[data-unit]")) b.setAttribute("aria-checked", String(b.dataset["unit"] === u));
    for (const b of radios("[data-format]")) b.setAttribute("aria-checked", String(b.dataset["format"] === prefs.format));
    q<HTMLButtonElement>('[data-ex="copy"]').disabled = busy;
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

  /** The file, made at the size asked for. */
  const make = async (as: Format): Promise<{ blob: Blob; ext: string; mime: string }> => {
    const s = px();
    const bgFor = (f: Format): Background => (f === "jpeg" ? (prefs.bg === "black" ? "black" : "white") : prefs.bg);
    if (as === "svg") {
      const u = prefs.unit;
      const svg = deps.svg({ w: `${shown(fromPx(s.w, u, prefs.dpi), u)}${u === "px" ? "" : u}`, h: `${shown(fromPx(s.h, u, prefs.dpi), u)}${u === "px" ? "" : u}` });
      if (!svg) throw new Error("this cannot be made as SVG");
      return { blob: new Blob([svg], { type: "image/svg+xml" }), ext: "svg", mime: "image/svg+xml" };
    }
    const canvas = await deps.render(s.w, s.h, bgFor(as));
    const enc = await encodeShot(canvas, as, prefs.quality);
    return { blob: enc.blob, ext: SHOT_FORMATS[enc.format].ext, mime: SHOT_FORMATS[enc.format].mime };
  };
  const fileName = (e: string): string => `${nameIn.value.trim().replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "-") || slug(t.name)}.${e}`;
  const size = (b: Blob): string => (b.size < 1024 * 1024 ? `${Math.max(1, Math.round(b.size / 1024))} KB` : `${(b.size / 1024 / 1024).toFixed(1)} MB`);

  const run = async (what: "download" | "copy" | "library"): Promise<void> => {
    if (busy) return;
    busy = true;
    dlg.classList.add("is-busy");
    note.textContent = "Making the picture…";
    try {
      const s = px();
      if (what === "copy") {
        const { blob } = await make(prefs.format === "svg" ? "png" : prefs.format === "jpeg" ? "png" : "png");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        note.textContent = `Copied ${s.w} × ${s.h} px (${size(blob)}).`;
      } else {
        const { blob, ext: e, mime } = await make(prefs.format);
        const name = fileName(e);
        if (what === "download") {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
          note.textContent = `Saved “${name}”: ${prefs.format === "svg" ? "vector" : `${s.w} × ${s.h} px`}, ${size(blob)}.`;
        } else {
          await deps.toLibrary(new File([blob], name, { type: mime }));
          note.textContent = `Kept “${name}” in the library (${size(blob)}).`;
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
