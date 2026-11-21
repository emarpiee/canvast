import type { DocumentStore } from "../doc/document-store";
import type { EditorState } from "../app/editor-state";
import type { PathObject } from "../doc/model";
import type { ProjectedObject } from "../render/projection";
import { exactX, exactY } from "../render/projection";
import type { Gutter, Pt } from "../doc/comic";
import { guttersOf } from "../doc/comic";
import { isComicPage, panelPoly, panelsOf, selectedComicPage, pagePer } from "../app/comic";
import { outerAt } from "./path-edit";

/**
 * The handles of a comic page (ADR 0206), as a balloon has its own: on each gutter one in its middle (drag: move it; double-click: merge
 * the two panels) and one at each end (drag: turn the gutter about its other end, to any angle); on the one selected panel one at each
 * corner. Shown while the page or its panels are selected, with the Select tool and the Panel tool.
 */
export type ComicHandle =
  | { what: "move"; gutter: number; x: number; y: number; a: number }
  | { what: "end"; gutter: number; end: 0 | 1; x: number; y: number; a: number }
  | { what: "corner"; panel: string; index: number; x: number; y: number }
  /** The chosen gutter's width: a grip on each side (side -1: side a's, 1: side b's), pointing away from it. */
  | { what: "width"; gutter: number; side: -1 | 1; x: number; y: number; a: number };

export const COMIC_HANDLE_REACH_PX = 9;

export interface ComicHandles {
  page: PathObject;
  po: ProjectedObject;
  panels: PathObject[];
  polys: Pt[][];
  gutters: Gutter[];
  /** The chosen gutter's index, or -1. */
  chosen: number;
  handles: ComicHandle[];
}

/** A point of the page (its units) on screen. */
export const pageToScreen = (po: ProjectedObject, x: number, y: number): [number, number] => outerAt(po, exactX(po.proj, x), exactY(po.proj, y));

export function comicHandles(doc: DocumentStore, editor: EditorState, visible: readonly ProjectedObject[]): ComicHandles | null {
  let chosen = -1;
  if (editor.tool !== "select" && editor.tool !== "panel") return null;
  const page = selectedComicPage(doc, editor);
  const po = page && visible.find((p) => p.obj.id === page.id);
  if (!page || !po || po.cover || !isComicPage(page) || page.locked) return null;
  const panels = panelsOf(doc, page).filter((p) => !p.hidden);
  const polys = panels.map((p) => panelPoly(doc, page, p));
  const gutters = guttersOf(polys, Math.max(pagePer(page, page.container.comic.gutter) * 2.5, pagePer(page, 4)));
  const handles: ComicHandle[] = [];
  // the gutter chosen (a click on its middle handle): its two sides' panels, as `editor.comicGutter` keeps them
  const ids = (es: readonly { panel: number }[]): string => [...new Set(es.map((e) => panels[e.panel]!.id))].sort().join(",");
  const keyOf = (c: { page: string; a: string[]; b: string[] } | null): string | null => (c && c.page === page.id ? [c.a.slice().sort().join(","), c.b.slice().sort().join(",")].sort().join("|") : null);
  const want = keyOf(editor.comicGutter), hover = keyOf(editor.comicHover);
  gutters.forEach((g, i) => {
    const key = [ids(g.a), ids(g.b)].sort().join("|");
    if (key === want) chosen = i;
    // (its width grips: the chosen gutter's, and the one under the pointer)
    if (key === want || key === hover) {
      // its grips, beside its middle, as far out as its edges and a little more
      const mid: Pt = [(g.ends[0][0] + g.ends[1][0]) / 2, (g.ends[0][1] + g.ends[1][1]) / 2];
      const [mx, my] = pageToScreen(po, mid[0], mid[1]);
      const [ox, oy] = pageToScreen(po, mid[0] + g.nx, mid[1] + g.ny);
      const len = Math.hypot(ox - mx, oy - my) || 1, ux = (ox - mx) / len, uy = (oy - my) / len, half = (g.width * po.proj.ppu) / 2 + 12;
      for (const side of [-1, 1] as const) handles.push({ what: "width", gutter: i, side, x: mx + ux * half * side, y: my + uy * half * side, a: Math.atan2(uy * side, ux * side) });
    }
    const [a, b] = g.ends.map(([x, y]) => pageToScreen(po, x, y)) as [[number, number], [number, number]];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    // (a gutter too short on screen to hold three handles keeps its middle one)
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 4 * COMIC_HANDLE_REACH_PX) {
      handles.push({ what: "end", gutter: i, end: 0, x: a[0], y: a[1], a: ang }, { what: "end", gutter: i, end: 1, x: b[0], y: b[1], a: ang });
    }
    handles.push({ what: "move", gutter: i, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, a: ang });
  });
  // the one selected panel: its corners
  const one = panels.filter((p) => editor.selection.has(p.id));
  if (one.length === 1) {
    const k = panels.indexOf(one[0]!);
    polys[k]!.forEach(([x, y], index) => {
      const [sx, sy] = pageToScreen(po, x, y);
      handles.push({ what: "corner", panel: one[0]!.id, index, x: sx, y: sy });
    });
  }
  return { page, po, panels, polys, gutters, chosen, handles: handles.filter((h) => Math.abs(h.x) < 1e6 && Math.abs(h.y) < 1e6) };
}

/** The handle under a point: corners and ends before middles (they lie on the same lines). */
export function comicHandleAt(handles: readonly ComicHandle[], x: number, y: number): ComicHandle | undefined {
  const near = handles.filter((h) => Math.hypot(h.x - x, h.y - y) <= COMIC_HANDLE_REACH_PX);
  const rank = (h: ComicHandle): number => (h.what === "move" ? 1 : 0); // (a width grip, an end and a corner before a middle)
  return near.sort((p, q) => rank(p) - rank(q) || Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0];
}

/** The gutter whose middle line passes within `reach` px of a point (as far as its width grips), as `editor.comicGutter` names one; else null. */
export function gutterUnder(ch: ComicHandles, x: number, y: number): { page: string; a: string[]; b: string[] } | null {
  let best: { d: number; i: number } | null = null;
  ch.gutters.forEach((g, i) => {
    const [a, b] = g.ends.map(([px, py]) => pageToScreen(ch.po, px, py)) as [[number, number], [number, number]];
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
    const d = Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)), reach = (g.width * ch.po.proj.ppu) / 2 + 22;
    if (d <= reach && (!best || d < best.d)) best = { d, i };
  });
  if (!best) return null;
  const g = ch.gutters[(best as { i: number }).i]!, ids = (es: readonly { panel: number }[]): string[] => [...new Set(es.map((e) => ch.panels[e.panel]!.id))];
  return { page: ch.page.id, a: ids(g.a), b: ids(g.b) };
}
