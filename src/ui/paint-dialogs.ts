/**
 * The Painting view's page dialog (ADR 0165): a new painting, or a page's size, resolution and background. Sizes are typed in px, in,
 * cm or mm at the page's DPI and stored as whole px. Built on the shared modal dialog's look (`dialog.confirm`).
 */
import { esc } from "./format";
import { MAX_PAGE_PX, UNITS, fromPx, toPx, type Unit } from "../paint/model";

export interface PageSpec {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly dpi: number;
  readonly bg: string | null;
}

/** Common sizes, in px at their DPI. */
export const PAGE_PRESETS: ReadonlyArray<{ readonly label: string; readonly w: number; readonly h: number; readonly dpi: number }> = [
  { label: "Screen, 1920 × 1080", w: 1920, h: 1080, dpi: 72 },
  { label: "Screen, 3840 × 2160 (4K)", w: 3840, h: 2160, dpi: 72 },
  { label: "Square, 2048 × 2048", w: 2048, h: 2048, dpi: 72 },
  { label: "A4 at 300 DPI", w: 2480, h: 3508, dpi: 300 },
  { label: "Letter at 300 DPI", w: 2550, h: 3300, dpi: 300 },
  { label: "Phone, 1080 × 1920", w: 1080, h: 1920, dpi: 72 },
];

export function pageDialog(o: { title: string; confirmLabel: string; withName: boolean; value: PageSpec }): Promise<PageSpec | null> {
  const dlg = document.createElement("dialog");
  dlg.className = "confirm paint-page-dialog";
  dlg.dataset["testid"] = "page-dialog";
  dlg.setAttribute("aria-labelledby", "page-dialog-title");
  const v = o.value;
  dlg.innerHTML = `
    <h2 id="page-dialog-title">${esc(o.title)}</h2>
    ${o.withName ? `<label class="paint-field">Name <input type="text" data-f="name" maxlength="80" value="${esc(v.name)}" autocomplete="off" spellcheck="false"></label>` : ""}
    <label class="paint-field">Size <select data-f="preset"><option value="">Custom</option>${PAGE_PRESETS.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join("")}</select></label>
    <div class="paint-field-row">
      <label class="paint-field">Width <input type="number" data-f="w" min="0" step="any" inputmode="decimal"></label>
      <label class="paint-field">Height <input type="number" data-f="h" min="0" step="any" inputmode="decimal"></label>
      <label class="paint-field">Unit <select data-f="unit">${Object.keys(UNITS).map((u) => `<option value="${u}">${u}</option>`).join("")}</select></label>
    </div>
    <label class="paint-field">Resolution (DPI) <input type="number" data-f="dpi" min="1" max="10000" step="1" inputmode="numeric" value="${v.dpi}"></label>
    <div class="paint-field-row">
      <label class="paint-field">Background <select data-f="bg"><option value="white">White</option><option value="none">Transparent</option><option value="colour">Colour</option></select></label>
      <label class="paint-field" data-colour-wrap>Colour <input type="text" data-f="hex" maxlength="7" spellcheck="false" autocomplete="off" value="${esc(v.bg && v.bg !== "#ffffff" ? v.bg : "#ffffff")}"></label>
    </div>
    <p class="paint-dialog-note" data-note></p>
    <div class="confirm-actions">
      <button type="button" value="cancel">Cancel</button>
      <button type="button" class="is-primary" value="ok" data-testid="page-dialog-ok">${esc(o.confirmLabel)}</button>
    </div>`;
  document.body.appendChild(dlg);
  const f = <T extends HTMLElement>(k: string): T => dlg.querySelector<T>(`[data-f="${k}"]`)!;
  let unit: Unit = "px";
  const dpi = (): number => Math.min(10000, Math.max(1, Math.round(Number(f<HTMLInputElement>("dpi").value) || 72)));
  const show = (w: number, h: number): void => {
    const r = (n: number): string => String(Math.round(fromPx(n, unit, dpi()) * 1000) / 1000);
    f<HTMLInputElement>("w").value = r(w);
    f<HTMLInputElement>("h").value = r(h);
  };
  const px = (k: "w" | "h"): number => Math.round(toPx(Number(f<HTMLInputElement>(k).value), unit, dpi()));
  const bgSel = f<HTMLSelectElement>("bg");
  bgSel.value = v.bg === null ? "none" : v.bg.toLowerCase() === "#ffffff" ? "white" : "colour";
  const colourWrap = dlg.querySelector<HTMLElement>("[data-colour-wrap]")!;
  const syncBg = (): void => void (colourWrap.hidden = bgSel.value !== "colour");
  bgSel.addEventListener("change", syncBg);
  syncBg();
  show(v.w, v.h);
  f<HTMLSelectElement>("unit").addEventListener("change", () => {
    const w = px("w"), h = px("h");
    unit = f<HTMLSelectElement>("unit").value as Unit;
    show(w, h);
  });
  f<HTMLSelectElement>("preset").addEventListener("change", () => {
    const p = PAGE_PRESETS[Number(f<HTMLSelectElement>("preset").value)];
    if (!p) return;
    f<HTMLInputElement>("dpi").value = String(p.dpi);
    show(p.w, p.h);
  });
  const note = dlg.querySelector<HTMLElement>("[data-note]")!;
  const read = (): PageSpec | null => {
    const w = px("w"), h = px("h");
    if (!(w >= 1 && h >= 1 && w <= MAX_PAGE_PX && h <= MAX_PAGE_PX)) {
      note.textContent = `Width and height must be from 1 to ${MAX_PAGE_PX} px.`;
      return null;
    }
    const hex = f<HTMLInputElement>("hex").value.trim().toLowerCase();
    if (bgSel.value === "colour" && !/^#[0-9a-f]{6}$/.test(hex)) {
      note.textContent = "The colour is written #rrggbb (for example #f4efe6).";
      return null;
    }
    const name = o.withName ? f<HTMLInputElement>("name").value.trim().slice(0, 80) || "Painting" : v.name;
    return { name, w, h, dpi: dpi(), bg: bgSel.value === "none" ? null : bgSel.value === "white" ? "#ffffff" : hex };
  };
  return new Promise((resolve) => {
    let answer: PageSpec | null = null;
    const ok = (): void => {
      answer = read();
      if (answer) dlg.close();
    };
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      if (b.value === "ok") ok();
      else dlg.close();
    });
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
        e.preventDefault();
        ok();
      }
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(answer);
    });
    dlg.showModal();
    (dlg.querySelector<HTMLInputElement>('[data-f="name"]') ?? f<HTMLInputElement>("w")).focus();
  });
}
