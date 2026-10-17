import type { EditorState } from "../app/editor-state";
import type { StyleItem, StyleLibrary, PaletteData } from "../assets/styles";
import { STYLE_KINDS, gradientCss } from "../assets/styles";
import { parseGgr, serializeGgr } from "../assets/ggr";
import { MAX_PALETTE, parseGpl, serializeGpl } from "../assets/gpl";
import type { PaletteColour } from "../assets/gpl";
import { harmonies, parseHex, rgbToHex } from "../colour-picker/index";
import type { Harmony } from "../colour-picker/colour";
import type { Gradient, Paint } from "../doc/paint";
import { writeZip } from "../storage/zip";
import { openColourPopover, openGradientPopover } from "./colour-popover";
import { chooseDialog, confirmDialog } from "./confirm";
import { saveFile } from "./file-actions";
import { esc } from "./format";
import { ICONS } from "./icons";
import { moreButton, openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";

/**
 * Floating Styles panel (ADR 0120, 0122): everything the person saves to use again, in one place. One folding section per kind, a search box,
 * and a card per style: an adjustment says what it does, a gradient shows its bar, a colour its swatch, a palette its row of colours (open it
 * to use a single colour, or edit it: change a colour, name it, add or remove). Pick items on the canvas, then press a card to apply it; a
 * style that fits shapes asks whether it is for the fill or the outline when several are picked. Gradients are read and written as GIMP
 * `.ggr` files and palettes as `.gpl` (several at once: a ZIP). A kind is listed only when the app can apply it, so a new kind is one entry
 * in `STYLE_KINDS` and one handler here. Hidden by default, like the other panels.
 */
export interface StylesDeps {
  /** Whether the selection can take an adjustment, and applying one. */
  adjustment: { can(): boolean; apply(item: StyleItem): void };
  paint: {
    /** How many shapes are picked that a colour or gradient can go on. */
    count(): number;
    /** Put a colour or gradient on them: on `target` (the person's choice in the panel); with `ask`, and several shapes picked, the app asks which part first. */
    apply(paint: Paint, label: string, target: "fill" | "stroke" | "both", ask: boolean): void;
  };
  /** Pictures take a gradient as a gradient map: how many are picked, and putting one on them. */
  map: { count(): number; apply(stops: Gradient["stops"], label: string): void };
  /** The solid colours of the picked shapes, and the main colours of the one picked picture (null: none is picked). */
  selectionColours(): string[];
  picturePalette(): Promise<string[] | null>;
  notify(text: string): void;
}

const MAX_NAME = 40;
const slug = (s: string, fallback: string): string => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").toLowerCase().slice(0, 60) || fallback;
const dataOf = <T>(item: StyleItem): T => item.data as T;
const hueLightness = (hex: string): [number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, (max + min) / 2];
};

export function mountStylesPanel(host: HTMLElement, editor: EditorState, styles: StyleLibrary, deps: StylesDeps): void {
  const panel = document.createElement("aside");
  panel.className = "layers-panel styles-panel";
  panel.setAttribute("aria-label", "Styles");
  panel.dataset["testid"] = "styles-panel";
  host.appendChild(panel);
  let filter = "";
  let scheduled = false;
  /** The tab shown (a kind), and which part of a shape a colour or gradient goes on. */
  let tab = "adjustment";
  let target: "fill" | "stroke" | "both" = "fill";
  const folded = new Set<string>();
  /** The style being renamed. */
  let renaming: string | null = null;
  /** Palettes opened to show their colours, and the one being edited. */
  const opened = new Set<string>();
  let editing: string | null = null;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = ".ggr,.gpl";
  fileInput.hidden = true;
  fileInput.dataset["testid"] = "styles-import";
  panel.appendChild(fileInput);

  const canApply = (kind: string): boolean => (kind === "adjustment" ? deps.adjustment.can() : deps.paint.count() > 0 || (kind === "gradient" && deps.map.count() > 0));
  const kindsShown = STYLE_KINDS;

  const card = (item: StyleItem, can: boolean): string => {
    const k = kindsShown.find((x) => x.id === item.kind)!;
    const look = k.look?.(item.data);
    const title = can ? `Apply ${item.name} to the selection` : "Select items it applies to first";
    const body =
      item.kind === "gradient"
        ? `<span class="style-card-name">${esc(item.name)}</span><span class="style-bar" style="background:${esc(look?.bar ?? "")}"></span><span class="style-card-sum">${esc(k.summary(item.data))}</span>`
        : item.kind === "colour"
          ? `<span class="style-card-line"><span class="style-swatch" style="background:${esc(String(item.data))}"></span><span class="style-card-name">${esc(item.name)}</span></span><span class="style-card-sum">${esc(k.summary(item.data))}</span>`
          : item.kind === "palette"
            ? `<span class="style-card-name">${esc(item.name)}</span><span class="style-strip">${(look?.swatches ?? []).slice(0, 24).map((c) => `<span style="background:${esc(c)}"></span>`).join("")}</span><span class="style-card-sum">${esc(k.summary(item.data))}</span>`
            : `<span class="style-card-name">${esc(item.name)}</span><span class="style-card-sum">${esc(k.summary(item.data))}</span>`;
    if (renaming === item.id) return `<li><input class="style-rename" data-rename="${esc(item.id)}" value="${esc(item.name)}" maxlength="60" aria-label="New name for ${esc(item.name)}"></li>`;
    const more = moreButton(`More actions for style ${item.name}`, `data-more="${esc(item.id)}"`);
    if (item.kind === "palette") {
      const pal = dataOf<PaletteData>(item);
      const isOpen = opened.has(item.id) || editing === item.id;
      return `<li class="style-palette${isOpen ? " is-open" : ""}"><button type="button" class="style-card" data-toggle="${esc(item.id)}" aria-expanded="${isOpen}" title="Show the colours">${body}</button>${more}${isOpen ? (editing === item.id ? paletteEditor(item, pal) : paletteGrid(pal, can)) : ""}</li>`;
    }
    return `<li><button type="button" class="style-card" data-style="${esc(item.id)}" title="${esc(title)}"${can ? "" : " disabled"}>${body}</button>${more}</li>`;
  };

  const paletteGrid = (pal: PaletteData, can: boolean): string =>
    `<div class="palette-grid" role="group" aria-label="Colours of the palette">${pal.colours.map((c, i) => `<button type="button" class="palette-chip" data-chip="${i}" style="background:${esc(c.c)}" title="${esc(c.name ? `${c.name} ${c.c.toUpperCase()}` : c.c.toUpperCase())}${can ? "" : " (select shapes first)"}" aria-label="${esc(c.name || c.c.toUpperCase())}"${can ? "" : " disabled"}></button>`).join("")}</div>`;

  const paletteEditor = (item: StyleItem, pal: PaletteData): string =>
    `<div class="palette-edit" data-testid="palette-editor">${pal.colours
      .map((c, i) => `<div class="pal-row"><button type="button" class="pal-swatch" data-edit-colour="${i}" style="background:${esc(c.c)}" title="Change this colour" aria-label="Change the colour ${esc(c.name || c.c.toUpperCase())}"></button><input class="pal-name" data-colour-name="${i}" value="${esc(c.name ?? "")}" placeholder="${esc(c.c.toUpperCase())}" maxlength="${MAX_NAME}" aria-label="Name of colour ${i + 1}"><button type="button" class="layer-btn" data-remove-colour="${i}" aria-label="Remove ${esc(c.name || c.c.toUpperCase())}" title="Remove"${pal.colours.length < 2 ? " disabled" : ""}>${ICONS.x}</button></div>`)
      .join("")}<div class="pal-actions"><button type="button" class="pal-add" data-add-colour="${esc(item.id)}"${pal.colours.length >= MAX_PALETTE ? " disabled" : ""}>Add colour</button><button type="button" class="pal-done" data-done>Done</button></div></div>`;

  const TAB_ICON: Record<string, string> = { adjustment: ICONS.slidersHorizontal, gradient: ICONS.blend, colour: ICONS.droplet, palette: ICONS.palette };
  const GUIDE: Record<string, string> = {
    adjustment: "Save an adjustment from the Adjust panel of a picture, then press it here to give other pictures the same look.",
    gradient: "A gradient is a blend of colours. Save one from the fill or outline picker, make a new one here, or import a GIMP .ggr file.",
    colour: "Keep the colours you use. Add one here, or save one from any colour picker.",
    palette: "A palette is a set of colours you reuse together, like a brand's.",
  };

  const render = (): void => {
    scheduled = false;
    panel.hidden = !editor.stylesOpen;
    if (!editor.stylesOpen) return;
    const active = document.activeElement as HTMLInputElement | null;
    if (active && panel.contains(active) && active.matches("[data-rename], [data-colour-name]")) return; // (a name being typed is not redrawn under the cursor)
    const typing = !!active && panel.contains(active) && active.matches("[data-styles-filter]");
    const q = filter.trim().toLowerCase();
    const total = styles.items.filter((s) => kindsShown.some((k) => k.id === s.kind)).length;
    const k = kindsShown.find((x) => x.id === tab) ?? kindsShown[0]!;
    const all = styles.of(k.id);
    const items = all.filter((s) => !q || s.name.toLowerCase().includes(q));
    const can = canApply(k.id);
    const paints = k.id !== "adjustment";
    const tabs = kindsShown
      .map((t) => {
        const n = styles.of(t.id).filter((s) => !q || s.name.toLowerCase().includes(q)).length;
        return `<button type="button" role="tab" class="styles-tab" data-tab="${t.id}" aria-selected="${t.id === k.id}" tabindex="${t.id === k.id ? 0 : -1}" aria-label="${esc(t.plural)} (${n})" title="${esc(t.plural)}">${TAB_ICON[t.id] ?? ""}<span class="styles-tab-n">${n}</span></button>`;
      })
      .join("");
    const seg = (v: "fill" | "stroke" | "both", text: string, tip: string): string => `<button type="button" role="radio" data-target="${v}" aria-checked="${target === v}" title="${tip}">${text}</button>`;
    const actions =
      k.id === "palette"
        ? `<button type="button" class="styles-make" data-new aria-haspopup="menu">${ICONS.palette}<span>New palette</span></button>`
        : k.id === "colour"
          ? `<button type="button" class="styles-make" data-add-style-colour>${ICONS.droplet}<span>Add a colour</span></button>`
          : k.id === "gradient"
            ? `<button type="button" class="styles-make" data-new-gradient>${ICONS.blend}<span>New gradient</span></button><button type="button" class="styles-make" data-import>${ICONS.fileUp}<span>Import .ggr</span></button>`
            : "";
    const empty =
      all.length === 0
        ? k.id === "palette"
          ? `<div class="styles-empty" data-testid="palette-empty"><p>${esc(GUIDE["palette"]!)}</p><div class="styles-empty-actions"><button type="button" data-new-from="selection">From the selected shapes' colours</button><button type="button" data-new-from="picture">From a picked picture</button><button type="button" data-new-from="colour">From one colour you like</button><button type="button" data-new-from="empty">Start empty</button><button type="button" data-import>Import a .gpl file</button></div></div>`
          : `<p class="styles-guide">${esc(GUIDE[k.id] ?? k.empty)}</p>`
        : "";
    panel.innerHTML = `
      <header><h2>Styles <span class="layers-count">${total}</span></h2>
        <span class="layers-tools"><button type="button" class="layer-btn" data-import aria-label="Import styles" title="Import GIMP gradients (.ggr) and palettes (.gpl)">${ICONS.fileUp}</button><button type="button" class="layer-btn" data-close aria-label="Hide the Styles panel" title="Hide the Styles panel">${ICONS.x}</button></span></header>
      <div class="styles-tabs" role="tablist" aria-label="Kinds of style">${tabs}</div>
      <div class="layers-filter"><input type="search" data-styles-filter placeholder="Search ${esc(k.plural.toLowerCase())}" aria-label="Search the ${esc(k.plural.toLowerCase())} by name" autocomplete="off" value="${esc(filter)}"></div>
      <div class="styles-body" role="tabpanel" aria-label="${esc(k.plural)}">
        <div class="styles-tab-head"><h3>${esc(k.plural)}</h3>${k.id === "gradient" || k.id === "palette" ? moreButton(`More actions for ${k.plural}`, `data-kind-more="${k.id}"`) : ""}</div>
        ${paints ? `<div class="styles-target" role="radiogroup" aria-label="Apply to"><span>Apply to</span>${seg("fill", "Fill", "Colours go on the fill of the picked shapes")}${seg("stroke", "Outline", "Colours go on the outline of the picked shapes")}${seg("both", "Both", "Fill and outline")}</div>` : ""}
        ${!can ? `<p class="styles-hint">${ICONS.pointer}<span>${paints ? (k.id === "gradient" ? "Select shapes or pictures on the canvas, then press one to apply it (on a picture it becomes a gradient map)." : "Select shapes on the canvas, then press one to apply it.") : "Select pictures on the canvas, then press one to apply it."}</span></p>` : ""}
        ${actions ? `<div class="styles-actions">${actions}</div>` : ""}
        ${empty}
        ${all.length ? `<ul class="styles-list" aria-label="${esc(k.plural)}">${items.map((st) => card(st, can)).join("") || `<li class="layers-empty">No ${esc(k.plural.toLowerCase())} match.</li>`}</ul>` : ""}
      </div>`;
    panel.appendChild(fileInput);
    if (typing) {
      const el = panel.querySelector<HTMLInputElement>("[data-styles-filter]");
      el?.focus();
      el?.setSelectionRange(filter.length, filter.length);
    }
  };
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  editor.subscribe(schedule);
  styles.subscribe(schedule);
  render();

  const find = (id: string | undefined): StyleItem | undefined => styles.items.find((s) => s.id === id);
  const paletteOf = (item: StyleItem): PaletteColour[] => [...dataOf<PaletteData>(item).colours];
  const setPalette = (item: StyleItem, colours: PaletteColour[]): Promise<boolean> => styles.update(item.id, { colours });
  const addPalette = async (name: string, colours: readonly (string | PaletteColour)[], then?: (made: StyleItem) => void): Promise<void> => {
    const list = colours.slice(0, MAX_PALETTE).map((c) => (typeof c === "string" ? { c } : c));
    const made = list.length ? await styles.add("palette", name, { colours: list }) : null;
    if (!made) return deps.notify("Nothing to make a palette from.");
    opened.add(made.id);
    then?.(made);
    deps.notify(`Made the palette “${made.name}” (${list.length} colours).`);
  };

  // ---- Export and import (GIMP files) -----------------------------------------------------------------------------------------
  const exportItems = async (kind: "gradient" | "palette", items: readonly StyleItem[]): Promise<void> => {
    if (!items.length) return;
    const ext = kind === "gradient" ? "ggr" : "gpl";
    const text = (s: StyleItem): string => (kind === "gradient" ? serializeGgr(s.name, dataOf<Gradient>(s)) : serializeGpl(s.name, dataOf<PaletteData>(s).colours));
    if (items.length === 1) {
      saveFile(`${slug(items[0]!.name, kind)}.${ext}`, new Blob([text(items[0]!)], { type: "text/plain" }));
      return deps.notify(`Saved ${slug(items[0]!.name, kind)}.${ext}`);
    }
    const used = new Set<string>();
    const entries = items.map((s) => {
      let n = slug(s.name, kind), i = 2;
      const base = n;
      while (used.has(n)) n = `${base}_${i++}`;
      used.add(n);
      return { name: `${n}.${ext}`, data: new Blob([text(s)], { type: "text/plain" }) };
    });
    saveFile(`${kind === "gradient" ? "gradients" : "palettes"}.zip`, await writeZip(entries));
    deps.notify(`Saved ${items.length} ${kind === "gradient" ? "gradients" : "palettes"} as ${ext} files in a ZIP.`);
  };

  const importFiles = async (files: readonly File[]): Promise<void> => {
    let gradients = 0, palettes = 0, skipped = 0;
    const notes = new Set<string>();
    for (const f of files) {
      const base = f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
      let text = "";
      try {
        text = await f.text();
      } catch {
        skipped++;
        continue;
      }
      const g = /\.ggr$/i.test(f.name) ? parseGgr(text, base) : null;
      const p = !g && /\.gpl$/i.test(f.name) ? parseGpl(text, base) : null;
      if (g && (await styles.add("gradient", g.name.slice(0, 60), g.gradient))) {
        gradients++;
        for (const n of g.notes) notes.add(n);
      } else if (p && (await styles.add("palette", p.name.slice(0, 60), { colours: p.colours }))) palettes++;
      else skipped++;
    }
    const said = [gradients ? `${gradients} gradient${gradients === 1 ? "" : "s"}` : "", palettes ? `${palettes} palette${palettes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    deps.notify(said ? `Imported ${said}${skipped ? `; ${skipped} file${skipped === 1 ? " was" : "s were"} not a GIMP gradient or palette` : ""}${notes.size ? ` (${[...notes].join("; ")})` : ""}.` : "Nothing imported: pick GIMP gradient (.ggr) or palette (.gpl) files.");
  };
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    void importFiles(files);
  });

  // ---- Menus ------------------------------------------------------------------------------------------------------------------
  const copyText = (text: string, what: string): void => void navigator.clipboard?.writeText(text).then(() => deps.notify(`Copied ${what}.`), () => deps.notify("Could not copy."));
  const editColour = (anchor: HTMLElement, name: string, value: string, change: (hex: string) => void): void =>
    openColourPopover(anchor, { name, value, alpha: true, onInput: () => undefined, onChange: change });
  const remove = (item: StyleItem): void => void confirmDialog({ title: `Delete “${item.name}”?`, lines: ["It is removed from the saved styles. What it was used on keeps its look."], confirmLabel: "Delete" }).then((ok) => { if (ok) void styles.remove(item.id); });
  const common = (item: StyleItem): MenuItem[] => [
    { label: "Rename", icon: ICONS.textCursorInput, aria: `Rename style ${item.name}`, run: () => { renaming = item.id; render(); panel.querySelector<HTMLInputElement>("[data-rename]")?.select(); } },
    { label: "Duplicate", icon: ICONS.copy, aria: `Duplicate style ${item.name}`, run: () => void styles.duplicate(item.id) },
  ];
  const menuFor = (item: StyleItem): MenuItem[] => {
    const can = canApply(item.kind);
    const del: MenuItem = { label: "Delete", icon: ICONS.trash2, danger: true, aria: `Delete style ${item.name}`, run: () => remove(item) };
    if (item.kind === "gradient")
      return [
        { label: "Apply to the fill", icon: ICONS.pointer, disabled: deps.paint.count() === 0, aria: `Apply ${item.name} to the fill`, run: () => deps.paint.apply(item.data as Paint, item.name, "fill", false) },
        { label: "Apply to the outline", icon: ICONS.pointer, disabled: deps.paint.count() === 0, aria: `Apply ${item.name} to the outline`, run: () => deps.paint.apply(item.data as Paint, item.name, "stroke", false) },
        { label: "Edit the gradient", icon: ICONS.blend, aria: `Edit the gradient ${item.name}`, run: () => openGradientPopover(panel.querySelector<HTMLElement>(`[data-more="${item.id}"]`)!, { name: `Gradient ${item.name}`, gradient: item.data as Gradient, onChange: (g) => void styles.update(item.id, g) }) },
        ...common(item),
        { label: "Export as .ggr", icon: ICONS.download, aria: `Export ${item.name} as a GIMP gradient`, run: () => void exportItems("gradient", [item]) },
        del,
      ];
    if (item.kind === "colour")
      return [
        { label: "Apply to the fill", icon: ICONS.pointer, disabled: deps.paint.count() === 0, aria: `Apply ${item.name} to the fill`, run: () => deps.paint.apply(item.data as Paint, item.name, "fill", false) },
        { label: "Apply to the outline", icon: ICONS.pointer, disabled: deps.paint.count() === 0, aria: `Apply ${item.name} to the outline`, run: () => deps.paint.apply(item.data as Paint, item.name, "stroke", false) },
        { label: "Change colour", icon: ICONS.pipette, aria: `Change the colour of ${item.name}`, run: () => editColour(panel.querySelector<HTMLElement>(`[data-more="${item.id}"]`)!, `Colour ${item.name}`, String(item.data), (hex) => void styles.update(item.id, hex)) },
        { label: "Copy hex", icon: ICONS.clipboardCopy, aria: `Copy the hex of ${item.name}`, run: () => copyText(String(item.data).toUpperCase(), String(item.data).toUpperCase()) },
        ...common(item),
        del,
      ];
    if (item.kind === "palette") {
      const cols = paletteOf(item);
      const sorted = (by: "hue" | "light"): PaletteColour[] => [...cols].sort((a, b) => (by === "hue" ? hueLightness(a.c)[0] - hueLightness(b.c)[0] : hueLightness(a.c)[1] - hueLightness(b.c)[1]));
      const fromSel = deps.selectionColours();
      return [
        { label: editing === item.id ? "Finish editing" : "Edit colours", icon: ICONS.pencilLine, aria: `Edit the colours of ${item.name}`, run: () => { editing = editing === item.id ? null : item.id; opened.add(item.id); render(); } },
        { label: "Add the selection's colours", icon: ICONS.listPlus, disabled: fromSel.length === 0, aria: `Add the colours of the selection to ${item.name}`, run: () => void setPalette(item, [...cols, ...fromSel.filter((c) => !cols.some((x) => x.c === c)).map((c) => ({ c }))].slice(0, MAX_PALETTE)) },
        { label: "Sort by hue", icon: ICONS.arrowUpDown, aria: `Sort ${item.name} by hue`, run: () => void setPalette(item, sorted("hue")) },
        { label: "Sort by lightness", icon: ICONS.arrowUpDown, aria: `Sort ${item.name} by lightness`, run: () => void setPalette(item, sorted("light")) },
        { label: "Copy as CSS variables", icon: ICONS.clipboardCopy, aria: `Copy ${item.name} as CSS variables`, run: () => copyText(`:root {\n${cols.map((c, i) => `  --${slug(item.name, "palette")}-${slug(c.name ?? "", String(i + 1))}: ${c.c};`).join("\n")}\n}`, "the CSS variables") },
        ...common(item),
        { label: "Export as .gpl", icon: ICONS.download, aria: `Export ${item.name} as a GIMP palette`, run: () => void exportItems("palette", [item]) },
        del,
      ];
    }
    return [...common(item), del];
  };

  const harmonyPalette = async (anchor: HTMLElement): Promise<void> => {
    const kind = await chooseDialog({
      title: "Palette from a colour",
      lines: ["Pick how the other colours follow the one you choose next."],
      choices: [
        { value: "analogous", label: "Analogous", help: "Neighbours on the colour wheel: calm and close" },
        { value: "complementary", label: "Complementary", help: "The opposite colour: strong contrast" },
        { value: "split", label: "Split complementary", help: "The two beside the opposite: contrast, softer" },
        { value: "triad", label: "Triad", help: "Three colours evenly round the wheel" },
        { value: "tetrad", label: "Tetrad", help: "Four colours evenly round the wheel" },
      ],
      confirmLabel: "Choose the colour",
    });
    if (!kind) return;
    let base = "#2563eb";
    openColourPopover(anchor, {
      name: "Colour to build the palette on",
      value: base,
      onInput: (hex) => (base = hex),
      onChange: (hex) => (base = hex),
      onClose: () => {
        const rgb = parseHex(base);
        if (!rgb) return;
        const hex = (c: readonly number[]): string => rgbToHex(c as [number, number, number]);
        void addPalette(`${kind[0]!.toUpperCase()}${kind.slice(1)} ${base.slice(0, 7).toUpperCase()}`, [base.slice(0, 7), ...harmonies(rgb as [number, number, number], kind as Harmony).map(hex)]);
      },
    });
  };

  /** A colour or gradient goes on the picked shapes; a gradient also goes on the picked pictures, as a gradient map. */
  const applyPaint = (item: StyleItem): void => {
    if (item.kind === "gradient" && deps.map.count() > 0) deps.map.apply((item.data as Gradient).stops, item.name);
    if (deps.paint.count() > 0) deps.paint.apply(item.data as Paint, item.name, target, true);
  };

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-close]")) {
      editor.stylesOpen = false;
      editor.changed();
      return;
    }
    if (t.closest("[data-import]")) return fileInput.click();
    const tabBtn = t.closest<HTMLElement>("[data-tab]");
    if (tabBtn) {
      tab = tabBtn.dataset["tab"]!;
      render();
      return;
    }
    const seg = t.closest<HTMLElement>("[data-target]");
    if (seg) {
      target = seg.dataset["target"] as typeof target;
      render();
      return;
    }
    const addColour1 = t.closest<HTMLElement>("[data-add-style-colour]");
    if (addColour1) {
      let hex = "#2563eb";
      return editColour(addColour1, "A colour to keep", hex, (h) => {
        hex = h;
        void styles.add("colour", "", h);
        deps.notify(`Saved ${h.toUpperCase()}.`);
      });
    }
    const newGradient = t.closest<HTMLElement>("[data-new-gradient]");
    if (newGradient) {
      void styles.add("gradient", "", { type: "linear", x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: [{ o: 0, c: "#2563eb" }, { o: 1, c: "#f59e0b" }] }).then((made) => {
        if (!made) return;
        requestAnimationFrame(() => requestAnimationFrame(() => panel.querySelector<HTMLElement>(`[data-more="${made.id}"]`)?.click()));
        deps.notify(`Made “${made.name}”: open its ⋯ menu and choose Edit the gradient to change it.`);
      });
      return;
    }
    const from = t.closest<HTMLElement>("[data-new-from]");
    if (from) {
      const how = from.dataset["newFrom"]!;
      const sel = deps.selectionColours();
      if (how === "selection") void (sel.length ? addPalette(styles.nextName("palette"), sel) : Promise.resolve(deps.notify("Select shapes with colours first.")));
      else if (how === "picture") void deps.picturePalette().then((c) => (c ? addPalette(styles.nextName("palette"), c) : deps.notify("Pick one picture first.")));
      else if (how === "colour") void harmonyPalette(from);
      else void addPalette(styles.nextName("palette"), ["#808080"], (m) => { editing = m.id; render(); });
      return;
    }
    const add = t.closest<HTMLElement>("[data-new]");
    if (add) {
      const sel = deps.selectionColours();
      openMoreMenu(
        add,
        [
          { label: "Empty palette", icon: ICONS.palette, aria: "New empty palette", run: () => void addPalette(styles.nextName("palette"), ["#808080"], (m) => { editing = m.id; render(); }) },
          { label: "From the selection's colours", icon: ICONS.pointer, disabled: sel.length === 0, aria: "New palette from the selection", run: () => void addPalette(styles.nextName("palette"), sel) },
          { label: "From the picked picture", icon: ICONS.imagePlus, aria: "New palette from the picked picture", run: () => void deps.picturePalette().then((c) => (c ? addPalette(styles.nextName("palette"), c) : deps.notify("Pick one picture first."))) },
          { label: "From a colour (harmony)", icon: ICONS.pipette, aria: "New palette from a colour", run: () => void harmonyPalette(add) },
        ],
        "New style",
      );
      return;
    }
    const kindMore = t.closest<HTMLElement>("[data-kind-more]");
    if (kindMore) {
      const kind = kindMore.dataset["kindMore"] as "gradient" | "palette";
      const items = styles.of(kind);
      openMoreMenu(
        kindMore,
        [
          { label: `Export all as ${kind === "gradient" ? ".ggr" : ".gpl"}`, icon: ICONS.download, disabled: items.length === 0, aria: `Export all ${kind === "gradient" ? "gradients" : "palettes"}`, run: () => void exportItems(kind, items) },
          { label: "Import files", icon: ICONS.fileUp, aria: "Import GIMP files", run: () => fileInput.click() },
        ],
        `Actions for ${kind === "gradient" ? "gradients" : "palettes"}`,
      );
      return;
    }
    const fold = t.closest<HTMLElement>("[data-fold]");
    if (fold) {
      const k = fold.dataset["fold"]!;
      if (!folded.delete(k)) folded.add(k);
      render();
      return;
    }
    const more = t.closest<HTMLElement>("[data-more]");
    if (more) {
      const it = find(more.dataset["more"]);
      if (it) openMoreMenu(more, menuFor(it), `Actions for style ${it.name}`);
      return;
    }
    const toggle = t.closest<HTMLElement>("[data-toggle]");
    if (toggle) {
      const id = toggle.dataset["toggle"]!;
      if (!opened.delete(id)) opened.add(id);
      if (editing === id && !opened.has(id)) editing = null;
      render();
      return;
    }
    const chip = t.closest<HTMLElement>("[data-chip]");
    if (chip) {
      const owner = find(chip.closest<HTMLElement>(".style-palette")?.querySelector<HTMLElement>("[data-toggle]")?.dataset["toggle"]);
      const c = owner ? paletteOf(owner)[Number(chip.dataset["chip"])] : undefined;
      if (c && deps.paint.count()) deps.paint.apply(c.c, c.name || c.c.toUpperCase(), target, true);
      return;
    }
    // palette editing
    const ownerOf = (el: HTMLElement): StyleItem | undefined => find(el.closest<HTMLElement>(".style-palette")?.querySelector<HTMLElement>("[data-toggle]")?.dataset["toggle"]);
    const editBtn = t.closest<HTMLElement>("[data-edit-colour]");
    if (editBtn) {
      const owner = ownerOf(editBtn);
      const i = Number(editBtn.dataset["editColour"]);
      const cur = owner ? paletteOf(owner)[i] : undefined;
      if (owner && cur) editColour(editBtn, `Colour ${i + 1} of ${owner.name}`, cur.c, (hex) => { const list = paletteOf(owner); list[i] = { ...list[i]!, c: hex.toLowerCase() }; void setPalette(owner, list); });
      return;
    }
    const rm = t.closest<HTMLElement>("[data-remove-colour]");
    if (rm) {
      const owner = ownerOf(rm);
      if (owner) void setPalette(owner, paletteOf(owner).filter((_, i) => i !== Number(rm.dataset["removeColour"])));
      return;
    }
    const addColour = t.closest<HTMLElement>("[data-add-colour]");
    if (addColour) {
      const owner = find(addColour.dataset["addColour"]);
      if (!owner) return;
      const list = paletteOf(owner);
      list.push({ c: list.at(-1)?.c ?? "#808080" });
      void setPalette(owner, list).then(() => requestAnimationFrame(() => requestAnimationFrame(() => panel.querySelectorAll<HTMLElement>("[data-edit-colour]")[list.length - 1]?.click())));
      return;
    }
    if (t.closest("[data-done]")) {
      editing = null;
      render();
      return;
    }
    const row = t.closest<HTMLElement>("[data-style]");
    const item = find(row?.dataset["style"]);
    if (!item || !canApply(item.kind)) return;
    if (item.kind === "adjustment") deps.adjustment.apply(item);
    else applyPaint(item);
  });
  panel.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches("[data-styles-filter]")) return;
    filter = t.value;
    render();
  });
  panel.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches("[data-colour-name]")) return;
    const owner = find(t.closest<HTMLElement>(".style-palette")?.querySelector<HTMLElement>("[data-toggle]")?.dataset["toggle"]);
    if (!owner) return;
    const list = paletteOf(owner);
    const i = Number(t.dataset["colourName"]);
    const name = t.value.trim().slice(0, MAX_NAME);
    list[i] = { c: list[i]!.c, ...(name ? { name } : {}) };
    void setPalette(owner, list);
  });
  panel.addEventListener("keydown", (e) => {
    const tb = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (tb && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End")) {
      const ids = kindsShown.map((x) => x.id);
      const at = ids.indexOf(tb.dataset["tab"]!);
      tab = ids[e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length]!;
      e.preventDefault();
      render();
      panel.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
      return;
    }
    const t = e.target as HTMLInputElement;
    if (!t.matches?.("input")) return;
    e.stopPropagation(); // typing here never reaches the canvas shortcuts
    if (t.matches("[data-rename]")) {
      if (e.key === "Enter") {
        const id = t.dataset["rename"]!;
        renaming = null;
        const name = t.value;
        t.blur(); // (a box that has the focus is not redrawn)
        void styles.rename(id, name).then(render);
      } else if (e.key === "Escape") {
        renaming = null;
        t.blur();
        render();
      }
    } else if (t.matches("[data-colour-name]")) {
      if (e.key === "Enter") t.blur();
    } else if (e.key === "Escape") {
      filter = "";
      t.blur();
      render();
    }
  });
}
