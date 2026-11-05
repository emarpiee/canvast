import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { PDF_CARD_EDGE, closePdf, needsPassword, openPdf, pageFit, pageSize, pageWords, pdfTextLayer } from "../assets/pdf-engine";
import { pageList } from "../assets/pdf-pages";
import { scrubNumbers } from "../colour-picker/scrub";
import { promptDialog } from "./confirm";
import type { CardLook, FileFacts, OpenView, ViewDeps, ViewPlace } from "./file-views";
import { ICONS } from "./icons";
import { barButton } from "./view-bar";
import { openMoreMenu } from "./more-menu";
import { keepViewState, markActions, toggledMark, viewStateOf } from "./view-state";
import type { MarksChange, ViewState } from "./view-state";

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;
/** The most pixels one page's picture takes: past it the page is a little soft at the highest zooms, rather than the memory gone. */
const MAX_PAGE_PIXELS = 16e6;
const KEEP_MS = 600;
const REDRAW_MS = 150;
const WHEEL_ZOOM = 0.002;
/** The most cards one Place pages makes. */
const MAX_PLACED_PAGES = 200;

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
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  // A password is asked for each time and kept nowhere.
  let doc: PDFDocumentProxy | null = null;
  for (let tried: string | undefined; !doc; ) {
    try {
      doc = await openPdf(bytes, tried);
    } catch (e) {
      if (!needsPassword(e)) throw e;
      const given = await promptDialog({ title: "This PDF has a password", lines: [tried === undefined ? `Type the password of “${file.name}” to read it.` : "That password is not the one. Try again."], value: "", confirmLabel: "Open", secret: true });
      if (given === null) throw new Error("it has a password");
      tried = given;
    }
  }
  const pdf = doc;
  const first = pageSize(await pdf.getPage(1));
  const count = pdf.numPages;
  el.innerHTML = `<div class="pdf-view" data-testid="pdf-view">
    <div class="view-bar">
      ${barButton("prev", ICONS.pageUp, "Previous page", "Previous page (Page Up)")}
      ${barButton("next", ICONS.pageDown, "Next page", "Next page (Page Down)")}
      <label class="view-field">Page <input class="adj-num pdf-at" type="number" min="1" max="${count}" step="1" aria-label="Page" data-testid="pdf-page" /></label><span class="pdf-count">/ ${count}</span>
      <span class="view-gap"></span>
      ${barButton("out", ICONS.minus, "Zoom out", "Zoom out (Ctrl+-)")}
      ${barButton("fit", ICONS.unfoldHorizontal, "Fit the width", "Fit the width (Ctrl+0)")}
      ${barButton("in", ICONS.plus, "Zoom in", "Zoom in (Ctrl++)")}
      <span class="view-gap"></span>
      <input class="adj-num pdf-find" type="search" placeholder="Find" aria-label="Find in this PDF" data-testid="pdf-find" /><span class="pdf-count" data-testid="pdf-found"></span>
      <span class="view-gap"></span>
      ${barButton("mark", ICONS.bookmarkPlus, "Bookmark this page", "Bookmark this page, or take its bookmark off", 'aria-pressed="false"')}
      ${barButton("marks", ICONS.tableOfContents, "Go to", "Bookmarks, and the contents of this PDF", 'aria-haspopup="menu"')}
      ${place.placeViews ? barButton("place", ICONS.grid2x2Plus, "Place pages on the canvas", "Place pages on the canvas: a card for each") : ""}
      ${place.setPreview ? barButton("card", ICONS.pictureInPicture, "Show this page on the card", "Show this page on the card on the canvas, this copy only (Ctrl+S)") : ""}
    </div>
    <div class="pdf-pages" tabindex="0" data-testid="pdf-pages"></div>
  </div>`;
  const root = el.querySelector<HTMLElement>(".pdf-view")!;
  scrubNumbers(root.querySelector<HTMLElement>(".view-bar")!);
  const pages = root.querySelector<HTMLElement>(".pdf-pages")!;
  const input = root.querySelector<HTMLInputElement>(".pdf-at")!;
  const markBtn = root.querySelector<HTMLElement>('[data-view-act="mark"]')!;
  const finder = root.querySelector<HTMLInputElement>(".pdf-find")!;
  const found = root.querySelector<HTMLElement>('[data-testid="pdf-found"]')!;
  let zoom: number | "fit" = "fit";
  const hash = file.hash;
  let state: ViewState = viewStateOf(await deps.session.catalog?.entry(hash).catch(() => undefined));
  // (a card showing a page of its own opens there; else where the file was left)
  let current = Math.max(1, Math.min(count, (Number(place.startAt) > 1 ? Number(place.startAt) : Number(state.at)) || 1));
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
  const pagesRead = new Map<number, PDFPageProxy>();
  const release = (s: Slot): void => {
    s.turn++;
    s.task?.cancel();
    s.task = null;
    pagesRead.get(s.n)?.cleanup(); // (what the page's drawing held: it is read again when it comes back)
    pagesRead.delete(s.n);
    if (s.canvas) (s.canvas.width = s.canvas.height = 0);
    s.canvas = null;
    s.el.replaceChildren();
    delete s.el.dataset["drawn"];
  };
  const draw = async (s: Slot): Promise<void> => {
    const turn = ++s.turn;
    let page: PDFPageProxy;
    try {
      page = await pdf.getPage(s.n);
    } catch {
      return;
    }
    if (closed || turn !== s.turn) return;
    pagesRead.set(s.n, page);
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
    layer.dataset["selectable"] = ""; // (the app's words are not selectable; a page's are)
    s.el.style.setProperty("--total-scale-factor", String(k));
    s.el.style.setProperty("--scale-round-x", "1px");
    s.el.style.setProperty("--scale-round-y", "1px");
    s.el.replaceChildren(canvas, layer);
    s.canvas?.remove();
    s.canvas = canvas;
    s.el.dataset["drawn"] = "1";
    const TextLayer = await pdfTextLayer();
    if (closed || turn !== s.turn) return;
    void new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: page.getViewport({ scale: k }) }).render().then(paintFound, () => undefined);
    void addLinks(page, s, turn, k);
  };
  /** A PDF's links, over its page: to a page in it, gone to; to the web, said (canvast does not go online). */
  const addLinks = async (page: PDFPageProxy, s: Slot, turn: number, k: number): Promise<void> => {
    const notes = await page.getAnnotations().catch(() => []);
    if (closed || turn !== s.turn) return;
    const viewport = page.getViewport({ scale: k });
    for (const a of notes as Array<{ subtype: string; rect: number[]; url?: string; dest?: unknown }>) {
      if (a.subtype !== "Link" || (!a.url && !a.dest)) continue;
      const [x1, y1] = viewport.convertToViewportPoint(a.rect[0]!, a.rect[1]!) as [number, number];
      const [x2, y2] = viewport.convertToViewportPoint(a.rect[2]!, a.rect[3]!) as [number, number];
      const link = document.createElement("button");
      link.type = "button";
      link.className = "pdf-link";
      link.setAttribute("aria-label", a.url ? `Link to ${a.url}` : "Link to a page");
      link.title = a.url ?? "Go to this page";
      Object.assign(link.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` });
      link.addEventListener("click", () => void follow(a.url, a.dest));
      s.el.append(link);
    }
  };
  const follow = async (url: string | undefined, dest: unknown): Promise<void> => {
    if (url) {
      deps.session.editor.message = `Links to the web are not opened from a PDF (canvast does not go online): ${url}`;
      return deps.session.editor.changed();
    }
    const target = typeof dest === "string" ? await pdf.getDestination(dest).catch(() => null) : (dest as Awaited<ReturnType<PDFDocumentProxy["getDestination"]>>);
    const ref = target?.[0] as number | Parameters<PDFDocumentProxy["getPageIndex"]>[0] | undefined;
    const at = typeof ref === "number" ? ref : ref ? await pdf.getPageIndex(ref).catch(() => null) : null;
    if (at !== null) show(at + 1);
  };
  // ---- find: each page's words read once, the page found shown, what matches marked in its words where the browser can
  const words = new Map<number, string>();
  const wordsOf = async (n: number): Promise<string> => {
    if (!words.has(n)) words.set(n, (await pageWords(await pdf.getPage(n)).catch(() => "")).toLowerCase());
    return words.get(n)!;
  };
  let finding = 0;
  const paintFound = (): void => {
    const marks = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const Highlight = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!marks || !Highlight) return;
    const q = finder.value.trim().toLowerCase();
    const ranges: Range[] = [];
    // shortcut: words split across two runs of the page's text are found (the page is shown) but not marked; join the runs if it matters.
    if (q) for (const s of near) for (const t of s.el.querySelectorAll(".textLayer span")) {
      const node = t.firstChild;
      if (node?.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent!.toLowerCase();
      for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + q.length);
        ranges.push(r);
      }
    }
    marks.set("canvast-find", new Highlight(...ranges));
  };
  const find = async (dir: 1 | -1, from: number): Promise<void> => {
    const turn = ++finding, q = finder.value.trim().toLowerCase();
    if (!q) {
      found.textContent = "";
      return paintFound();
    }
    found.textContent = "…";
    for (let i = 0; i < count; i++) {
      const n = ((from - 1 + dir * i + count * 2) % count) + 1;
      const has = (await wordsOf(n)).includes(q);
      if (closed || turn !== finding) return;
      if (has) {
        show(n);
        found.textContent = `Page ${n}`;
        return paintFound();
      }
    }
    found.textContent = "Not found";
    paintFound();
  };
  finder.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void find(e.shiftKey ? -1 : 1, current + (e.shiftKey ? -1 : found.textContent?.startsWith("Page") ? 1 : 0));
    }
  });
  finder.addEventListener("input", () => void find(1, current));
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
  /** All sized again at once, the same page staying in view, and what is near drawn again when the size has settled (a panel being dragged wider changes it each frame). */
  let redrawTimer: ReturnType<typeof setTimeout> | undefined;
  const layout = (): void => {
    const keep = current;
    for (const s of slots) sized(s);
    show(keep);
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      for (const s of near) void draw(s);
    }, REDRAW_MS);
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
    else zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scaleOf((sizes.get(current) ?? first).w) * ZOOM_STEP ** dir));
    layout();
  };
  // Ctrl+wheel: zooms about the pointer. (In the viewer and in the panel alike: neither the page nor the canvas behind gets it.)
  pages.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const was = scaleOf((sizes.get(current) ?? first).w); // (at Fit, each page has its own: the one in view stays as it is)
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, was * Math.exp(-e.deltaY * WHEEL_ZOOM)));
    if (next === was) return;
    const r = pages.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, k = next / was;
    const left = (pages.scrollLeft + x) * k - x, top = (pages.scrollTop + y) * k - y;
    zoom = next;
    layout();
    pages.scrollLeft = left;
    pages.scrollTop = top;
  }, { passive: false });
  const mark = (): ViewState["marks"][number] => ({ at: String(current), label: `Page ${current}` });
  const changeMarks: MarksChange = (change) => {
    state = { ...state, marks: change(state.marks) };
    paintBar();
    keep();
    void place.refresh();
  };
  const card = (): CardLook => ({ preview: current === 1 ? "" : String(current), size: pageFit(sizes.get(current) ?? first, PDF_CARD_EDGE) }); // (the first page: a plain card, as any)
  const showOnCard = (): void => {
    const c = card();
    place.setPreview?.(c.preview, c.size);
    deps.session.editor.message = `Page ${current} now shows on the card.`;
    deps.session.editor.changed();
  };
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
        const dest = typeof it.dest === "string" ? await pdf.getDestination(it.dest).catch(() => null) : it.dest;
        const ref = dest?.[0] as number | Parameters<PDFDocumentProxy["getPageIndex"]>[0] | undefined;
        const at = typeof ref === "number" ? ref : ref ? await pdf.getPageIndex(ref).catch(() => null) : null;
        if (at !== null) out.push({ label: `${"  ".repeat(depth)}${it.title}`, page: at + 1 });
        await walk(it.items, depth + 1);
      }
    };
    await walk(await pdf.getOutline().catch(() => null) ?? undefined, 0);
    return out;
  };
  const placePages = async (): Promise<void> => {
    const asked = await promptDialog({ title: "Place pages on the canvas", lines: [`A card for each page, of ${count}: for example 1-4, 9`], value: `${current}`, confirmLabel: "Place" });
    if (asked === null) return;
    const list = pageList(asked, count).slice(0, MAX_PLACED_PAGES);
    if (!list.length) {
      deps.session.editor.message = "No such pages.";
      return deps.session.editor.changed();
    }
    const items = await Promise.all(list.map(async (n) => ({ preview: String(n), size: pageFit(pageSize(await pdf.getPage(n)), PDF_CARD_EDGE) })));
    place.placeViews?.(items);
  };
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-view-act]");
    switch (b?.dataset["viewAct"]) {
      case "prev": return show(current - 1);
      case "next": return show(current + 1);
      case "out": return setZoom(-1);
      case "in": return setZoom(1);
      case "fit": return setZoom(0);
      case "mark": return void toggleMark();
      case "place":
        return void placePages();
      case "card":
        return showOnCard();
      case "marks":
        return void outline().then((contents) => {
          const items = [...state.marks.map((m) => ({ label: m.label, hint: `Bookmark, page ${m.at}`, icon: ICONS.bookmark, run: () => show(Number(m.at)), more: markActions(m, changeMarks) })), ...contents.map((c) => ({ label: c.label, hint: `Page ${c.page}`, icon: ICONS.tableOfContents, run: () => show(c.page) }))];
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
      clearTimeout(redrawTimer);
      keep();
      watcher.disconnect();
      resized.disconnect();
      for (const s of slots) release(s);
      el.replaceChildren();
      finding++;
      (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete("canvast-find");
      closePdf(pdf);
    },
    zoom: setZoom,
    key: (e) => {
      if (place.setPreview && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {
        showOnCard();
        return true;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "f" || e.key === "F")) {
        finder.focus();
        finder.select();
        return true;
      }
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
    changeMarks,
    here: mark,
    card,
  };
}
