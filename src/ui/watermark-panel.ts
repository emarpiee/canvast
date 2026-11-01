import type { EditorState } from "../app/editor-state";
import type { Watermark } from "../doc/watermark";
import { LOGO_MAX_PX, MAX_WATERMARK_TEXT, newWatermark, textMetrics } from "../doc/watermark";
import { plural } from "../doc/plural";
import { ICONS } from "./icons";
import { panelHtml } from "./panel";

/**
 * The Watermark panel: a visible watermark (a text or a small picture) on the selected pictures, placed freely on the canvas with its own
 * handles, kept editable on the picture or made part of it. A panel of the dock, like Adjust; the toolbar's Watermark button shows it.
 */
export interface WatermarkPanelActions {
  selectedWatermark(): { wm: Watermark | null; count: number; id: string } | null;
  previewWatermark(wm: Watermark): void;
  commitWatermark(wm: Watermark | null, label: string): void;
  makePermanent(): void;
}

/** A picture file as a PNG data URL no bigger than `LOGO_MAX_PX` on its longer side (null: not a picture the browser can read). */
async function logoOf(file: Blob): Promise<{ src: string; w: number; h: number } | null> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return null;
  const k = Math.min(1, LOGO_MAX_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return { src: c.toDataURL("image/png"), w: c.width, h: c.height };
}

export function mountWatermarkPanel(host: HTMLElement, editor: EditorState, actions: WatermarkPanelActions): void {
  const panel = document.createElement("aside");
  panel.className = "layers-panel adjust-panel watermark-panel";
  panel.setAttribute("aria-label", "Watermark");
  panel.dataset["testid"] = "watermark-panel";
  panel.hidden = true;
  panel.innerHTML = panelHtml({ title: "Watermark", body: `<div class="adjust-body" data-wm-body></div>` });
  host.appendChild(panel);
  const body = panel.querySelector<HTMLElement>("[data-wm-body]")!;
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  file.dataset["testid"] = "watermark-logo-input";
  panel.appendChild(file);
  let shownKey = "";
  let scheduled = false;

  const row = (label: string, name: string, min: number, max: number, step: number, unit: string): string =>
    `<label class="adj-row"><span class="adj-label">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-wm-range="${name}" aria-label="${label} (${unit})"><input type="number" class="adj-num" min="${min}" max="${max}" step="${step}" data-wm-num="${name}" aria-label="${label} (${unit})"></label>`;

  /** The number a control shows for a watermark. */
  const valueOf = (wm: Watermark, name: string): number =>
    name === "opacity" ? Math.round(wm.opacity * 100) : name === "size" ? Math.round(wm.size * 1000) / 10 : name === "turn" ? Math.round(wm.turn) : name === "x" ? Math.round(wm.x * 1000) / 10 : Math.round(wm.y * 1000) / 10;
  const withValue = (wm: Watermark, name: string, v: number): Watermark =>
    name === "opacity" ? { ...wm, opacity: Math.min(1, Math.max(0.05, v / 100)) } : name === "size" ? { ...wm, size: Math.max(0.01, v / 100) } : name === "turn" ? { ...wm, turn: Math.max(-180, Math.min(180, v)) } : name === "x" ? { ...wm, x: v / 100 } : { ...wm, y: v / 100 };

  const render = (): void => {
    scheduled = false;
    if (panel.hidden !== !editor.watermarkOpen) panel.hidden = !editor.watermarkOpen;
    if (panel.hidden) return;
    const sel = actions.selectedWatermark();
    const wm = sel?.wm ?? null;
    const key = !sel ? "none" : `${[...editor.selection].sort().join(",")}|${wm ? (wm.logo ? "logo" : "text") : "-"}|${sel.count}`;
    if (key !== shownKey) {
      shownKey = key;
      body.innerHTML = !sel
        ? `<p class="adj-empty">Select a picture to put a watermark on it: a text or a small picture, anywhere on it, see-through.</p>`
        : !wm
          ? `<p class="adj-note">${sel.count > 1 ? `The same watermark goes on the ${plural(sel.count, "selected picture")}, at the same place on each.` : "A text or a small picture (a logo) over the picture: you place it, size it and turn it on the canvas."}</p>
             <div class="wm-actions"><button type="button" class="styles-make" data-wm-add="text">${ICONS.watermarkText}<span>Add a text</span></button><button type="button" class="styles-make" data-wm-add="logo">${ICONS.watermarkFile}<span>Add a picture…</span></button></div>`
          : `${wm.text !== undefined
              ? `<label class="wm-text"><span class="adj-label">Text</span><textarea rows="2" maxlength="${MAX_WATERMARK_TEXT}" data-wm-text aria-label="Watermark text"></textarea></label>
                 <div class="wm-line"><label class="wm-colour"><span class="adj-label">Colour</span><input type="color" data-wm-colour aria-label="Watermark colour"></label><label class="wm-check"><input type="checkbox" data-wm-bold> Bold</label></div>`
              : `<div class="wm-line"><img class="wm-logo" data-wm-logo alt="The watermark picture"><button type="button" class="styles-make" data-wm-add="logo">${ICONS.watermarkFile}<span>Replace…</span></button></div>`}
             ${row("Opacity", "opacity", 5, 100, 1, "%")}${row("Size", "size", 1, 200, 0.5, "% of the width")}${row("Turn", "turn", -180, 180, 1, "degrees")}${row("Across", "x", 0, 100, 0.5, "% from the left")}${row("Down", "y", 0, 100, 0.5, "% from the top")}
             ${sel.count > 1 ? `<p class="adj-note">On the ${plural(sel.count, "selected picture")}, at the same place on each.</p>` : ""}
             <div class="wm-actions">
               <button type="button" class="styles-make" data-wm-place aria-pressed="false" title="Place it on the canvas: drag it, size it by a corner, turn it by the round handle">${ICONS.watermarkPlace}<span>Place on the picture</span></button>
               <button type="button" class="styles-make" data-wm-permanent title="Make it part of the picture: a new file in the library with the watermark in it, shown in place of this one (the original file is kept)">${ICONS.watermarkBake}<span>Make permanent</span></button>
               <button type="button" class="styles-make" data-wm-remove title="Take the watermark off">${ICONS.trash}<span>Remove</span></button>
             </div>`;
    }
    if (!wm) return;
    // Values follow the stored watermark (moved on the canvas, undone), except in the field being typed in.
    const set = (el: HTMLInputElement | HTMLTextAreaElement | null, v: string): void => {
      if (el && document.activeElement !== el && el.value !== v) el.value = v;
    };
    set(panel.querySelector("[data-wm-text]"), wm.text ?? "");
    set(panel.querySelector("[data-wm-colour]"), (wm.color ?? "#ffffff").slice(0, 7));
    const bold = panel.querySelector<HTMLInputElement>("[data-wm-bold]");
    if (bold) bold.checked = !!wm.bold;
    const img = panel.querySelector<HTMLImageElement>("[data-wm-logo]");
    if (img && wm.logo && img.src !== wm.logo.src) img.src = wm.logo.src;
    for (const name of ["opacity", "size", "turn", "x", "y"]) {
      set(panel.querySelector(`[data-wm-range="${name}"]`), String(valueOf(wm, name)));
      set(panel.querySelector(`[data-wm-num="${name}"]`), String(valueOf(wm, name)));
    }
    panel.querySelector("[data-wm-place]")?.setAttribute("aria-pressed", String(editor.watermarkId === sel!.id));
  };
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  editor.subscribe(schedule);
  render();

  const current = (): Watermark | null => actions.selectedWatermark()?.wm ?? null;
  const withText = (wm: Watermark, text: string, bold: boolean): Watermark => {
    const m = textMetrics(text, bold);
    const { bold: _b, ...rest } = wm;
    return { ...rest, text, ...(bold ? { bold: true as const } : {}), em: m.em, ar: m.ar };
  };

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-close]")) {
      editor.watermarkOpen = false;
      editor.watermarkId = null;
      return editor.changed();
    }
    const add = t.closest<HTMLElement>("[data-wm-add]")?.dataset["wmAdd"];
    if (add === "text") {
      actions.commitWatermark(newWatermark({ text: "© Your name", color: "#ffffff" }), "Add watermark");
      editor.watermarkId = actions.selectedWatermark()?.id ?? null; // (straight into placing it)
      return editor.changed();
    }
    if (add === "logo") return file.click();
    if (t.closest("[data-wm-place]")) {
      const id = actions.selectedWatermark()?.id ?? null;
      editor.watermarkId = editor.watermarkId === id ? null : id;
      return editor.changed();
    }
    if (t.closest("[data-wm-permanent]")) return actions.makePermanent();
    if (t.closest("[data-wm-remove]")) actions.commitWatermark(null, "Remove watermark");
  });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    void logoOf(f).then((logo) => {
      if (!logo) {
        editor.message = "That file is not a picture this browser can read.";
        return editor.changed();
      }
      const wm = current();
      // (a picture in place of the one there keeps its place, size, turn and opacity; in place of a text, a new one)
      actions.commitWatermark(wm?.logo ? { ...wm, logo, ar: logo.h / logo.w } : newWatermark({ logo }), wm ? "Replace watermark picture" : "Add watermark");
      editor.watermarkId = actions.selectedWatermark()?.id ?? null;
      editor.changed();
    });
  });
  panel.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const wm = current();
    if (!wm) return;
    const name = t.dataset["wmRange"] ?? t.dataset["wmNum"];
    if (name && t.value !== "" && Number.isFinite(Number(t.value))) {
      const other = panel.querySelector<HTMLInputElement>(t.dataset["wmRange"] ? `[data-wm-num="${name}"]` : `[data-wm-range="${name}"]`);
      if (other) other.value = t.value;
      actions.previewWatermark(withValue(wm, name, Number(t.value)));
    } else if (t.matches("[data-wm-text]") && t.value.trim()) actions.previewWatermark(withText(wm, t.value, !!wm.bold));
    else if (t.matches("[data-wm-colour]")) actions.previewWatermark({ ...wm, color: t.value });
  });
  panel.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    const wm = current();
    if (!wm) return;
    const name = t.dataset["wmRange"] ?? t.dataset["wmNum"];
    if (name && t.value !== "" && Number.isFinite(Number(t.value))) actions.commitWatermark(withValue(wm, name, Number(t.value)), "Change watermark");
    else if (t.matches("[data-wm-text]")) {
      if (t.value.trim()) actions.commitWatermark(withText(wm, t.value, !!wm.bold), "Change watermark text");
      else t.value = wm.text ?? ""; // (an empty text is not a watermark: Remove takes it off)
    } else if (t.matches("[data-wm-colour]")) actions.commitWatermark({ ...wm, color: t.value }, "Change watermark colour");
    else if (t.matches("[data-wm-bold]")) actions.commitWatermark(withText(wm, wm.text ?? "", t.checked), "Change watermark text");
    else shownKey = ""; // (anything else: drawn again)
    schedule();
  });
  panel.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("input, select, textarea")) e.stopPropagation(); // typing here never reaches the canvas shortcuts
  });
}
