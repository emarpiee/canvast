import { panelHtml } from "./panel";
import { ICONS } from "./icons";
import { isOff } from "./bar";
import type { PropertiesBar } from "./toolbar";

/**
 * The Properties panel (ADR 0197): the options of the tool or of what is selected, in a panel of the dock instead of the bar at the top
 * (Settings > Appearance > Properties). It holds the Properties bar itself, the same controls, so whatever the bar does (live numbers,
 * popovers, the command palette, shortcuts) works the same here; only the layout differs. Each control names its section (`data-section`
 * in `ui/toolbar.ts`), and the panel stacks the sections down in a fixed order, Look first, under headings that fold; a field at the top
 * finds a property by its name.
 */
export type PropertiesPlace = "panel" | "bar";

/** The sections, in their order down the panel. */
export const SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "look", label: "Look" },
  { id: "text", label: "Text" },
  { id: "shape", label: "Shape" },
  { id: "picture", label: "Picture" },
  { id: "size", label: "Size" },
  { id: "layout", label: "Layout" },
  { id: "spacing", label: "Spacing" },
  { id: "order", label: "Columns and order" },
  { id: "inlayout", label: "In layout" },
  { id: "position", label: "On sheet" },
  { id: "options", label: "Options" },
];

export interface PropertiesPanelOptions {
  /** The sections folded, as a list of their ids, and keeping a new list. */
  folded(): readonly string[];
  setFolded(ids: readonly string[]): void;
}

export function mountPropertiesPanel(host: HTMLElement, pb: PropertiesBar, opts: PropertiesPanelOptions): { el: HTMLElement; setPlace(p: PropertiesPlace): void; toggle(): void } {
  const panel = document.createElement("aside");
  panel.className = "layers-panel props-panel";
  panel.setAttribute("aria-label", "Properties");
  panel.dataset["testid"] = "properties-panel";
  panel.hidden = true;
  panel.innerHTML = panelHtml({
    title: "Properties",
    sub: `<input type="search" class="props-find" data-props-find placeholder="Find a property…" aria-label="Find a property by its name" spellcheck="false" autocomplete="off">`,
    body: `<div class="props-host" data-props-host></div><p class="adj-note props-empty" data-props-empty hidden>Select something, or pick a tool, to see its options here.</p>`,
  });
  host.append(panel);
  const hostEl = panel.querySelector<HTMLElement>("[data-props-host]")!;
  const find = panel.querySelector<HTMLInputElement>("[data-props-find]")!;
  const empty = panel.querySelector<HTMLElement>("[data-props-empty]")!;
  const { bar, row } = pb;
  const home = { parent: bar.parentElement!, next: bar.nextSibling };
  let place: PropertiesPlace = "bar";

  // A set of controls that holds controls of several sections is laid flat in the panel (its controls take their places in their own
  // sections); a group of one section passes its section to its controls. Done once: the sections are part of the bar's markup.
  for (const el of row.querySelectorAll<HTMLElement>("[data-section]")) {
    if (el.hasAttribute("data-sel-colours") || (!el.querySelector("[data-section]") && !el.classList.contains("tb-group"))) continue;
    for (const c of el.children) if (!(c as HTMLElement).dataset["section"]) (c as HTMLElement).dataset["section"] = el.dataset["section"]!;
    el.removeAttribute("data-section");
    el.setAttribute("data-ps-flat", "");
  }
  // (a field with no name of its own is the second of a pair, as Gap's or Pad's: it stays on its name's line)
  for (const l of row.querySelectorAll<HTMLElement>("label")) {
    if (![...l.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) l.setAttribute("data-ps-bare", "");
  }
  const orderOf = new Map(SECTIONS.map((s, i) => [s.id, 2 * i + 2]));
  // The headings, in the bar's row (hidden while it is a bar): each before its section's controls, by their order.
  for (const s of SECTIONS) {
    const h = document.createElement("button");
    h.type = "button";
    h.className = "ps-head";
    h.dataset["psHead"] = s.id;
    h.dataset["noCommand"] = "";
    h.setAttribute("aria-expanded", "true");
    h.innerHTML = `<span>${s.label}</span>${ICONS.chevronDown}`;
    h.style.order = String(orderOf.get(s.id)! - 1);
    row.append(h);
  }
  const placeOrder = (): void => {
    for (const el of row.querySelectorAll<HTMLElement>("[data-section]")) {
      const o = String(orderOf.get(el.dataset["section"]!) ?? 0);
      if (el.style.order !== o) el.style.order = o;
    }
  };

  const offIn = (el: HTMLElement): boolean => {
    for (let e: HTMLElement | null = el; e && e !== row; e = e.parentElement) if (isOff(e)) return true;
    return false;
  };
  const words = (el: HTMLElement): string => `${el.getAttribute("aria-label") ?? ""} ${el.title ?? ""} ${el.textContent ?? ""} ${[...el.querySelectorAll("[aria-label],[title]")].map((c) => `${c.getAttribute("aria-label") ?? ""} ${(c as HTMLElement).title ?? ""}`).join(" ")}`.toLowerCase();

  /** Lay the panel out after every update of the bar: which sections show, folded or not, and what the find field leaves. */
  const layout = (): void => {
    if (place !== "panel") return;
    placeOrder();
    for (const el of row.querySelectorAll<HTMLElement>("[data-section-off], [data-filter-off]")) {
      el.removeAttribute("data-section-off");
      el.removeAttribute("data-filter-off");
    }
    const query = find.value.trim().toLowerCase();
    const items = [...row.querySelectorAll<HTMLElement>("[data-section]")];
    // (a tool's own options have no section: they are filtered as they are, at the top)
    const loose = [...row.querySelectorAll<HTMLElement>(":scope > .tb-group:not([data-ps-flat]):not([data-section]) > *")];
    const folded = new Set(opts.folded());
    const shown = new Set<string>();
    for (const el of [...items, ...loose]) {
      if (offIn(el)) continue;
      if (query && !words(el).includes(query)) {
        el.setAttribute("data-filter-off", "");
        continue;
      }
      const sec = el.dataset["section"];
      if (sec) shown.add(sec);
    }
    for (const h of row.querySelectorAll<HTMLElement>("[data-ps-head]")) {
      const sec = h.dataset["psHead"]!;
      const open = !!query || !folded.has(sec);
      h.hidden = !shown.has(sec);
      h.setAttribute("aria-expanded", String(open));
      if (!open) for (const el of items) if (el.dataset["section"] === sec) el.setAttribute("data-section-off", "");
    }
    empty.hidden = !bar.hidden;
    if (!bar.hidden && query && !shown.size && loose.every((el) => offIn(el) || el.hasAttribute("data-filter-off"))) {
      empty.textContent = `No property here is called “${find.value.trim()}”.`;
      empty.hidden = false;
    } else empty.textContent = "Select something, or pick a tool, to see its options here.";
  };
  pb.onUpdate(layout);

  row.addEventListener("click", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-ps-head]");
    if (!h) return;
    const sec = h.dataset["psHead"]!;
    const folded = new Set(opts.folded());
    if (folded.has(sec)) folded.delete(sec);
    else folded.add(sec);
    opts.setFolded([...folded]);
    layout();
  });
  find.addEventListener("input", layout);
  find.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !find.value) return;
    e.stopPropagation();
    find.value = "";
    layout();
  });
  panel.querySelector("[data-close]")!.addEventListener("click", () => {
    panel.hidden = true;
    sync();
  });
  // Its button in the dock (top right), as the other panels': there only when the options are in the panel.
  const dockBtn = document.querySelector<HTMLElement>("[data-props-panel]");
  const sync = (): void => {
    if (!dockBtn) return;
    dockBtn.hidden = place !== "panel";
    dockBtn.setAttribute("aria-pressed", String(!panel.hidden));
  };
  dockBtn?.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    sync();
  });

  const setPlace = (p: PropertiesPlace): void => {
    if (p === place) return;
    place = p;
    if (p === "panel") {
      hostEl.append(bar);
      bar.classList.add("is-panel");
      panel.hidden = false;
    } else {
      for (const el of row.querySelectorAll<HTMLElement>("[data-section-off], [data-filter-off]")) {
        el.removeAttribute("data-section-off");
        el.removeAttribute("data-filter-off");
      }
      for (const el of row.querySelectorAll<HTMLElement>("[data-section]")) el.style.order = "";
      find.value = "";
      home.parent.insertBefore(bar, home.next);
      bar.classList.remove("is-panel");
      panel.hidden = true;
    }
    sync();
    pb.refresh();
  };
  return {
    el: panel,
    setPlace,
    toggle: () => {
      if (place !== "panel") return;
      panel.hidden = !panel.hidden;
      sync();
    },
  };
}
