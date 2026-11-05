import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { PDF_CARD_EDGE, openPdf, pageFit, pageSize, pdfTextLayer } from "../assets/pdf-engine";
import type { FileFacts, OpenView, ViewDeps, ViewPlace } from "./file-views";
import { ICONS } from "./icons";
import { openMoreMenu } from "./more-menu";
import { keepViewState, toggledMark, viewStateOf } from "./view-state";
import type { ViewState } from "./view-state";

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;
/** The most pixels one page's picture takes: past it the page is a little soft at the highest zooms, rather than the memory gone. */
const MAX_PAGE_PIXELS = 16e6;
const KEEP_MS = 600;

/** A page's place on show. */
interface Slot {
  n: number;
  el: HTMLElement;
  canvas: HTMLCanvasElement | null;
  task: RenderTask | null;
  /** Bumped when what it should draw changes. */
  turn: number;
}

/** A PDF in its view: its pages one under another, drawn when they come near and let go when they leave, their words selectable. */
export async function openPdfView(el: HTMLElement, file: FileFacts, deps: ViewDeps, place: ViewPlace): Promise<OpenView> {
  const doc: PDFDocumentProxy = await openPdf(new Uint8Array(await file.blob.arrayBuffer()));
  const first = pageSize(await doc.getPage(1));
  const count = doc.numPages;
  el.innerHTML = `<div class="pdf-view" data-testid="pdf-view">
    <div class="view-bar">
      <button type="button" class="layer-btn" data-pdf="prev" aria-label="Previous page" title="Previous page (Page Up)">${ICONS.chevronUp}</button>
      <button type="button" class="layer-btn" data-pdf="next" aria-label="Next page" title="Next page (Page Down)">${ICONS.chevronDown}</button>
      <input class="pdf-at" type="number" min="1" max="${count}" step="1" aria-label="Page" data-testid="pdf-page" /><span class="pdf-count">/ ${count}</span>
      <span class="view-gap"></span>
      <button type="button" class="layer-btn" data-pdf="out" aria-label="Zoom out" title="Zoom out (Ctrl+-)">${ICONS.minus}</button>
      <button type="button" class="layer-btn" data-pdf="fit" data-testid="pdf-fit" aria-label="Fit the width" title="Fit the width (Ctrl+0)">${ICONS.maximize}</button>
      <button type="button" class="layer-btn" data-pdf="in" aria-label="Zoom in" title="Zoom in (Ctrl++)">${ICONS.plus}</button>
      <span class="view-gap"></span>
      <button type="button" class="layer-btn" data-pdf="mark" data-testid="pdf-mark" aria-label="Bookmark this page" aria-pressed="false" title="Bookmark this page, or take its bookmark off">${ICONS.bookmark}</button>
      <button type="button" class="layer-btn" data-pdf="marks" data-testid="pdf-marks" aria-haspopup="menu" aria-label="Go to" title="Bookmarks, and the contents of this PDF">${ICONS.list}</button>
      ${place.setPreview ? `<button type="button" class="layer-btn" data-pdf="card" data-testid="pdf-card" aria-label="Show this page on the card" title="Show this page on the card on the canvas (this copy only)">${ICONS.image}</button>` : ""}
    </div>
    <div class="pdf-pages" tabindex="0" data-testid="pdf-pages"></div>
  </div>`;
  const root = el.querySelector<HTMLElement>(".pdf-view")!;
  const pages = root.querySelector<HTMLElement>(".pdf-pages")!;
  const input = root.querySelector<HTMLInputElement>(".pdf-at")!;
  const markBtn = root.querySelector<HTMLElement>('[data-pdf="mark"]')!;
  let zoom: number | "fit" = "fit";
  const hash = file.hash;
  let state: ViewState = viewStateOf(await deps.session.catalog?.entry(hash).catch(() => undefined));
  let current = Math.max(1, Math.min(count, Number(state.at) || 1));
  let closed = false;

  const slots: Slot[] = [];
  for (let n = 1; n <= count; n++) {
    const s = document.createElement("div");
    s.className = "pdf-page";
    s.dataset["page"] = String(n);
    pages.append(s);
    slots.push({ n, el: s, canvas: null, task: null, turn: 0 });
  }
  /** The scale of a page of this size now. */
  const scaleOf = (w: number): number => (zoom === "fit" ? Math.max(0.05, (pages.clientWidth - 2 * gutter()) / w) : zoom);
  const gutter = (): number => parseFloat(getComputedStyle(pages).paddingLeft) || 0;
  const sizes = new Map<number, { w: number; h: number }>([[1, first]]);
  // (a page not read yet takes the first page's size: a PDF of mixed sizes moves a little as its pages are read)
  const sized = (s: Slot): void => {
    const z = sizes.get(s.n) ?? first;
    const k = scaleOf(z.w);
    s.el.style.width = `${z.w * k}px`;
    s.el.style.height = `${z.h * k}px`;
  };
  const release = (s: Slot): void => {
    s.turn++;
    s.task?.cancel();
    s.task = null;
    if (s.canvas) (s.canvas.width = s.canvas.height = 0);
    s.canvas = null;
    s.el.replaceChildren();
    delete s.el.dataset["drawn"];
  };
  const draw = async (s: Slot): Promise<void> => {
    const turn = ++s.turn;
    let page: PDFPageProxy;
    try {
      page = await doc.getPage(s.n);
    } catch {
      return;
    }
    if (closed || turn !== s.turn) return;
    const z = pageSize(page);
    sizes.set(s.n, z);
    sized(s);
    const k = scaleOf(z.w);
    const dpr = Math.min(devicePixelRatio || 1, Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, z.w * k * z.h * k)));
    const viewport = page.getViewport({ scale: k * dpr });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = page.render({ canvas, viewport, background: "white" });
    s.task = task;
    try {
      await task.promise;
    } catch {
      return; // (cancelled: it left, or the zoom changed)
    }
    if (closed || turn !== s.turn) return;
    s.task = null;
    const layer = document.createElement("div");
    layer.className = "textLayer";
    s.el.style.setProperty("--total-scale-factor", String(k));
    s.el.style.setProperty("--scale-round-x", "1px");
    s.el.style.setProperty("--scale-round-y", "1px");
    s.el.replaceChildren(canvas, layer);
    s.canvas?.remove();
    s.canvas = canvas;
    s.el.dataset["drawn"] = "1";
    const TextLayer = await pdfTextLayer();
    if (closed || turn !== s.turn) return;
    void new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: page.getViewport({ scale: k }) }).render().catch(() => undefined);
  };
  const near = new Set<Slot>();
  const watcher = new IntersectionObserver(
    (seen) => {
      for (const e of seen) {
        const s = slots[Number((e.target as HTMLElement).dataset["page"]) - 1]!;
        if (e.isIntersecting) {
          near.add(s);
          if (!s.el.dataset["drawn"] && !s.task) void draw(s);
        } else {
          near.delete(s);
          release(s);
        }
      }
    },
    { root: pages, rootMargin: "100% 0px" },
  );
  /** All sized again, and what is near drawn again at the new size, the same page staying in view. */
  const layout = (): void => {
    const keep = current;
    for (const s of slots) sized(s);
    for (const s of near) void draw(s);
    show(keep);
  };
  const show = (n: number): void => {
    const s = slots[Math.max(1, Math.min(count, n)) - 1]!;
    pages.scrollTop = s.el.offsetTop - pages.offsetTop;
    setCurrent(s.n);
  };
  let keepTimer: ReturnType<typeof setTimeout> | undefined;
  const keep = (): void => void keepViewState(deps.session, hash, state);
  const paintBar = (): void => {
    if (document.activeElement !== input) input.value = String(current);
    markBtn.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === String(current))));
  };
  const setCurrent = (n: number): void => {
    current = n;
    paintBar();
    state = { ...state, at: String(n) };
    clearTimeout(keepTimer);
    keepTimer = setTimeout(keep, KEEP_MS);
  };
  let scrolling = 0;
  pages.addEventListener("scroll", () => {
    if (scrolling) return;
    scrolling = requestAnimationFrame(() => {
      scrolling = 0;
      // The page across the middle of the view: by its place, in order.
      const mid = pages.scrollTop + pages.clientHeight / 2 + pages.offsetTop;
      let lo = 0, hi = count - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        const s = slots[m]!.el;
        if (s.offsetTop + s.offsetHeight < mid) lo = m + 1;
        else hi = m;
      }
      if (lo + 1 !== current) setCurrent(lo + 1);
    });
  });
  const setZoom = (dir: 1 | -1 | 0): void => {
    if (dir === 0) zoom = "fit";
    else zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scaleOf(first.w) * ZOOM_STEP ** dir));
    layout();
  };
  const mark = (): ViewState["marks"][number] => ({ at: String(current), label: `Page ${current}` });
  const toggleMark = async (): Promise<void> => {
    state = toggledMark(state, mark(), Number);
    paintBar();
    keep();
    await place.refresh();
  };
  const outline = async (): Promise<Array<{ label: string; page: number }>> => {
    const out: Array<{ label: string; page: number }> = [];
    const walk = async (items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>> | undefined, depth: number): Promise<void> => {
      for (const it of items ?? []) {
        if (out.length >= 200) return;
        const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest).catch(() => null) : it.dest;
        const ref = dest?.[0] as number | Parameters<PDFDocumentProxy["getPageIndex"]>[0] | undefined;
        const at = typeof ref === "number" ? ref : ref ? await doc.getPageIndex(ref).catch(() => null) : null;
        if (at !== null) out.push({ label: `${"  ".repeat(depth)}${it.title}`, page: at + 1 });
        await walk(it.items, depth + 1);
      }
    };
    await walk(await doc.getOutline().catch(() => null) ?? undefined, 0);
    return out;
  };
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pdf]");
    switch (b?.dataset["pdf"]) {
      case "prev": return show(current - 1);
      case "next": return show(current + 1);
      case "out": return setZoom(-1);
      case "in": return setZoom(1);
      case "fit": return setZoom(0);
      case "mark": return void toggleMark();
      case "card": {
        const z = sizes.get(current) ?? first;
        return place.setPreview?.(String(current), pageFit(z, PDF_CARD_EDGE));
      }
      case "marks":
        return void outline().then((contents) => {
          const items = [...state.marks.map((m) => ({ label: m.label, hint: "Bookmark", icon: ICONS.bookmark, run: () => show(Number(m.at)) })), ...contents.map((c) => ({ label: c.label, hint: `Page ${c.page}`, icon: ICONS.list, run: () => show(c.page) }))];
          openMoreMenu(b, items.length ? items : [{ label: "No bookmarks yet", hint: "Bookmark a page with the button beside this", icon: ICONS.bookmark, run: () => undefined }], "Go to");
        });
    }
  });
  input.addEventListener("change", () => show(Number(input.value) || current));
  input.addEventListener("blur", paintBar);
  const resized = new ResizeObserver(() => {
    if (zoom === "fit") layout();
  });
  for (const s of slots) sized(s);
  for (const s of slots) watcher.observe(s.el);
  resized.observe(pages);
  show(current);
  paintBar();
  return {
    hash,
    leave: async () => true,
    close: () => {
      closed = true;
      clearTimeout(keepTimer);
      keep();
      watcher.disconnect();
      resized.disconnect();
      for (const s of slots) release(s);
      el.replaceChildren();
      void doc.loadingTask.destroy();
    },
    zoom: setZoom,
    key: (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest("input")) return false;
      if (e.key === "PageDown") show(current + 1);
      else if (e.key === "PageUp") show(current - 1);
      else if (e.key === "Home") show(1);
      else if (e.key === "End") show(count);
      else if (e.key === "ArrowDown") pages.scrollTop += pages.clientHeight / 10;
      else if (e.key === "ArrowUp") pages.scrollTop -= pages.clientHeight / 10;
      else return false;
      return true;
    },
    goTo: (at) => show(Number(at)),
    toggleMark,
    here: mark,
  };
}
