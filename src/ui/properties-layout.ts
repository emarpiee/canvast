import { createBar, syncScroll } from "./bar";
import { SECTIONS, orderBySection, sectionLabel, sectionSummary, showSections, shownSections } from "./bar-sections";
import { closeChipPopover, openChipPopover, placeChipPopover, syncChips } from "./value-chips";
import type { ChipSpec } from "./value-chips";
import { inRoom, placeBy, selectionBoxIn } from "./near-selection";
import { panelHtml } from "./panel";
import { ICONS } from "./icons";
import { setControlRevealer } from "../commands/from-bars";
import type { PropertiesBar } from "./toolbar";
import type { EditorState } from "../app/editor-state";

/**
 * How the Properties bar is shown (ADR 0198, Settings > Appearance > Properties): as it is (one row at the top), as value chips (one per section,
 * each opening its controls), in the Properties panel (the sections one under another, opening by itself when there is something to show), or as
 * value chips just above the selection. The controls are always the same ones, moved: the bar itself goes into the chip's popover, the panel, or
 * waits, unseen, in its parking place; so whatever they do (live numbers, colour pickers, the command palette, shortcuts) works in every way.
 */
export type PropertiesPlace = "bar" | "chips" | "panel" | "near";
export type PanelPin = "auto" | "open" | "closed";

export interface PropertiesLayoutOptions {
  place(): PropertiesPlace;
  folded(): readonly string[];
  setFolded(ids: readonly string[]): void;
  pin(): PanelPin;
  setPin(p: PanelPin): void;
  mini(): boolean;
  setMini(on: boolean): void;
  /** Whether the window is too narrow for a panel beside the canvas (the panel is then shown as chips). */
  narrow(): boolean;
}

export function mountPropertiesLayout(root: HTMLElement, canvasHost: HTMLElement, editor: EditorState, pb: PropertiesBar, opts: PropertiesLayoutOptions): { el: HTMLElement; refresh(): void } {
  const { bar, row } = pb;
  const home = { parent: bar.parentElement!, next: bar.nextSibling };
  // Where the bar waits, unseen, while it is shown as chips: in the same root (so it is still found there), hidden.
  const park = document.createElement("div");
  park.className = "props-park";
  park.hidden = true;
  root.append(park);
  // The value chips: a bar of the standard shape at the top, after the Properties bar's own place (or above the selection).
  const chips = createBar("Properties", "Properties");
  delete chips.el.dataset["cmdGroup"]; // (the chips are not commands: the controls they open are)
  chips.el.classList.add("props-chips");
  bar.after(chips.el);
  const near = document.createElement("div");
  near.className = "props-near";
  near.hidden = true;
  canvasHost.append(near);

  // The Properties panel, in the dock with the others.
  const panel = document.createElement("aside");
  panel.className = "layers-panel props-panel";
  panel.setAttribute("aria-label", "Properties");
  panel.dataset["testid"] = "properties-panel";
  panel.hidden = true;
  panel.innerHTML = panelHtml({
    title: "Properties",
    tools: `<button type="button" class="layer-btn" data-props-pin aria-pressed="false" aria-label="Keep the panel open" title="Keep the panel open, even with nothing selected">${ICONS.keepOpen}</button><button type="button" class="layer-btn" data-props-mini aria-pressed="false" aria-label="Only the sections" title="Only the sections: each opens its options beside it">${ICONS.panelShrink}</button>`,
    body: `<div class="props-host" data-props-host></div><div class="props-mini" data-props-minilist hidden></div><p class="adj-note" data-props-empty hidden>Select something, or pick a tool, to see its options here.</p>`,
  });
  const panelHost = panel.querySelector<HTMLElement>("[data-props-host]")!;
  const miniList = panel.querySelector<HTMLElement>("[data-props-minilist]")!;
  const empty = panel.querySelector<HTMLElement>("[data-props-empty]")!;
  // The headings of the sections in the panel: in the bar's row, each before its section's controls (`order`), seen only in the panel.
  for (const [i, s] of SECTIONS.entries()) {
    const h = document.createElement("button");
    h.type = "button";
    h.className = "ps-head";
    h.dataset["psHead"] = s.id;
    h.dataset["noCommand"] = "";
    h.style.order = String(2 * i);
    h.setAttribute("aria-expanded", "true");
    h.innerHTML = `<span class="ps-name">${s.label}</span><span class="ps-sum"></span>${ICONS.chevronDown}`;
    row.append(h);
  }

  let place: PropertiesPlace = "bar";
  /** The section a chip's popover shows now (null: none is open). */
  let popped: string | null = null;
  const effective = (): PropertiesPlace => (opts.place() === "panel" && opts.narrow() ? "chips" : opts.place());

  const putBar = (where: HTMLElement | "home"): void => {
    const parent = where === "home" ? home.parent : where;
    if (bar.parentElement === parent) return;
    if (where === "home") home.parent.insertBefore(bar, chips.el);
    else where.append(bar);
  };
  const stacked = (on: boolean, panelHeads: boolean): void => {
    bar.classList.toggle("is-stacked", on);
    bar.classList.toggle("is-panel", panelHeads);
    orderBySection(row, on);
  };

  const closePop = (): void => {
    if (popped !== null) closeChipPopover();
  };
  /** Open a section's controls under its chip: the bar moves into the popover, showing that section only. */
  const popSection = (anchor: HTMLElement, id: string): void => {
    openChipPopover(anchor, sectionLabel(id), (pop) => {
      popped = id;
      stacked(true, false);
      showSections(row, new Set([id]));
      pop.append(bar);
    }, () => {
      popped = null;
      showSections(row, null);
      settle();
    });
  };

  const chipsOf = (ids: readonly string[]): ChipSpec[] => ids.map((id) => ({ id, label: sectionLabel(id), value: sectionSummary(row, id), title: `${sectionLabel(id)}: open its options` }));
  const panelShown = (): boolean => {
    const pin = opts.pin();
    return pin === "open" || (pin === "auto" && !bar.hidden);
  };

  /** Lay everything out for the current place, after every update of the bar. */
  const settle = (): void => {
    const was = place;
    place = effective();
    if (was !== place) closePop();
    bar.toggleAttribute("data-parked", place !== "bar");
    const ids = bar.hidden ? [] : shownSections(row);
    if (place === "bar") {
      stacked(false, false);
      showSections(row, null);
      putBar("home");
      chips.el.hidden = true;
      near.hidden = true;
      panel.hidden = true;
      return;
    }
    if (place === "panel") {
      near.hidden = true;
      panel.hidden = !panelShown();
      chips.el.hidden = false;
      // (the top keeps what is used most: the Look chip, and the panel's switch)
      if (!chips.row.querySelector("[data-props-toggle]")) {
        chips.row.innerHTML = `<span class="props-quick"></span><button type="button" class="vchip" data-props-toggle aria-pressed="false" title="Properties: show or hide the panel">${ICONS.properties}<span class="vchip-k">Properties</span></button>`;
      }
      syncChips(chips.row.querySelector<HTMLElement>(".props-quick")!, chipsOf(ids.filter((id) => id === "look")));
      chips.row.querySelector("[data-props-toggle]")!.setAttribute("aria-pressed", String(!panel.hidden));
      const mini = opts.mini();
      panel.querySelector("[data-props-mini]")!.setAttribute("aria-pressed", String(mini));
      panel.querySelector("[data-props-pin]")!.setAttribute("aria-pressed", String(opts.pin() === "open"));
      miniList.hidden = !mini;
      empty.hidden = !bar.hidden;
      if (mini) {
        syncChips(miniList, chipsOf(ids));
        if (popped === null) putBar(park);
      } else if (popped === null) {
        putBar(panelHost);
        stacked(true, true);
        const folded = new Set(opts.folded());
        showSections(row, new Set(SECTIONS.map((s) => s.id).filter((id) => !folded.has(id))));
        for (const h of row.querySelectorAll<HTMLElement>("[data-ps-head]")) {
          const id = h.dataset["psHead"]!;
          h.hidden = !ids.includes(id);
          h.setAttribute("aria-expanded", String(!folded.has(id)));
          const sum = h.querySelector<HTMLElement>(".ps-sum")!;
          const html = folded.has(id) ? sectionSummary(row, id) : "";
          if (sum.innerHTML !== html) sum.innerHTML = html;
        }
      }
      if (popped !== null) placeChipPopover();
      return;
    }
    // Value chips: at the top, or just above the selection (back at the top when nothing is selected or it is out of the view).
    panel.hidden = true;
    if (popped === null) putBar(park);
    if (popped !== null && !ids.includes(popped)) closePop();
    const box = place === "near" ? selectionBoxIn(canvasHost, editor) : null;
    const beside = !!box && inRoom(box) && !bar.hidden;
    const host = beside ? near : chips.row;
    if (host === chips.row && chips.row.querySelector("[data-props-toggle]")) chips.row.innerHTML = "";
    syncChips(host, chipsOf(ids));
    chips.el.hidden = beside || bar.hidden;
    near.hidden = !beside;
    syncScroll(chips.row);
    if (beside) {
      const at = placeBy(box!, near.offsetWidth, near.offsetHeight, "above", 6);
      near.style.left = `${Math.round(at.left)}px`;
      near.style.top = `${Math.round(at.top)}px`;
    }
    if (popped !== null) placeChipPopover();
  };
  pb.onUpdate(settle);

  // A chip opens its section; in the panel a heading folds its section; the panel's buttons.
  const onChip = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-vchip]");
    if (chip) {
      const id = chip.dataset["vchip"]!;
      if (place === "panel" && !opts.mini() && chip.closest(".props-chips")) return openInPanel(id);
      return popSection(chip, id);
    }
    if (t.closest("[data-props-toggle]")) {
      opts.setPin(panel.hidden ? (bar.hidden ? "open" : "auto") : "closed");
      settle();
    }
  };
  for (const el of [chips.row, near, miniList]) el.addEventListener("click", onChip);
  // (a press on the chips is not a press on the canvas under them)
  near.addEventListener("pointerdown", (e) => e.stopPropagation());
  row.addEventListener("click", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-ps-head]");
    if (!h) return;
    const id = h.dataset["psHead"]!;
    const folded = new Set(opts.folded());
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
    opts.setFolded([...folded]);
    settle();
  });
  panel.querySelector("[data-close]")!.addEventListener("click", () => {
    opts.setPin("closed");
    settle();
  });
  panel.querySelector("[data-props-pin]")!.addEventListener("click", () => {
    opts.setPin(opts.pin() === "open" ? "auto" : "open");
    settle();
  });
  panel.querySelector("[data-props-mini]")!.addEventListener("click", () => {
    closePop();
    opts.setMini(!opts.mini());
    settle();
  });
  const openInPanel = (id: string): void => {
    if (opts.pin() === "closed") opts.setPin("auto");
    const folded = new Set(opts.folded());
    if (folded.delete(id)) opts.setFolded([...folded]);
    if (opts.mini()) opts.setMini(false);
    settle();
    row.querySelector<HTMLElement>(`[data-ps-head="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };

  // The command palette finds every control, also one in a closed chip or a folded section: it is shown first.
  setControlRevealer((el) => {
    if (!bar.contains(el) || place === "bar") return;
    const item = [...row.querySelectorAll<HTMLElement>(":scope > .tb-group > *")].find((it) => it.contains(el));
    const id = item?.dataset["section"] ?? item?.parentElement?.dataset["section"] ?? "options";
    if (place === "panel" && !opts.mini()) return openInPanel(id);
    if (popped === id) return;
    const chip = document.querySelector<HTMLElement>(`.props-chips:not([hidden]) [data-vchip="${CSS.escape(id)}"], .props-near:not([hidden]) [data-vchip="${CSS.escape(id)}"], [data-props-minilist]:not([hidden]) [data-vchip="${CSS.escape(id)}"]`);
    if (chip) popSection(chip, id);
  });
  return { el: panel, refresh: settle };
}
