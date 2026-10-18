/**
 * The panel dock (ADR 0123): one system for every panel that floats over the canvas. A panel is any element with a `<header>` as its title
 * bar; `dock.add(el, spec)` wraps it in an item and the dock does the rest, so a new panel is one `add` call:
 *  - Two stacks, one on each side of the view, and a free layer. Drag a title bar to float the panel anywhere; drop it near a side edge to
 *    stack it there. A stack lists its panels in the order they were last used, the last used on top.
 *  - Press a title bar to fold the panel to its bar, or to open it again (an opened panel counts as used). A panel that is shown again
 *    comes back opened, on top of its stack.
 *  - The width can be dragged from the edge, within `MIN_WIDTH` and `MAX_WIDTH`; the height is the panel's own content (the stack scrolls).
 *  - Where each panel is, its width and whether it is folded are remembered (`persist`), and `commands()` gives the same moves by
 *    keyboard (for the command palette).
 * The panels know nothing about the dock: they show and hide themselves with the `hidden` attribute and may redraw their own header.
 */
export type DockSide = "left" | "right" | "float";

export const MIN_WIDTH = 240;
export const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 268;
/** How close to the edge of the view (px) a dragged panel must be to dock there. */
const ZONE_PX = 96;
/** How far (px) a title bar must move before it is a drag and not a press. */
const DRAG_PX = 4;
const SAVE_MS = 250;

export interface DockSpec {
  id: string;
  /** Names the panel in commands. */
  title: string;
  /** Where it is the first time. */
  side: DockSide;
  width?: number;
}

interface PanelState {
  s: DockSide;
  w: number;
  x: number;
  y: number;
  /** Folded to its title bar. */
  c: boolean;
}

interface Item {
  spec: DockSpec;
  el: HTMLElement;
  box: HTMLElement;
}

export interface DockOptions {
  /** The saved layout (the text `persist` was given), or "". */
  initial: string;
  persist(json: string): void;
  /** On a narrow screen both stacks are one (the right one). */
  narrow(): boolean;
  /** Fold the panels of a stack that are not among the latest used (setting `panel.autoFold`): "off", "all" (keep only the active one) or "latest" (keep `keep`). */
  autoFold(): { mode: "off" | "all" | "latest"; keep: number };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const INTERACTIVE = "button, input, select, textarea, a, label, [contenteditable]";

export class PanelDock {
  private readonly items = new Map<string, Item>();
  private state = new Map<string, PanelState>();
  /** Panel ids, the least recently used first. */
  private order: string[] = [];
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly zones: [HTMLElement, HTMLElement];
  private saveTimer = 0;
  /** The one width every stacked panel has; a panel that is let go takes it along and then has its own. */
  private sideW = DEFAULT_WIDTH;

  constructor(left: HTMLElement, right: HTMLElement, private readonly opts: DockOptions) {
    this.left = left;
    this.right = right;
    this.layer = document.createElement("div");
    this.layer.id = "dock-float";
    left.parentElement!.appendChild(this.layer);
    this.zones = [document.createElement("div"), document.createElement("div")];
    this.zones[0].className = "dock-zone is-left";
    this.zones[1].className = "dock-zone is-right";
    for (const z of this.zones) {
      z.hidden = true;
      this.layer.appendChild(z);
    }
    this.load(opts.initial);
    window.addEventListener("resize", () => this.layout());
  }

  private load(json: string): void {
    try {
      const raw = JSON.parse(json || "{}") as { panels?: Record<string, Partial<PanelState>>; order?: unknown; sw?: unknown };
      if (typeof raw.sw === "number") this.sideW = clamp(raw.sw, MIN_WIDTH, MAX_WIDTH);
      for (const [id, p] of Object.entries(raw.panels ?? {})) {
        if (p && (p.s === "left" || p.s === "right" || p.s === "float")) this.state.set(id, { s: p.s, w: clamp(Number(p.w) || 268, MIN_WIDTH, MAX_WIDTH), x: Number(p.x) || 0, y: Number(p.y) || 0, c: p.c === true });
      }
      if (Array.isArray(raw.order)) this.order = (raw.order as unknown[]).filter((x): x is string => typeof x === "string");
    } catch {
      // a layout that cannot be read is no layout
    }
  }

  private save(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.opts.persist(JSON.stringify({ panels: Object.fromEntries(this.state), order: this.order, sw: this.sideW })), SAVE_MS);
  }

  /** Put a panel in the dock. Its `hidden` attribute says whether it is shown. */
  add(el: HTMLElement, spec: DockSpec): void {
    const box = document.createElement("div");
    box.className = "dock-item";
    box.dataset["dock"] = spec.id;
    const grip = document.createElement("div");
    grip.className = "dock-grip";
    grip.setAttribute("aria-hidden", "true");
    el.parentElement?.insertBefore(box, el);
    box.append(el, grip);
    const item: Item = { spec, el, box };
    this.items.set(spec.id, item);
    if (!this.state.has(spec.id)) this.state.set(spec.id, { s: spec.side, w: clamp(spec.width ?? this.sideW, MIN_WIDTH, MAX_WIDTH), x: 80, y: 120, c: false });
    if (!this.order.includes(spec.id)) this.order.push(spec.id);
    box.hidden = el.hidden;
    new MutationObserver(() => {
      if (box.hidden === el.hidden) return;
      box.hidden = el.hidden;
      if (!el.hidden) this.used(spec.id, true); // shown again: opened, last used
    }).observe(el, { attributes: true, attributeFilter: ["hidden"] });
    box.addEventListener("pointerdown", (e) => this.press(item, e));
    // the title bar by keyboard: Tab reaches it, Enter or Space folds or unfolds (a header the panel redrew is made reachable again)
    const reach = (): void => {
      const head = el.querySelector("header");
      if (head && head.getAttribute("tabindex") !== "0") head.setAttribute("tabindex", "0");
    };
    reach();
    new MutationObserver(reach).observe(el, { childList: true, subtree: true });
    box.addEventListener("keydown", (e) => {
      const head = (e.target as HTMLElement).closest("header");
      if (e.target !== head || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      this.fold(spec.id, !this.state.get(spec.id)!.c);
      if (!this.state.get(spec.id)!.c) this.used(spec.id);
    });
    grip.addEventListener("pointerdown", (e) => this.resize(item, e));
    this.layout();
  }

  /** Mark a panel as used: first (top) in its stack, and (with `open`) unfolded. */
  used(id: string, open = false): void {
    this.order = [...this.order.filter((x) => x !== id), id];
    const s = this.state.get(id);
    if (s && open) s.c = false;
    this.settle();
    this.save();
  }

  /** The panels of a stack beyond the latest used are folded, as the setting says; then everything is put in place. */
  private settle(): void {
    const { mode, keep } = this.opts.autoFold();
    if (mode !== "off") {
      const n = mode === "all" ? 1 : Math.max(1, keep);
      for (const side of ["left", "right"] as const) {
        const stacked = [...this.items.values()]
          .filter((it) => !it.el.hidden && this.effective(this.state.get(it.spec.id)!) === side)
          .sort((a, b) => this.order.indexOf(b.spec.id) - this.order.indexOf(a.spec.id));
        stacked.forEach((it, i) => {
          if (i >= n) this.state.get(it.spec.id)!.c = true;
        });
      }
    }
    this.layout();
  }

  /** The auto-fold setting changed: apply it now. */
  apply(): void {
    this.settle();
    this.save();
  }

  where(id: string): DockSide | undefined {
    return this.state.get(id)?.s;
  }

  move(id: string, side: DockSide): void {
    const s = this.state.get(id);
    if (!s) return;
    s.s = side;
    s.c = false;
    if (side === "float") {
      s.w = this.sideW;
      const r = this.items.get(id)?.box.getBoundingClientRect();
      if (r && r.width) {
        s.x = r.left - 24;
        s.y = r.top + 24;
      }
    }
    this.used(id);
  }

  fold(id: string, folded: boolean): void {
    const s = this.state.get(id);
    if (!s) return;
    s.c = folded;
    this.layout();
    this.save();
  }

  /** Put every panel back where it started and unfold it. */
  reset(): void {
    this.sideW = DEFAULT_WIDTH;
    for (const [id, it] of this.items) this.state.set(id, { s: it.spec.side, w: DEFAULT_WIDTH, x: 80, y: 120, c: false });
    this.layout();
    this.save();
  }

  /** The same moves as the mouse gives, as commands for the command palette. */
  commands(): Array<{ group: string; title: string; words: string; enabled?: () => boolean; run: () => void }> {
    const out: Array<{ group: string; title: string; words: string; enabled?: () => boolean; run: () => void }> = [];
    for (const [id, it] of this.items) {
      const shown = (): boolean => !it.el.hidden;
      for (const side of ["left", "right", "float"] as const)
        out.push({ group: "Panel", title: `${it.spec.title}: ${side === "float" ? "float" : `dock on the ${side}`}`, words: "move place stack side", enabled: () => shown() && this.where(id) !== side, run: () => this.move(id, side) });
      out.push({ group: "Panel", title: `${it.spec.title}: fold or unfold`, words: "collapse expand title bar", enabled: shown, run: () => this.fold(id, !this.state.get(id)!.c) });
    }
    out.push({ group: "Panel", title: "Reset the panel layout", words: "panels dock stack float default", run: () => this.reset() });
    return out;
  }

  // ---- Layout ---------------------------------------------------------------------------------------------------------------------

  private effective(s: PanelState): DockSide {
    return s.s !== "float" && this.opts.narrow() ? "right" : s.s;
  }

  /**
   * Put every item where its state says. Nothing is moved in the page unless the order or the parent changed, so dragging and resizing only
   * change styles (moving a node would restart its animations and make it flicker).
   */
  private layout(): void {
    const index = (id: string): number => this.order.indexOf(id);
    const sorted = [...this.items.values()].sort((a, b) => index(a.spec.id) - index(b.spec.id));
    const want = new Map<HTMLElement, HTMLElement[]>([[this.left, []], [this.right, []], [this.layer, []]]);
    for (const it of sorted) {
      const s = this.state.get(it.spec.id)!;
      const side = this.effective(s);
      want.get(side === "left" ? this.left : side === "right" ? this.right : this.layer)!.push(it.box);
      it.box.dataset["side"] = side;
      it.box.toggleAttribute("data-folded", s.c);
      const w = side === "float" ? s.w : this.sideW;
      it.box.style.width = `${w}px`;
      if (side === "float") {
        it.box.style.left = `${clamp(s.x, 96 - w, window.innerWidth - 96)}px`;
        it.box.style.top = `${clamp(s.y, 0, window.innerHeight - 40)}px`;
        it.box.style.zIndex = String(index(it.spec.id) + 1);
      } else {
        it.box.style.left = "";
        it.box.style.top = "";
        it.box.style.zIndex = "";
      }
    }
    // a stack lists the last used first (on top); the free layer is stacked by z-index
    want.get(this.left)!.reverse();
    want.get(this.right)!.reverse();
    for (const [parent, boxes] of want) {
      const have = [...parent.children].filter((c) => c.classList.contains("dock-item"));
      if (have.length === boxes.length && have.every((c, i) => c === boxes[i])) continue;
      for (const box of boxes) parent.appendChild(box); // 
    }
  }

  // ---- Pressing a title bar: a press folds or unfolds, a drag moves ---------------------------------------------------------------

  private press(item: Item, e: PointerEvent): void {
    const id = item.spec.id;
    const s = this.state.get(id)!;
    const target = e.target as HTMLElement;
    if (s.s === "float" && e.button === 0) {
      // anywhere on a floating panel raises it
      this.order = [...this.order.filter((x) => x !== id), id];
      item.box.style.zIndex = String(this.order.length);
    }
    const head = target.closest("header");
    if (!head || !item.el.contains(head) || e.button !== 0 || target.closest(INTERACTIVE)) return;
    const start = { x: e.clientX, y: e.clientY };
    const rect = item.box.getBoundingClientRect();
    const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    let dragging = false;
    const move = (m: PointerEvent): void => {
      if (!dragging && Math.hypot(m.clientX - start.x, m.clientY - start.y) < DRAG_PX) return;
      if (!dragging) {
        dragging = true;
        item.box.classList.add("is-dragging");
        if (s.s !== "float") s.w = this.sideW; // lifted out of its stack: it keeps the width it had
        s.s = "float";
      }
      s.x = m.clientX - grab.x;
      s.y = m.clientY - grab.y;
      this.layout();
      const near = m.clientX < ZONE_PX ? 0 : m.clientX > window.innerWidth - ZONE_PX ? 1 : -1;
      this.zones.forEach((z, i) => (z.hidden = i !== near));
    };
    const up = (u: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      item.box.classList.remove("is-dragging");
      for (const z of this.zones) z.hidden = true;
      if (!dragging) {
        // a press: fold or unfold; unfolded counts as used
        s.c = !s.c;
        if (!s.c) this.order = [...this.order.filter((x) => x !== id), id];
        this.settle();
        this.save();
        return;
      }
      if (u.clientX < ZONE_PX) s.s = "left";
      else if (u.clientX > window.innerWidth - ZONE_PX) s.s = "right";
      this.order = [...this.order.filter((x) => x !== id), id];
      this.settle();
      this.save();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // ---- Width ----------------------------------------------------------------------------------------------------------------------

  private resize(item: Item, e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const s = this.state.get(item.spec.id)!;
    const side = this.effective(s);
    const startX = e.clientX, startW = side === "float" ? s.w : this.sideW;
    const grows = side === "right" ? -1 : 1; // the grip is on the edge towards the canvas
    item.box.classList.add("is-resizing");
    const move = (m: PointerEvent): void => {
      const w = clamp(startW + grows * (m.clientX - startX), MIN_WIDTH, MAX_WIDTH);
      if (side === "float") s.w = w;
      else this.sideW = w; // stacked panels share one width
      this.layout();
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      item.box.classList.remove("is-resizing");
      this.save();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}
