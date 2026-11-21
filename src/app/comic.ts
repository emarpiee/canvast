import * as D from "../core/dyadic";
import type { DocumentStore } from "../doc/document-store";
import { isContainer } from "../doc/containers";
import { normalizeUnit, worldBounds } from "../doc/edit-ops";
import { gutterAt, insidePoly, layoutPanels, mergePanels, moveGutter, polySub, splitPanel, subPoly, widenGutters } from "../doc/comic";
import type { Poly, Pt } from "../doc/comic";
import type { CanvasObject, ObjectId, PathObject } from "../doc/model";
import { expressObjectIn, homeObject, newObjectId } from "../doc/model";
import { geometryBounds } from "../doc/path";
import { COMIC_LAYOUTS, comicRows } from "../gen/guides";
import { PAGE_SIZES, pageRatio } from "../gen/pages";
import { plural } from "../doc/plural";
import type { EditorState } from "./editor-state";

/**
 * Comic pages (ADR 0206): a page is a sheet (`container.comic` holds its gutter) whose panels are clipping sheets on it, each a convex
 * outline with its border drawn outside its edge (so the art it clips never covers it). The Panel tool makes a page, cuts a panel in two,
 * moves a gutter and merges two panels; the Actions bar lays a page out again and changes its gutter. Each is one undo step, and what is
 * in a panel goes with the part it lies in.
 */

/** The layouts a new page or Lay out offers: one panel, then the comic guide's. */
export const PAGE_LAYOUTS: ReadonlyArray<[string, string]> = [["one", "One panel"], ...COMIC_LAYOUTS];
const rowsOf = (layout: string): readonly (readonly number[])[] => (layout === "one" ? [[1]] : comicRows(layout));

/** What the Panel tool makes next: sizes in thousandths of the page's shorter side (as the guides' gutters are). */
export interface ComicOptions {
  page: string;
  orient: "portrait" | "landscape";
  layout: string;
  gutter: number;
  margin: number;
  border: number;
}
export const COMIC_DEFAULTS: ComicOptions = { page: "a4", orient: "portrait", layout: "six", gutter: 14, margin: 40, border: 4 };

export const isComicPage = (o: CanvasObject | undefined | null): o is PathObject & { container: { clip: boolean; comic: { gutter: number } } } => isContainer(o) && !!o.container.comic;
/** The page `o` is (or is a panel of), else null. */
export function comicPageOf(doc: DocumentStore, o: CanvasObject | undefined): PathObject | null {
  if (isComicPage(o)) return o;
  const up = o?.parent !== undefined ? doc.get(o.parent) : undefined;
  return isContainer(o) && isComicPage(up) ? up : null;
}
/** The panels of a page, bottom first. */
export const panelsOf = (doc: DocumentStore, page: PathObject): PathObject[] => [...doc.all()].filter((o): o is PathObject => o.parent === page.id && isContainer(o)).sort((a, b) => a.z - b.z);

/** A function from an object's local units to its page's. */
function toPage(doc: DocumentStore, page: PathObject, o: CanvasObject): (x: number, y: number) => Pt {
  const e = expressObjectIn(o, page.frame ?? doc.space.world);
  const k = 2 ** (e.unit - page.unit);
  const ox = D.toNumber(D.shift(D.sub(e.anchor.x, page.anchor.x), -page.unit)), oy = D.toNumber(D.shift(D.sub(e.anchor.y, page.anchor.y), -page.unit));
  return (x, y) => [ox + x * k, oy + y * k];
}
/** A panel's outline in its page's units. */
export const panelPoly = (doc: DocumentStore, page: PathObject, panel: PathObject): Pt[] => {
  const f = toPage(doc, page, panel);
  return subPoly(panel.sub[0]!).map(([x, y]) => f(x, y));
};
/** Where an object's middle is, in its page's units. */
function middleOnPage(doc: DocumentStore, page: PathObject, o: CanvasObject): Pt {
  const e = expressObjectIn(o, page.frame ?? doc.space.world), b = worldBounds(e);
  const at = (v: D.Dyadic, a: D.Dyadic): number => D.toNumber(D.shift(D.sub(v, a), -page.unit));
  return [(at(b.min.x, page.anchor.x) + at(b.max.x, page.anchor.x)) / 2, (at(b.min.y, page.anchor.y) + at(b.max.y, page.anchor.y)) / 2];
}

const pageSize = (page: PathObject): { w: number; h: number; x: number; y: number } => {
  const b = geometryBounds(page.sub);
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
};
/** A length in thousandths of the page's shorter side, in its units. */
const per = (page: PathObject, k: number): number => (Math.min(pageSize(page).w, pageSize(page).h) / 1000) * k;
/** The smallest panel: a hundredth of the page's shorter side across. */
const minOf = (page: PathObject): number => per(page, 10);

/** A panel with this outline on the page, in the page's frame and units: `from` gives it its id, look, name and place in the stack; else a new one. */
function panelObject(doc: DocumentStore, page: PathObject, poly: Poly, from: PathObject | null, z: number, look: { border: number }, name: string): PathObject {
  const place = { ...(page.frame ? { frame: page.frame } : {}), anchor: page.anchor, unit: page.unit, sub: [polySub(poly)] };
  if (from) {
    const { frame: _f, ...rest } = from;
    const k = 2 ** (expressObjectIn(from, page.frame ?? doc.space.world).unit - page.unit); // (its outline's width, in the page's units)
    return { ...rest, ...place, width: from.width * k };
  }
  return {
    id: newObjectId(), kind: "path", ...place, z, opacity: 1, attachmentTargetId: null,
    fill: "#ffffff", stroke: "#000000", width: Math.max(look.border, Number.MIN_VALUE), align: "outside", join: "miter",
    container: { clip: true }, parent: page.id, name,
  };
}

/** The next panel's name on a page ("Panel 7"). */
const nextPanelName = (panels: readonly PathObject[], skip = 0): string => `Panel ${Math.max(0, ...panels.map((p) => Number(/^Panel (\d+)$/.exec(p.name ?? "")?.[1] ?? 0))) + 1 + skip}`;

/** What was in `from` panels goes to whichever of `to` holds its middle (else the first), as one list of changed objects. */
function rehome(doc: DocumentStore, page: PathObject, from: readonly ObjectId[], to: ReadonlyArray<{ id: ObjectId; poly: Poly }>): CanvasObject[] {
  const out: CanvasObject[] = [];
  for (const o of doc.all()) {
    if (o.parent === undefined || !from.includes(o.parent)) continue;
    const m = middleOnPage(doc, page, o);
    const home = to.find((t) => insidePoly(t.poly, m)) ?? to[0];
    if (home && home.id !== o.parent) out.push({ ...o, parent: home.id });
  }
  return out;
}

/**
 * A new comic page: the sheet `sheet` (drawn, in its frame) becomes a page with `opts`' gutter, laid out in panels inside its margin. The
 * objects to commit, the page first.
 */
export function newComicPage(doc: DocumentStore, sheet: PathObject, opts: ComicOptions): PathObject[] {
  const s = pageSize(sheet), short = Math.min(s.w, s.h) / 1000;
  const page: PathObject = { ...sheet, container: { clip: true, comic: { gutter: opts.gutter } }, name: sheet.name?.replace(/^Sheet/, "Page") ?? "Page" };
  const polys = layoutPanels(s.w, s.h, opts.margin * short, opts.gutter * short, rowsOf(opts.layout)).map((p) => p.map(([x, y]): Pt => [x + s.x, y + s.y]));
  return [page, ...polys.map((p, i) => withSpace(panelObject(doc, page, p, null, page.z + (i + 1) / (polys.length + 1), { border: opts.border * short }, `Panel ${i + 1}`), doc.space))];
}

/** (an object put in its frame's best place: kept exact) */
const withSpace = (o: PathObject, space: DocumentStore["space"]): PathObject => homeObject(normalizeUnit(o), space) as PathObject;

/** Cut `panel` along the line a → b (page units): the panel keeps one part (and the stack), a new panel takes the other; null when the line misses. */
export function cutPanel(doc: DocumentStore, page: PathObject, panel: PathObject, a: Pt, b: Pt): CanvasObject[] | null {
  const gutter = isComicPage(page) ? per(page, page.container.comic.gutter) : 0;
  const parts = splitPanel(panelPoly(doc, page, panel), a, b, gutter, minOf(page));
  if (!parts) return null;
  const [one, two] = parts;
  const kept = withSpace(panelObject(doc, page, one, panel, panel.z, { border: panel.width }, panel.name ?? "Panel"), doc.space);
  const made = withSpace({ ...panelObject(doc, page, two, panel, panel.z, { border: panel.width }, ""), id: newObjectId(), z: panel.z + 1e-6, name: nextPanelName(panelsOf(doc, page)) }, doc.space);
  return [kept, made, ...rehome(doc, page, [panel.id], [{ id: kept.id, poly: one }, { id: made.id, poly: two }])];
}

/** The gutter of `page` under the point (page units), with the panels it lies between. */
export function gutterOf(doc: DocumentStore, page: PathObject, at: Pt, reachPage: number): { panels: PathObject[]; polys: Pt[][]; g: NonNullable<ReturnType<typeof gutterAt>> } | null {
  const panels = panelsOf(doc, page), polys = panels.map((p) => panelPoly(doc, page, p));
  const g = gutterAt(polys, at, Math.max(reachPage, isComicPage(page) ? per(page, page.container.comic.gutter) * 1.5 : 0));
  return g ? { panels, polys, g } : null;
}

/** The panels with that gutter moved by `d` page units across it: the changed panels, or null when one would fold. */
export function movedGutter(doc: DocumentStore, page: PathObject, found: NonNullable<ReturnType<typeof gutterOf>>, d: number): PathObject[] | null {
  const next = moveGutter(found.polys, found.g, d, minOf(page));
  if (!next) return null;
  const touched = new Set([...found.g.a, ...found.g.b].map((e) => e.panel));
  return [...touched].map((k) => withSpace(panelObject(doc, page, next[k]!, found.panels[k]!, found.panels[k]!.z, { border: 0 }, ""), doc.space));
}

/** The two panels across the gutter under the point become one (the outline round both), with what was in them. */
export function mergeAt(doc: DocumentStore, page: PathObject, at: Pt, reachPage: number): { next: CanvasObject[]; removed: ObjectId[] } | null {
  const found = gutterOf(doc, page, at, reachPage);
  if (!found || found.g.a.length !== 1 || found.g.b.length !== 1) return null; // (a gutter along several panels: which two is not clear)
  return mergeThese(doc, page, [found.panels[found.g.a[0]!.panel]!, found.panels[found.g.b[0]!.panel]!]);
}

function mergeThese(doc: DocumentStore, page: PathObject, panels: readonly PathObject[]): { next: CanvasObject[]; removed: ObjectId[] } {
  const [keep, ...rest] = [...panels].sort((a, b) => a.z - b.z);
  const poly = panels.map((p) => panelPoly(doc, page, p)).reduce((acc, p) => mergePanels(acc, p));
  const merged = withSpace(panelObject(doc, page, poly, keep!, keep!.z, { border: 0 }, ""), doc.space);
  return { next: [merged, ...rehome(doc, page, rest.map((p) => p.id), [{ id: merged.id, poly }])], removed: rest.map((p) => p.id) };
}

// ---- what the Actions bar and the Panel tool's options do to the selected page

/** The comic page the selection is on (a page, or one or more of its panels), or null. */
export function selectedComicPage(doc: DocumentStore, editor: EditorState): PathObject | null {
  let page: PathObject | null = null;
  for (const id of editor.selection) {
    const p = comicPageOf(doc, doc.get(id));
    if (!p || (page && page.id !== p.id)) return null;
    page = p;
  }
  return page;
}
const selectedPanels = (doc: DocumentStore, editor: EditorState, page: PathObject): PathObject[] => panelsOf(doc, page).filter((p) => editor.selection.has(p.id));

/** Lay the selected page out again in `layout` (its margin kept as the space round its panels now): what was in the panels goes to the new one it lies in. */
export function layOutPage(doc: DocumentStore, editor: EditorState, layout: string, opts: ComicOptions): boolean {
  const page = selectedComicPage(doc, editor);
  if (!page || editor.blockEdit() || !PAGE_LAYOUTS.some(([id]) => id === layout)) return false;
  const old = panelsOf(doc, page), s = pageSize(page), gutter = per(page, isComicPage(page) ? page.container.comic.gutter : opts.gutter);
  const polys = layoutPanels(s.w, s.h, per(page, opts.margin), gutter, rowsOf(layout)).map((p) => p.map(([x, y]): Pt => [x + s.x, y + s.y]));
  const look = old[0] ?? null;
  const made = polys.map((p, i) => withSpace(old[i] ? panelObject(doc, page, p, old[i]!, old[i]!.z, { border: 0 }, "") : { ...panelObject(doc, page, p, look, page.z + 0.5 + i * 1e-3, { border: per(page, opts.border) }, ""), id: newObjectId(), name: `Panel ${i + 1}` }, doc.space));
  const removed = old.slice(polys.length).map((p) => p.id);
  const moved = rehome(doc, page, old.map((p) => p.id), made.map((m, i) => ({ id: m.id, poly: polys[i]! })));
  doc.commit(doc.transaction(`Lay out the page: ${PAGE_LAYOUTS.find(([id]) => id === layout)![1]}`, [...made, ...moved], removed));
  editor.changed();
  return true;
}

/** The selected page's gutters made `k` thousandths of its shorter side: every gutter between panels widens or narrows by half on each side. */
export function setPageGutter(doc: DocumentStore, editor: EditorState, k: number): boolean {
  const page = selectedComicPage(doc, editor);
  if (!isComicPage(page) || editor.blockEdit() || !(k >= 0 && k <= 500)) return false;
  const now = per(page, page.container.comic.gutter), next = per(page, k);
  const panels = panelsOf(doc, page), polys = panels.map((p) => panelPoly(doc, page, p));
  const wide = widenGutters(polys, now, next - now, minOf(page));
  if (!wide) {
    editor.message = "The gutters cannot be that wide: a panel would vanish.";
    editor.changed();
    return false;
  }
  const out: CanvasObject[] = [{ ...page, container: { ...page.container, comic: { gutter: k } } }, ...panels.map((p, i) => withSpace(panelObject(doc, page, wide[i]!, p, p.z, { border: 0 }, ""), doc.space))];
  doc.commit(doc.transaction("Gutter width", out));
  editor.changed();
  return true;
}

/** The selected panels (two or more, of one page) become one. */
export function mergeSelectedPanels(doc: DocumentStore, editor: EditorState): boolean {
  const page = selectedComicPage(doc, editor);
  const picked = page ? selectedPanels(doc, editor, page) : [];
  if (!page || picked.length < 2 || editor.blockEdit()) return false;
  const r = mergeThese(doc, page, picked);
  doc.commit(doc.transaction(`Merge ${plural(picked.length, "panel")}`, r.next, r.removed));
  editor.select([r.next[0]!.id]);
  editor.changed();
  return true;
}

/** Each selected panel cut in two through its middle, across (a line from left to right) or down. */
export function splitSelectedPanels(doc: DocumentStore, editor: EditorState, dir: "across" | "down"): boolean {
  const page = selectedComicPage(doc, editor);
  const picked = page ? selectedPanels(doc, editor, page) : [];
  if (!page || !picked.length || editor.blockEdit()) return false;
  const out: CanvasObject[] = [];
  for (const p of picked) {
    const poly = panelPoly(doc, page, p);
    const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cy = poly.reduce((s, q) => s + q[1], 0) / poly.length;
    const cut = cutPanel(doc, page, p, dir === "across" ? [cx - 1, cy] : [cx, cy - 1], dir === "across" ? [cx + 1, cy] : [cx, cy + 1]);
    if (cut) out.push(...cut);
  }
  if (!out.length) {
    editor.message = "Too small to cut again.";
    editor.changed();
    return false;
  }
  doc.commit(doc.transaction(picked.length === 1 ? "Cut the panel in two" : `Cut ${plural(picked.length, "panel")} in two`, out));
  editor.changed();
  return true;
}

/** Whether the selection is panels of one page (`n` or more). */
export const panelCount = (doc: DocumentStore, editor: EditorState): number => {
  const page = selectedComicPage(doc, editor);
  return page ? selectedPanels(doc, editor, page).length : 0;
};

/** The selected page's panels' borders made `k` thousandths of its shorter side. */
export function setPanelBorder(doc: DocumentStore, editor: EditorState, k: number): boolean {
  const page = selectedComicPage(doc, editor);
  if (!page || editor.blockEdit() || !(k >= 0 && k <= 100)) return false;
  const panels = panelsOf(doc, page);
  const out = panels.map((p): PathObject => {
    const scale = 2 ** (expressObjectIn(p, page.frame ?? doc.space.world).unit - page.unit); // (the page's units in the panel's)
    return k === 0 ? { ...p, stroke: null } : { ...p, stroke: p.stroke ?? "#000000", width: per(page, k) / scale, align: "outside" };
  });
  if (!out.length) return false;
  doc.commit(doc.transaction("Panel borders", out));
  editor.changed();
  return true;
}

/** The Panel tool's option set (and, when a comic page is selected, made on it: its layout, gutter, border, or its size and way up). */
export function setComicOption(doc: DocumentStore, editor: EditorState, name: keyof ComicOptions, value: string | number, setRatio: (r: number) => void): boolean {
  const ok =
    name === "page" ? value === "free" || PAGE_SIZES.some(([id]) => id === value)
    : name === "orient" ? value === "portrait" || value === "landscape"
    : name === "layout" ? PAGE_LAYOUTS.some(([id]) => id === value)
    : typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= (name === "border" ? 100 : name === "gutter" ? 200 : 300);
  if (!ok) return false;
  editor.comic = { ...editor.comic, [name]: value };
  if (selectedComicPage(doc, editor) && !editor.blockEdit()) {
    if (name === "layout") layOutPage(doc, editor, String(value), editor.comic);
    else if (name === "gutter") setPageGutter(doc, editor, Number(value));
    else if (name === "border") setPanelBorder(doc, editor, Number(value));
    else if (name === "page" || name === "orient") {
      const r = pageRatio(editor.comic.page, editor.comic.orient);
      if (r !== null) setRatio(r);
    }
  }
  editor.changed();
  return true;
}
