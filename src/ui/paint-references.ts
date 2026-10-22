/**
 * Reference pictures of the Painting view: pictures of the library floating over the view, to paint from, never part of the page. Each is
 * moved by dragging it, sized by its corner, and its ⋯ menu sets how see-through it is or takes it away. They are kept per painting on this
 * device (setting paint.refs), where they were on the screen.
 */
import type { AssetLibrary } from "../assets/asset-library";
import type { SettingsStore } from "../settings/settings";
import { ICONS } from "./icons";
import { moreButton, openMoreMenu } from "./more-menu";

export interface Reference {
  readonly id: string;
  readonly hash: string;
  /** Its top-left corner in the stage and its width, in CSS px. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly opacity: number;
}

const MIN_W = 48;
const OPACITIES = [1, 0.75, 0.5, 0.25] as const;

export interface References {
  /** Show the references of a painting (null: none open). */
  show(paintingId: string | null): void;
  /** A new reference of this library picture, in the middle of the view. */
  add(hash: string): void;
}

export function mountReferences(host: HTMLElement, deps: { assets: AssetLibrary; settings: SettingsStore }): References {
  const layer = document.createElement("div");
  layer.className = "paint-refs";
  host.appendChild(layer);
  let painting: string | null = null;
  const all = (): Record<string, Reference[]> => deps.settings.get("paint.refs") as Record<string, Reference[]>;
  const list = (): Reference[] => (painting ? (all()[painting] ?? []) : []);
  const store = (refs: Reference[]): void => {
    if (!painting) return;
    const next = { ...all() };
    if (refs.length) next[painting] = refs;
    else delete next[painting];
    deps.settings.set("paint.refs", next);
  };
  const patch = (id: string, p: Partial<Reference>): void => store(list().map((r) => (r.id === id ? { ...r, ...p } : r)));

  /** Draw a reference's picture at its size (again soon while the library is still decoding it). */
  const draw = (c: HTMLCanvasElement, r: Reference, tries = 40): void => {
    const dpr = window.devicePixelRatio || 1;
    const src = deps.assets.get(r.hash, r.w * dpr);
    if (!src) {
      if (tries > 0) window.setTimeout(() => c.isConnected && draw(c, r, tries - 1), 150);
      return;
    }
    const h = Math.round((r.w * src.pixelH) / Math.max(1, src.pixelW));
    c.width = Math.round(r.w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${r.w}px`;
    c.style.height = `${h}px`;
    c.getContext("2d")!.drawImage(src.source, 0, 0, c.width, c.height);
  };

  const render = (): void => {
    layer.replaceChildren();
    for (const r of list()) {
      const el = document.createElement("div");
      el.className = "paint-ref";
      el.dataset["ref"] = r.id;
      el.dataset["testid"] = "paint-ref";
      Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, opacity: String(r.opacity) });
      const c = document.createElement("canvas");
      c.setAttribute("aria-label", "Reference picture: drag to move it, drag its corner to size it");
      el.innerHTML = `${moreButton("More actions for the reference picture", 'data-ref-more')}<span class="paint-ref-grip" data-ref-grip aria-hidden="true"></span>`;
      el.prepend(c);
      layer.appendChild(el);
      draw(c, r);
    }
  };

  // Drag a reference to move it, its corner to size it (the picture keeps its proportions).
  let drag: { id: string; grip: boolean; x0: number; y0: number; r: Reference; el: HTMLElement } | null = null;
  layer.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    const el = t.closest<HTMLElement>("[data-ref]");
    const r = el && list().find((x) => x.id === el.dataset["ref"]);
    if (!el || !r) return;
    e.stopPropagation();
    if (t.closest("[data-ref-more]")) {
      return openMoreMenu(t.closest<HTMLElement>("[data-ref-more]")!, [
        ...OPACITIES.map((o) => ({ id: `opacity-${o * 100}`, label: `${o * 100} % visible`, checked: r.opacity === o, run: () => (patch(r.id, { opacity: o }), render()) })),
        { id: "remove", label: "Remove the reference", icon: ICONS.x, run: () => (store(list().filter((x) => x.id !== r.id)), render()) },
      ], "Reference picture");
    }
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag = { id: r.id, grip: !!t.closest("[data-ref-grip]"), x0: e.clientX, y0: e.clientY, r, el };
  });
  layer.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (drag.grip) {
      const c = drag.el.querySelector("canvas")!;
      draw(c, { ...drag.r, w: Math.max(MIN_W, drag.r.w + dx) });
    } else Object.assign(drag.el.style, { left: `${drag.r.x + dx}px`, top: `${drag.r.y + dy}px` });
  });
  const end = (e: PointerEvent): void => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    patch(drag.id, drag.grip ? { w: Math.max(MIN_W, drag.r.w + dx) } : { x: drag.r.x + dx, y: drag.r.y + dy });
    drag = null;
  };
  layer.addEventListener("pointerup", end);
  layer.addEventListener("pointercancel", end);

  return {
    show(id) {
      painting = id;
      render();
    },
    add(hash) {
      if (!painting) return;
      const w = Math.round(Math.min(320, host.clientWidth / 3));
      const r: Reference = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, hash, x: Math.round(host.clientWidth / 2 - w / 2), y: Math.round(host.clientHeight / 4), w, opacity: 1 };
      store([...list(), r]);
      render();
    },
  };
}
