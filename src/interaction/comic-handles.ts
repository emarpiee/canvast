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
  | { what: "corner"; panel: string; index: number; x: number; y: number };

export const COMIC_HANDLE_REACH_PX = 9;

export interface ComicHandles {
  page: PathObject;
  po: ProjectedObject;
  panels: PathObject[];
  polys: Pt[][];
  gutters: Gutter[];
  handles: ComicHandle[];
}

/** A point of the page (its units) on screen. */
export const pageToScreen = (po: ProjectedObject, x: number, y: number): [number, number] => outerAt(po, exactX(po.proj, x), exactY(po.proj, y));

export function comicHandles(doc: DocumentStore, editor: EditorState, visible: readonly ProjectedObject[]): ComicHandles | null {
  if (editor.tool !== "select" && editor.tool !== "panel") return null;
  const page = selectedComicPage(doc, editor);
  const po = page && visible.find((p) => p.obj.id === page.id);
  if (!page || !po || po.cover || !isComicPage(page) || page.locked) return null;
  const panels = panelsOf(doc, page).filter((p) => !p.hidden);
  const polys = panels.map((p) => panelPoly(doc, page, p));
  const gutters = guttersOf(polys, Math.max(pagePer(page, page.container.comic.gutter) * 2.5, pagePer(page, 4)));
  const handles: ComicHandle[] = [];
  gutters.forEach((g, i) => {
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
  return { page, po, panels, polys, gutters, handles: handles.filter((h) => Math.abs(h.x) < 1e6 && Math.abs(h.y) < 1e6) };
}

/** The handle under a point: corners and ends before middles (they lie on the same lines). */
export function comicHandleAt(handles: readonly ComicHandle[], x: number, y: number): ComicHandle | undefined {
  const near = handles.filter((h) => Math.hypot(h.x - x, h.y - y) <= COMIC_HANDLE_REACH_PX);
  const rank = (h: ComicHandle): number => (h.what === "move" ? 1 : 0);
  return near.sort((p, q) => rank(p) - rank(q) || Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0];
}
