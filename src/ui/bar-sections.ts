import { isOff } from "./bar";
import { esc } from "./format";
import { ICONS } from "./icons";
import { shortTitle } from "../commands/from-bars";

/**
 * The sections of the Properties bar (ADR 0198): every control of the bar belongs to one, named once here, so the bar can be shown as it is
 * (one row) or as value chips (one chip per section, its controls in a popover laid out as a form), with the same controls each time
 * (ui/properties-layout.ts). A control's section is its own `data-section`, else the nearest one above it.
 */
export interface Section {
  id: string;
  label: string;
  /** Its chip's icon: the icon the same thing has elsewhere (the Text tool's for Text, the Auto layout's for Layout...), never a new one for it. */
  icon: string;
}

/** The sections, in the order they show. Long ones are split, so a popover stays short (Auto layout: Layout, Spacing, Columns and order). */
export const SECTIONS: readonly Section[] = [
  { id: "kind", label: "Kind", icon: ICONS.shapes },
  { id: "mask", label: "Mask", icon: ICONS.maskMenu },
  { id: "look", label: "Look", icon: ICONS.paintBucket },
  { id: "text", label: "Text", icon: ICONS.type },
  { id: "textoutline", label: "Text outline", icon: ICONS.outlineOptions },
  { id: "paragraph", label: "Paragraph", icon: ICONS.textBox },
  { id: "shape", label: "Shape", icon: ICONS.shapeTool },
  // (a speech balloon, a text in a shape, a connector: what was the Speech balloon panel)
  { id: "balloon", label: "Body", icon: ICONS.speechBalloon },
  { id: "tail", label: "Tail", icon: ICONS.balloonTail },
  { id: "shapetext", label: "Text in shape", icon: ICONS.textInShape },
  { id: "connector", label: "Connector", icon: ICONS.balloonConnector },
  { id: "picture", label: "Picture", icon: ICONS.image },
  { id: "size", label: "Size", icon: ICONS.ratio },
  { id: "layout", label: "Layout", icon: ICONS.autoLayout },
  { id: "spacing", label: "Spacing", icon: ICONS.distH },
  { id: "columns", label: "Columns and order", icon: ICONS.flowGrid },
  { id: "inlayout", label: "In layout", icon: ICONS.layoutFree },
  { id: "position", label: "On sheet", icon: ICONS.sheetTool },
  { id: "brush", label: "Brush", icon: ICONS.pencil },
  { id: "eraser", label: "Eraser", icon: ICONS.eraser },
  { id: "lasso", label: "Lasso", icon: ICONS.lasso },
  { id: "options", label: "Options", icon: ICONS.pointer },
];
const ORDER = new Map(SECTIONS.map((s, i) => [s.id, i]));
export const sectionLabel = (id: string): string => SECTIONS.find((s) => s.id === id)?.label ?? id;
export const sectionIcon = (id: string): string => SECTIONS.find((s) => s.id === id)?.icon ?? ICONS.pointer;

/** Give the bar's controls their sections: a selector and its section; what is inside takes it too, unless it has its own. */
export function assignSections(row: HTMLElement, map: ReadonlyArray<readonly [selector: string, section: string]>): void {
  for (const [sel, id] of map) for (const el of row.querySelectorAll<HTMLElement>(sel)) if (!el.dataset["section"]) el.dataset["section"] = id;
}

/**
 * The units of the bar: what each group holds, and for a part that holds controls of other sections (Auto layout: its flow, its spacing,
 * its columns), what that part holds. A unit is shown, hidden or moved to its section as one.
 */
function units(row: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const add = (el: HTMLElement): void => {
    if ([...el.children].some((c) => (c as HTMLElement).dataset["section"] && (c as HTMLElement).dataset["section"] !== el.dataset["section"])) for (const c of el.children) add(c as HTMLElement);
    else out.push(el);
  };
  for (const g of row.querySelectorAll<HTMLElement>(":scope > .tb-group")) for (const c of g.children) add(c as HTMLElement);
  return out;
}
const sectionOf = (el: HTMLElement): string => el.closest<HTMLElement>("[data-section]")?.dataset["section"] ?? "options";
/** The section of a control anywhere in the bar. */
export const sectionOfControl = (row: HTMLElement, el: HTMLElement): string => sectionOf(units(row).find((u) => u.contains(el)) ?? el);

/** Whether a control shows now, judged inside the bar only (wherever the bar itself is placed). */
function shows(el: HTMLElement, row: HTMLElement): boolean {
  for (let e: HTMLElement | null = el; e && e !== row; e = e.parentElement) if (isOff(e)) return false;
  return true;
}

/** The sections that have a control showing, in their order. */
export function shownSections(row: HTMLElement): string[] {
  const ids = new Set<string>();
  for (const u of units(row)) if (shows(u, row)) ids.add(sectionOf(u));
  return [...ids].sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99));
}

/** Show only the controls of these sections (null: all of them). A part left with none shown is left out too. */
export function showSections(row: HTMLElement, ids: ReadonlySet<string> | null): void {
  const all = units(row);
  for (const u of all) {
    const off = ids !== null && !ids.has(sectionOf(u));
    if (u.hasAttribute("data-sec-off") !== off) u.toggleAttribute("data-sec-off", off);
  }
  // (a group, or a part, with every unit in it off is off too: no empty rows, no lines between nothing)
  const holders = [...row.querySelectorAll<HTMLElement>(":scope > .tb-group, :scope > .tb-group *")].filter((h) => !all.includes(h) && all.some((u) => h.contains(u)));
  for (const h of holders) {
    const off = ids !== null && all.filter((u) => h.contains(u)).every((u) => u.hasAttribute("data-sec-off"));
    if (h.hasAttribute("data-sec-off") !== off) h.toggleAttribute("data-sec-off", off);
  }
}

const unitOf = (label: string): string => (/\(px/.test(label) ? " px" : /%|per ?cent/i.test(label) ? "%" : "");
/** A control's name in the form: its own `data-name` when its accessible name is a sentence (or says something else), else that name, short. */
const nameOf = (el: Element): string => (el as HTMLElement).dataset?.["name"] ?? shortTitle(el.getAttribute("aria-label") ?? "");

/**
 * Every control of the bar gets a name of its own, seen only when the bar is laid out as a form (in a chip's popover): a button with only an
 * icon shows its name beside it, a field with no words of its own has one before it, and a row of choices (a radio group) is named by its
 * group. In the bar the names are hidden; the controls are not moved. Words that stand loose in a part ("On sheet", "Span") become its
 * little headings. Done once: the bar's markup does not change afterwards (groups re-filled by code, as the kinds of a mixed pick, are named by their group).
 */
export function nameControls(row: HTMLElement): void {
  const named = (el: Element): boolean => [...el.childNodes].some((n) => (n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) || (n instanceof HTMLElement && (n.matches(".swatch-name, .pf-name, .pf-short") || (n.tagName === "SPAN" && !n.querySelector("svg") && n.textContent!.trim() && !n.matches("[data-paint-chip], [data-colour-chip]")))));
  const nameEl = (text: string): HTMLElement => {
    const s = document.createElement("span");
    s.className = "pf-name";
    s.setAttribute("aria-hidden", "true");
    s.textContent = text;
    return s;
  };
  for (const b of row.querySelectorAll<HTMLButtonElement>("button")) {
    if (b.closest("[role=radiogroup], .seg") || b.matches(".width") || named(b) || !nameOf(b)) continue; // (the pen's widths are pictures of themselves)
    b.append(nameEl(nameOf(b)));
  }
  // In the form a field is named by its full name ("Text size", "Line height", "Padding top"), never by the short word of the bar ("Size",
  // "Line", "T"): the short word stays, for the bar only.
  const words = (l: Element): string => [...l.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent!.trim()).join(" ").trim();
  const labels = [...row.querySelectorAll<HTMLLabelElement>("label")];
  const bare = new Set(labels.filter((l) => !words(l) && !named(l)));
  // A label over several fields ("Pin" and its two choices): its words become a heading, and each field a row with its own name.
  for (const l of labels) {
    const fields = [...l.querySelectorAll<HTMLElement>("input:not([type=file]), select")];
    if (fields.length < 2 || l.querySelector("label")) continue;
    l.classList.add("pf-multi");
    for (const n of [...l.childNodes]) if (n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) {
      const cap = document.createElement("span");
      cap.className = "pf-cap";
      cap.textContent = n.textContent!.trim();
      n.replaceWith(cap);
    }
    for (const f of fields) {
      const r = document.createElement("span");
      r.className = "pf-row";
      f.before(r);
      r.append(nameEl(nameOf(f)), f);
    }
  }
  for (const l of labels) {
    const field = l.querySelector<HTMLElement>("input:not([type=file]), select");
    if (!field || bare.has(l) || l.classList.contains("pf-multi")) continue;
    if (!field.getAttribute("aria-label")) continue; // (no fuller name than the label's own words)
    for (const n of [...l.childNodes]) if (n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) {
      const short = document.createElement("span");
      short.className = "pf-short";
      short.textContent = n.textContent!.trim();
      n.replaceWith(short);
    }
    l.prepend(nameEl(nameOf(field)));
  }
  // (a field outside any label gets one, with its name: in the form a row of its own; in the bar the wrapper changes nothing)
  for (const f of row.querySelectorAll<HTMLElement>("input:not([type=file]), select")) {
    if (f.parentElement?.classList.contains("pf-row")) continue;
    const label = f.closest("label");
    if (label && named(label)) continue;
    if (label) {
      label.prepend(nameEl(nameOf(f)));
      continue;
    }
    const wrap = document.createElement("label");
    wrap.className = "pf-row";
    if (f.dataset["section"]) wrap.dataset["section"] = f.dataset["section"]; // (the row is in the field's section, its name with it)
    f.before(wrap);
    wrap.append(nameEl(nameOf(f)), f);
  }
  for (const g of row.querySelectorAll<HTMLElement>("[role=radiogroup], .seg")) if (!g.dataset["name"] && g.getAttribute("aria-label")) g.dataset["name"] = g.getAttribute("aria-label")!;
  // Choices that sit inside a bigger part (the pen's widths beside its size, the flows of auto layout) get a row of their own, named.
  const wrapChoices = (items: HTMLElement[], name: string): void => {
    if (!items.length || items[0]!.parentElement?.classList.contains("pf-choices")) return;
    const w = document.createElement("span");
    w.className = "pf-choices";
    w.dataset["name"] = name;
    const sec = items[0]!.dataset["section"];
    if (sec) w.dataset["section"] = sec;
    items[0]!.before(w);
    w.append(...items);
  };
  for (const g of row.querySelectorAll<HTMLElement>(".tb-group:has(> button.width)")) wrapChoices([...g.querySelectorAll<HTMLElement>(":scope > button.width")], "Pen width");
  for (const seg of row.querySelectorAll<HTMLElement>(".seg")) wrapChoices([seg], seg.getAttribute("aria-label") ?? "");
  // The kind of row each control makes in the form (CSS orders them: values, choices, switches, more; `arrangeForm` puts a line between kinds).
  const ROW_KINDS: ReadonlyArray<readonly [string, FormRow]> = [
    ["label:not(.pf-multi):has(input:not([type=file]), select), span.pf-row, button.swatch:has([data-paint-chip], [data-colour-chip])", "value"],
    ["[role=radiogroup], .pf-choices", "choice"],
    ["button[aria-pressed]:not([role=radio], .swatch, .width)", "switch"],
    ["button:not([role=radio], .width, [aria-pressed])", "more"], // (a swatch with a colour is a value, taken first; one without, as Outline options, opens more)
  ];
  for (const [sel, kind] of ROW_KINDS) {
    for (const el of row.querySelectorAll<HTMLElement>(sel)) {
      if (el.dataset["row"] || (kind !== "choice" && el.closest("[role=radiogroup], .pf-choices")) || (kind === "choice" && el.parentElement?.closest("[data-row=choice]"))) continue;
      el.dataset["row"] = kind;
    }
  }
  // (loose words in a part: its headings; a lone "%" or the like says nothing on its own)
  for (const part of row.querySelectorAll<HTMLElement>(".tb-count, [data-in-span-wrap]")) {
    for (const n of [...part.childNodes]) {
      const t = n.nodeType === Node.TEXT_NODE ? n.textContent!.trim() : "";
      if (!t || part.tagName === "LABEL") continue;
      const cap = document.createElement("span");
      cap.className = "pf-cap";
      // (a lone "%" says nothing on its own, and a heading that is the name of the section is said by its chip)
      if (!/[a-z]/i.test(t) || t.toLowerCase() === sectionLabel(sectionOf(part)).toLowerCase()) cap.dataset["quiet"] = "";
      cap.textContent = t;
      n.replaceWith(cap);
    }
  }
}

/** The kinds of rows of the form, in their order (ADR 0198). */
export type FormRow = "value" | "choice" | "switch" | "more";
const ROW_ORDER: Record<FormRow, number> = { value: 1, choice: 2, switch: 3, more: 4 };

/** Put a line before the first row of each kind that follows another kind, among the rows that show now (after the sections shown change). */
export function arrangeForm(row: HTMLElement): void {
  const rows = [...row.querySelectorAll<HTMLElement>("[data-row]")].filter((r) => shows(r, row) && !r.closest("[data-sec-off]"));
  rows.sort((a, b) => ROW_ORDER[a.dataset["row"] as FormRow] - ROW_ORDER[b.dataset["row"] as FormRow]); // (stable: the bar's order within a kind)
  rows.forEach((r, i) => {
    const divide = i > 0 && rows[i - 1]!.dataset["row"] !== r.dataset["row"];
    if (r.hasAttribute("data-divide") !== divide) r.toggleAttribute("data-divide", divide);
  });
}

/**
 * A sub-menu of the Properties bar (Outline options, Paragraph and box options, Font options, Columns and rows) laid out as every chip's form
 * (ADR 0201): its rows marked by kind (a row of choices, a field, a switch), a unit written after a field put in the row's name (so every
 * field ends on one edge), then ordered and divided by kind as `arrangeForm` does. `keepOrder`: rows that belong together in the order they
 * were made (a column's kind, then its size) keep it. Rows shown or hidden later are divided again.
 */
export function formRows(pop: HTMLElement, opts: { keepOrder?: boolean } = {}): void {
  pop.classList.add("pop-form");
  pop.classList.toggle("keeps-order", !!opts.keepOrder);
  for (const r of pop.querySelectorAll<HTMLElement>(".op-row")) {
    if (!r.dataset["row"]) r.dataset["row"] = r.querySelector('[role="radiogroup"], .seg') ? "choice" : r.querySelector('input:not([type="checkbox"]), select') ? "value" : "switch";
    const unit = r.querySelector<HTMLElement>(":scope > .op-unit");
    const name = r.querySelector<HTMLElement>(".op-label");
    const u = unit?.textContent?.trim();
    if (unit && name && u) name.textContent = `${name.textContent} (${u})`;
    unit?.remove();
  }
  const arrange = (): void => (opts.keepOrder ? undefined : arrangeForm(pop));
  arrange();
  if (!opts.keepOrder) new MutationObserver(arrange).observe(pop, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

/**
 * What a section is set to now, read from its controls (so every kind and tool is covered without a word of its own): the colours as
 * swatches (a fill a dot, an outline a ring of its colour, the same size), then the first values (a number with its unit, a choice, the
 * option on). HTML, short.
 */
export function sectionSummary(row: HTMLElement, id: string): string {
  const swatches: string[] = [];
  const words: string[] = [];
  for (const u of units(row)) {
    if (sectionOf(u) !== id || !shows(u, row)) continue;
    const els = [u, ...u.querySelectorAll<HTMLElement>("*")].filter((e) => shows(e, row));
    for (const el of els) {
      if (el.classList.contains("swatch") && el.querySelector("[data-paint-chip], [data-colour-chip]")) {
        const chip = el.querySelector<HTMLElement>("[data-paint-chip], [data-colour-chip]")!;
        const bg = chip.style.getPropertyValue("--paint") || chip.style.background;
        const ring = el.dataset["paint"] === "stroke" || el.hasAttribute("data-text-outline") ? " is-ring" : "";
        swatches.push(el.classList.contains("is-none") || !bg ? `<span class="vchip-sw is-none${ring}" title="${esc(nameOf(el))}: none"></span>` : `<span class="vchip-sw${ring}" style="--sw:${esc(bg)}" title="${esc(nameOf(el))}"></span>`);
      } else if (el instanceof HTMLInputElement && (el.type === "number" || el.type === "text") && (el.value || el.placeholder)) {
        words.push(el.value ? `${el.value}${unitOf(el.getAttribute("aria-label") ?? "")}` : el.placeholder);
      } else if (el instanceof HTMLInputElement && el.type === "range") {
        const out = el.nextElementSibling;
        if (out?.classList.contains("size-out") && out.textContent) words.push(out.textContent);
      } else if (el instanceof HTMLSelectElement && el.value) {
        words.push(el.selectedOptions[0]?.textContent?.trim() ?? "");
      } else if (el.getAttribute("role") === "radio" && el.getAttribute("aria-checked") === "true") {
        words.push(nameOf(el) || el.textContent?.trim() || "");
      }
    }
  }
  // (one value, short: the chips are as compact as the Actions bar's buttons; the popover shows the rest)
  const text = words.filter(Boolean).slice(0, 1).map((w) => esc(w.length > 14 ? `${w.slice(0, 13)}…` : w)).join("");
  return swatches.slice(0, 3).join("") + (text ? `<span class="vchip-t">${text}</span>` : "");
}
