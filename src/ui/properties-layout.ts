import { createBar, hoverNames, syncScroll } from "./bar";
import { ICONS } from "./icons";
import { arrangeForm, nameControls, sectionIcon, sectionLabel, sectionSummary, showSections, shownSections, sectionOfControl } from "./bar-sections";
import { closeChipPopover, followChip, openChipPopover, placeChipPopover, syncChips } from "./value-chips";
import type { ChipSpec } from "./value-chips";
import { inRoom, selectionBoxIn, placeAbove } from "./near-selection";
import { setControlRevealer } from "../commands/from-bars";
import type { PropertiesBar } from "./toolbar";
import type { EditorState } from "../app/editor-state";

/**
 * How the Properties bar is shown (ADR 0198, Settings > Appearance > Properties): as it is (one row at the top), or as value chips just above
 * the selection (one chip per section, saying what it is set to, each opening its controls under it). With nothing selected (a tool's own
 * options) or the selection out of view, the chips stand at the top. The controls are always the same ones, moved: the bar itself goes into
 * the chip's popover, or waits, unseen, in its parking place; so whatever they do (live numbers, colour pickers, the command palette,
 * shortcuts) works the same.
 */
export type PropertiesPlace = "bar" | "near";
/** The chip of the colours of a selection of several shapes. */
const COLOURS = "colours";

export function mountPropertiesLayout(root: HTMLElement, canvasHost: HTMLElement, editor: EditorState, pb: PropertiesBar, place: () => PropertiesPlace): { refresh(): void; follow(): void } {
  const { bar, row, colours } = pb;
  const home = bar.parentElement!;
  // Where the bar waits, unseen, while it is shown as chips: in the same root (so it is still found there), hidden.
  const park = document.createElement("div");
  park.className = "props-park";
  park.hidden = true;
  root.append(park);
  // The chips at the top (a bar of the standard shape, after the Properties bar's own place), and the ones just above the selection.
  const top = createBar("Properties", "Properties");
  delete top.el.dataset["cmdGroup"]; // (the chips are not commands: the controls they open are)
  top.el.classList.add("props-chips");
  bar.after(top.el);
  const near = document.createElement("div");
  near.className = "props-near";
  near.hidden = true;
  canvasHost.append(near);
  // (the chips by the selection in a row of their own: the names shown on hover float in a layer beside it, as the Actions bar's: ADR 0197)
  const nearRow = document.createElement("div");
  nearRow.className = "props-row";
  near.append(nearRow);
  top.row.classList.add("props-row");
  const names = [hoverNames(nearRow, near), hoverNames(top.row, top.el)];
  // (every control gets a name of its own, seen when the bar is laid out as a form in a popover)
  nameControls(row);

  let now: PropertiesPlace = "bar";
  /** The section a chip's popover shows now (null: none is open). */
  let popped: string | null = null;

  const closePop = (): void => {
    if (popped !== null) closeChipPopover();
  };
  /**
   * Open a section's controls under its chip: the bar moves into the popover, laid out as a form, showing that section only. The colours of a
   * selection of several shapes (a bar of their own at the top) are one more chip, "Colours", whose popover holds that bar.
   */
  const popSection = (anchor: HTMLElement, id: string): void => {
    openChipPopover(anchor, id === COLOURS ? "Colours" : sectionLabel(id), (pop) => {
      popped = id;
      if (id === COLOURS) return void move(colours, () => pop.append(colours));
      bar.classList.add("is-form");
      showSections(row, new Set([id]));
      arrangeForm(row);
      move(bar, () => pop.append(bar));
    }, () => {
      popped = null;
      bar.classList.remove("is-form");
      showSections(row, null);
      settle();
    });
  };

  // (a section that is one choice, the kind to edit, shows the icon of what is chosen: the Sheet tool's for a sheet)
  const chipIcon = (id: string): string => (id === "kind" ? row.querySelector('[data-subject][aria-checked="true"] svg')?.outerHTML : undefined) ?? sectionIcon(id);
  const coloursValue = (): string => [...colours.querySelectorAll<HTMLElement>("[data-sel-colour]")].slice(0, 3).map((b) => `<span class="vchip-sw${b.hasAttribute("data-ring") ? " is-ring" : ""}" style="--sw:${b.querySelector<HTMLElement>("[data-paint-chip]")?.style.getPropertyValue("--paint") ?? ""}"></span>`).join("");
  const chipsOf = (ids: readonly string[]): ChipSpec[] => ids.map((id) => (id === COLOURS ? { id, label: "Colours", icon: ICONS.palette, value: coloursValue(), title: "Colours: every colour of the selection, each to change everywhere" } : { id, label: sectionLabel(id), icon: chipIcon(id), value: sectionSummary(row, id), title: `${sectionLabel(id)}: open its options` }));

  /** Lay everything out for the current place, after every update of the bar and every frame. */
  /**
   * Move one of the bars somewhere else. A field inside it that has the focus is left first (its change and blur run now, while it is still
   * in place), and a move asked for by what that sets off is done after this one, never inside it.
   */
  let moving = false;
  const move = (el: HTMLElement, put: () => void): void => {
    if (moving) return;
    moving = true;
    try {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && el.contains(focused)) focused.blur();
      put();
    } finally {
      moving = false;
    }
  };
  let settling = false;
  let again = false;
  const settle = (): void => {
    if (settling) {
      again = true; // (asked for while laying out: once more, after)
      return;
    }
    settling = true;
    try {
      do {
        again = false;
        settleOnce();
      } while (again);
    } finally {
      settling = false;
    }
  };
  const settleOnce = (): void => {
    const was = now;
    now = place();
    if (was !== now) closePop();
    bar.toggleAttribute("data-parked", now !== "bar");
    colours.toggleAttribute("data-parked", now !== "bar");
    if (now === "bar") {
      if (bar.parentElement !== home) move(bar, () => home.insertBefore(bar, top.el));
      if (colours.parentElement !== home) move(colours, () => top.el.after(colours));
      top.el.hidden = true;
      near.hidden = true;
      return;
    }
    const ids = [...(bar.hidden ? [] : shownSections(row)), ...(colours.hidden || !colours.querySelector("[data-sel-colour]") ? [] : [COLOURS])];
    if (popped === null && bar.parentElement !== park) move(bar, () => park.append(bar));
    if (popped !== COLOURS && colours.parentElement !== park) move(colours, () => park.append(colours));
    if (popped !== null && !ids.includes(popped)) closePop();
    // (while something is dragged the chips step aside, as the Actions bar does: they do not follow it about, nor jump to the top)
    // (an open popover is being worked in: a value changed there previews too, and must not close it)
    if (editor.gesturing && popped === null) {
      closePop();
      near.hidden = top.el.hidden = true;
      return;
    }
    const box = selectionBoxIn(canvasHost, editor);
    // (by the selection only when the options are the selection's, as the Actions bar shows only then: with another tool picked they are
    // that tool's, and stand at the top)
    const beside = editor.editsSelection && editor.selection.size > 0 && !editor.editingText && !!box && inRoom(box) && ids.length > 0;
    const host = beside ? nearRow : top.row;
    // (the same chips in the same place keep their elements: an open popover stays under its chip)
    syncChips(host, chipsOf(ids));
    syncChips(beside ? top.row : nearRow, []);
    for (const n of names) n.place();
    top.el.hidden = beside || ids.length === 0;
    near.hidden = !beside;
    syncScroll(top.row);
    if (beside) syncScroll(nearRow); // (a small window: the chips by the selection scroll sideways, as the Actions bar)
    if (beside) {
      placeAbove(near, box!); // (the rotate handle stays free; the format bar of words being typed stands the same way)
    }
    if (popped !== null) {
      if (popped !== COLOURS) arrangeForm(row); // (what shows may have changed: the lines between kinds follow)
      followChip(host.querySelector<HTMLElement>(`[data-vchip="${CSS.escape(popped)}"]`));
      placeChipPopover();
    }
  };
  pb.onUpdate(settle);

  const onChip = (e: MouseEvent): void => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-vchip]");
    if (chip) popSection(chip, chip.dataset["vchip"]!);
  };
  for (const el of [top.row, nearRow]) el.addEventListener("click", onChip);
  // (a press on the chips is not a press on the canvas under them)
  near.addEventListener("pointerdown", (e) => e.stopPropagation());

  // The command palette finds every control, also one in a closed chip: its chip is opened first.
  setControlRevealer((el) => {
    if (!(bar.contains(el) || colours.contains(el)) || now === "bar") return;
    const id = colours.contains(el) ? COLOURS : sectionOfControl(row, el);
    if (popped === id) return;
    const chip = document.querySelector<HTMLElement>(`.props-chips:not([hidden]) [data-vchip="${CSS.escape(id)}"], .props-near:not([hidden]) [data-vchip="${CSS.escape(id)}"]`);
    if (chip) popSection(chip, id);
  });
  // (near the selection, the chips follow it after every frame, as the Actions bar does: the selection's place on the screen is known once drawn)
  return { refresh: settle, follow: () => { if (now === "near") settle(); } };
}
