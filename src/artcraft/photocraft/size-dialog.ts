import { makeModal, showModal } from "../../ui/modal";
import { esc } from "../../ui/format";
import { plural } from "../../doc/plural";
import type { SizeRule } from "../../app/export-names";
import { sizeByRule } from "../../app/export-names";
import { clampSize } from "../../app/export-size";

/**
 * The size of a layered project for PhotoCraft (a sheet, or several pictures as layers), by the Export dialog's rules: a scale of its
 * size on the canvas, or a width, height or longest side in pixels. Resolves with the pixels and the rule taken (to remember), or null.
 */
export interface SizeChoice {
  w: number;
  h: number;
  rule: SizeRule;
  value: number;
}

const RULES: ReadonlyArray<readonly [SizeRule, string, string]> = [
  ["scale", "Scale", "×"],
  ["width", "Width", "px"],
  ["height", "Height", "px"],
  ["long", "Longest side", "px"],
];

export function chooseProjectSize(o: { title: string; ratio: number; world: { w: number; h: number } | null; layers: number; rule: SizeRule; value: number; /** The scale at which its sharpest picture keeps all its pixels, when it has one. */ sharpest: number | null }): Promise<SizeChoice | null> {
  const dlg = makeModal({
    className: "confirm",
    testid: "photocraft-size",
    titleId: "pc-size-title",
    html: `
    <h2 id="pc-size-title">${esc(o.title)}</h2>
    <p>${esc(plural(o.layers, "layer"))}, each object of it on its own, as in the Layers panel. Its size, as in Export:</p>
    <div class="pc-size-row">
      <select data-rule aria-label="Size by">${RULES.filter(([r]) => r !== "scale" || o.world).map(([r, l]) => `<option value="${r}">${esc(l)}</option>`).join("")}</select>
      <input type="number" data-value min="0.01" step="any" aria-label="Size">
      <span data-unit></span>
    </div>
    <p class="set-help" data-result role="status"></p>
    <div class="confirm-actions">
      ${o.sharpest ? `<button type="button" data-sharpest title="The scale at which its sharpest picture keeps all its pixels">Sharpest picture</button>` : ""}
      <button type="button" value="cancel" data-testid="photocraft-size-cancel">Cancel</button>
      <button type="button" class="is-primary" value="ok" data-testid="photocraft-size-ok">Open in PhotoCraft</button>
    </div>`,
  });
  const rule = dlg.querySelector<HTMLSelectElement>("[data-rule]")!;
  const value = dlg.querySelector<HTMLInputElement>("[data-value]")!;
  const unit = dlg.querySelector<HTMLElement>("[data-unit]")!;
  const result = dlg.querySelector<HTMLElement>("[data-result]")!;
  rule.value = o.rule === "scale" && !o.world ? "long" : o.rule;
  value.value = String(rule.value === o.rule ? o.value : 2048);
  const size = (): { w: number; h: number; capped: boolean } | null => {
    const v = Number(value.value);
    if (!(v > 0)) return null;
    const s = sizeByRule(rule.value as SizeRule, v, o.ratio, o.world);
    return clampSize(s.w, s.h);
  };
  const show = (): void => {
    unit.textContent = RULES.find(([r]) => r === rule.value)?.[2] ?? "";
    const s = size();
    result.textContent = s ? `${s.w} × ${s.h} px${s.capped ? " (made smaller: the largest a picture may be)" : ""}` : "Give a size above 0.";
    dlg.querySelector<HTMLButtonElement>('[value="ok"]')!.disabled = !s;
  };
  // view-state: (a dialog's own control: what it gives goes to the command that opened it)
  rule.addEventListener("change", () => {
    value.value = rule.value === "scale" ? "2" : "2048";
    show();
  });
  // view-state: (a dialog's own control: what it gives goes to the command that opened it)
  value.addEventListener("input", show);
  show();
  return new Promise((resolve) => {
    let answer: SizeChoice | null = null;
    // view-state: (a dialog's own control: what it gives goes to the command that opened it)
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      if (b.hasAttribute("data-sharpest")) {
        rule.value = "scale";
        value.value = String(Math.round(o.sharpest! * 100) / 100);
        return show();
      }
      const s = size();
      if (b.value === "ok" && s) answer = { w: s.w, h: s.h, rule: rule.value as SizeRule, value: Number(value.value) };
      dlg.close();
    });
    showModal(dlg, () => resolve(answer));
    value.focus();
  });
}
