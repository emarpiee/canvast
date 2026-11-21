import type { AssetLibrary } from "../assets/asset-library";
import type { AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import type { Session } from "../app/session";
import type { SettingsStore } from "../settings/settings";
import { commands, pressCommand } from "../commands/registry";
import type { Command, OptionSpec } from "../commands/types";
import { folderPath } from "../assets/asset-catalog";
import { newObjectId } from "../doc/model";
import { plural } from "../doc/plural";
import { confirmDialog, promptDialog } from "./confirm";
import { esc } from "./format";
import { ICONS } from "./icons";
import { commandRows, openMoreMenu } from "./more-menu";
import { panelHtml } from "./panel";

/**
 * Reference windows (ADR 0207): small windows that float over every view (the canvas, the Library, PhotoCraft, Settings), above the bars and
 * panels and under menus and dialogs, to keep references in sight while working. One shows a **gallery** (the pictures of a library folder,
 * or all of them), the other a **board**: a simple surface, panned and zoomed but not endless, where pictures dragged from the Library, the
 * canvas or another app are laid out. Boards are saved with the workspace (Settings `reference.boards`); the windows open on a device are
 * opened again (`reference.windows`). A window only shows: it changes no picture. Hidden items show only while the hidden items do, as on a
 * canvas (a padlock in their place otherwise).
 */

export type RefSource = string; // "all" | "folder:<id>" | "board:<id>"
interface Item { h: string; x: number; y: number; w: number }
interface Board { id: string; name: string; items: Item[]; view?: { x: number; y: number; k: number } }

export interface ReferenceDeps {
  session: Session;
  assets: AssetLibrary;
  settings: SettingsStore;
  /** Whether the hidden items show now (hidden mode, the hidden items open). */
  hidden(): boolean;
  /** Files into the library (pasted or dropped from another app): their hashes. */
  importFiles(files: File[]): Promise<string[]>;
  /** The pictures selected on the canvas, then those copied there last: their library files. */
  canvasPictures(): string[];
  say(text: string): void;
}

const LIBRARY_DRAG = "application/x-canvast-assets";
const MAX_ITEMS = 1000;
const MIN_W = 220, MIN_H = 160;

export function mountReferenceWindows(deps: ReferenceDeps): { open(source?: RefSource): void; refresh(): void } {
  const { settings, session } = deps;
  const read = <T>(key: "reference.boards" | "reference.windows"): T[] => {
    try {
      return JSON.parse(settings.get(key)) as T[];
    } catch {
      return [];
    }
  };
  const boards = (): Board[] => read<Board>("reference.boards");
  const saveBoards = (all: Board[]): void => void settings.set("reference.boards", JSON.stringify(all));
  const boardById = (id: string): Board | undefined => boards().find((b) => b.id === id);
  const updateBoard = (id: string, f: (b: Board) => Board): void => saveBoards(boards().map((b) => (b.id === id ? f(b) : b)));

  // ---- pictures: a thumbnail at first, the file itself when shown large; one address per file, for every window
  const urls = new Map<string, { thumb?: Promise<string | null>; full?: Promise<string | null> }>();
  const urlOf = (hash: string, full: boolean): Promise<string | null> => {
    const at = urls.get(hash) ?? {};
    urls.set(hash, at);
    const key = full ? "full" : "thumb";
    at[key] ??= (async () => {
      const blob = full ? (await deps.assets.record(hash).catch(() => undefined))?.blob : (await session.catalog?.thumb(hash).catch(() => undefined))?.blob;
      return blob ? URL.createObjectURL(blob) : full ? urlOf(hash, false) : null;
    })();
    return at[key]!;
  };
  const listing = async (): Promise<{ entries: CatalogEntry[]; folders: AssetFolder[] } | null> => (await session.catalog?.list().catch(() => null)) ?? null;
  const isPicture = (e: CatalogEntry): boolean => e.type.startsWith("image/") && e.state === "active";
  const shows = (e: CatalogEntry | undefined): boolean => !!e && (deps.hidden() || !e.hidden);

  const wins = new Map<string, Win>();
  const keepWindows = (): void => void settings.set("reference.windows", JSON.stringify([...wins.values()].map((w) => ({ source: w.source, x: w.el.offsetLeft, y: w.el.offsetTop, w: w.el.offsetWidth, h: w.el.offsetHeight }))));

  interface Win { id: string; source: RefSource; el: HTMLElement; render(): Promise<void>; close(): void }

  const open = (source: RefSource = "all", at?: { x: number; y: number; w: number; h: number }): Win => {
    const id = newObjectId();
    const el = document.createElement("aside");
    el.className = "layers-panel ref-window";
    el.dataset["testid"] = "reference-window";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Reference window");
    el.tabIndex = -1;
    el.innerHTML = panelHtml({
      title: "Reference",
      tools: `<select data-ref-source data-name="What it shows" aria-label="What it shows" data-view-state></select><button type="button" class="layer-btn" data-ref-more aria-haspopup="menu" aria-label="Boards" title="Boards: a new one, rename or delete this one, fit it in the window">${ICONS.ellipsis}</button>`,
      body: `<div class="ref-body" data-ref-body></div>`,
    });
    const n = wins.size;
    const box = at ?? { x: Math.max(8, window.innerWidth - 380 - 24 * n), y: 72 + 24 * n, w: 360, h: 300 };
    Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${Math.max(MIN_W, box.w)}px`, height: `${Math.max(MIN_H, box.h)}px` });
    document.body.append(el);
    const body = el.querySelector<HTMLElement>("[data-ref-body]")!;
    const pick = el.querySelector<HTMLSelectElement>("[data-ref-source]")!;
    const win: Win = { id, source, el, render: async () => undefined, close: () => undefined };

    // moved by its header, kept inside the window of the app
    const head = el.querySelector<HTMLElement>(".panel-head")!;
    head.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button, select, input") || e.button !== 0) return;
      const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
      head.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent): void => {
        el.style.left = `${Math.min(window.innerWidth - 60, Math.max(-el.offsetWidth + 60, m.clientX - sx))}px`;
        el.style.top = `${Math.min(window.innerHeight - 40, Math.max(0, m.clientY - sy))}px`;
      };
      const up = (): void => {
        head.removeEventListener("pointermove", move);
        keepWindows();
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up, { once: true });
      head.addEventListener("pointercancel", up, { once: true });
    });
    new ResizeObserver(() => {
      keepWindows();
      if (win.source.startsWith("board:")) placeStage();
    }).observe(el);
    // view-state: (closes this window; its board is kept)
    el.querySelector("[data-close]")!.addEventListener("click", () => win.close());
    win.close = (): void => {
      el.remove();
      wins.delete(id);
      keepWindows();
    };
    // view-state: (which gallery or board this window shows; a new board is the command's)
    pick.addEventListener("change", () => {
      if (pick.value === "new") return void newBoard(win);
      win.source = pick.value;
      keepWindows();
      void win.render();
    });
    el.querySelector<HTMLElement>("[data-ref-more]")!.addEventListener("click", (e) => {
      const b = win.source.startsWith("board:") ? win.source.slice(6) : null;
      openMoreMenu(e.currentTarget as HTMLElement, commandRows([
        ["reference.newBoard", { hint: "An empty board in this window" }] as const,
        ...(b ? [["reference.renameBoard", { hint: "A new name for this board" }] as const, ["reference.fit", { hint: "Every picture in sight" }] as const, ["reference.deleteBoard", { hint: "This board; its pictures stay in the library", danger: true }] as const] : []),
      ]).map((r) => ({ ...r, run: () => (r.command === "reference.newBoard" ? void newBoard(win) : void pressCommand(r.command, { window: id, board: b ?? "" })) })), "Boards");
    });
    // Escape: back from one picture to the gallery
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && one !== null) {
        e.stopPropagation();
        one = null;
        void win.render();
      }
    });

    // ---- the source list
    const fillPick = async (): Promise<void> => {
      const l = await listing();
      const folders = (l?.folders ?? []).filter((f) => deps.hidden() || !f.hidden).map((f) => ({ id: f.id, path: folderPath(l!.folders, f.id).join(" › ") })).sort((a, b) => a.path.localeCompare(b.path));
      const bs = boards();
      pick.innerHTML = `<optgroup label="Gallery"><option value="all">All pictures</option>${folders.map((f) => `<option value="folder:${f.id}">${esc(f.path)}</option>`).join("")}</optgroup><optgroup label="Boards">${bs.map((b) => `<option value="board:${b.id}">${esc(b.name)}</option>`).join("")}<option value="new">New board…</option></optgroup>`;
      if (![...pick.options].some((o) => o.value === win.source)) win.source = "all";
      pick.value = win.source;
    };

    // ---- a gallery: the pictures of a folder (and the folders in it), or all; one large with the arrows
    let one: number | null = null;
    let shown: CatalogEntry[] = [];
    const gallery = async (): Promise<void> => {
      const l = await listing();
      if (!l) return void (body.innerHTML = `<p class="adj-note">No library is open.</p>`);
      const fid = win.source.startsWith("folder:") ? win.source.slice(7) : null;
      const under = new Set(fid ? [fid] : []);
      for (let grew = !!fid; grew; ) {
        grew = false;
        for (const f of l.folders) if (f.parentId !== null && under.has(f.parentId) && !under.has(f.id)) under.add(f.id), (grew = true);
      }
      shown = l.entries.filter((e) => isPicture(e) && shows(e) && (!fid || e.folderIds?.some((f) => under.has(f)))).sort((a, b) => b.importedAt - a.importedAt);
      if (one !== null && shown[one]) {
        const e = shown[one]!;
        body.innerHTML = `<div class="ref-one"><img data-ref-big alt="${esc(e.name)}" draggable="false"><div class="ref-one-bar"><button type="button" class="layer-btn" data-ref-back aria-label="Back to the gallery" title="Back to the gallery (Esc)">${ICONS.layoutGrid}</button><span class="ref-one-name" title="${esc(e.name)}">${esc(e.name)}</span><button type="button" class="layer-btn" data-ref-prev aria-label="Previous picture" title="Previous picture (←)">${ICONS.chevronLeft}</button><button type="button" class="layer-btn" data-ref-next aria-label="Next picture" title="Next picture (→)">${ICONS.chevronRight}</button></div></div>`;
        void urlOf(e.hash, true).then((u) => { const img = body.querySelector<HTMLImageElement>("[data-ref-big]"); if (img && u) img.src = u; });
        return;
      }
      one = null;
      body.innerHTML = shown.length
        ? `<p class="adj-note">${plural(shown.length, "picture")}</p><div class="ref-grid">${shown.map((e, i) => `<button type="button" class="ref-thumb" data-ref-i="${i}" draggable="true" title="${esc(e.name)}" aria-label="${esc(e.name)}"><img alt="" draggable="false"></button>`).join("")}</div>`
        : `<p class="adj-note">No pictures here${deps.hidden() ? "" : " (hidden ones show in hidden mode)"}.</p>`;
      const io = new IntersectionObserver((seen) => {
        for (const s of seen) {
          if (!s.isIntersecting) continue;
          io.unobserve(s.target);
          const e = shown[Number((s.target as HTMLElement).dataset["refI"])];
          if (e) void urlOf(e.hash, false).then((u) => { const img = s.target.querySelector("img"); if (img && u) img.src = u; });
        }
      }, { root: body, rootMargin: "200px" });
      for (const t of body.querySelectorAll(".ref-thumb")) io.observe(t);
    };
    // view-state: (one picture large, the next or the one before, back to the gallery)
    body.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const th = t.closest<HTMLElement>(".ref-thumb");
      if (th) one = Number(th.dataset["refI"]);
      else if (t.closest("[data-ref-back]")) one = null;
      else if (t.closest("[data-ref-prev]") && one !== null) one = (one - 1 + shown.length) % shown.length;
      else if (t.closest("[data-ref-next]") && one !== null) one = (one + 1) % shown.length;
      else return;
      void win.render();
    });
    body.addEventListener("keydown", (e) => {
      if (one === null || !shown.length || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      one = (one + (e.key === "ArrowLeft" ? -1 : 1) + shown.length) % shown.length;
      void win.render();
    });
    // a picture of the gallery dragged onto a board (or onto the Library's folders, the canvas: what a Library card carries)
    body.addEventListener("dragstart", (e) => {
      const th = (e.target as HTMLElement).closest<HTMLElement>(".ref-thumb");
      const entry = th && shown[Number(th.dataset["refI"])];
      if (!entry || !e.dataTransfer) return;
      e.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify([entry.hash]));
      e.dataTransfer.setData("text/plain", entry.name);
      e.dataTransfer.effectAllowed = "copy";
    });

    // ---- a board: its pictures where they were put, panned and zoomed in the window
    let view = { x: 0, y: 0, k: 1 };
    let picked: number | null = null;
    let stage: HTMLElement | null = null;
    const placeStage = (): void => {
      if (stage) stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    };
    const ratio = new Map<string, number>(); // (each picture's height over width, once its thumbnail is read)
    const boardOf = (): Board | undefined => (win.source.startsWith("board:") ? boardById(win.source.slice(6)) : undefined);
    const board = async (): Promise<void> => {
      const b = boardOf();
      if (!b) return void (win.source = "all", win.render());
      const entries = new Map((await listing())?.entries.map((e) => [e.hash, e]) ?? []);
      view = b.view ?? view;
      body.innerHTML = `<div class="ref-board" tabindex="0" data-ref-board aria-label="Board ${esc(b.name)}: drop pictures here, drag to move them or the board, the wheel zooms"><div class="ref-stage" data-ref-stage>${b.items
        .map((it, i) => {
          const e = entries.get(it.h);
          const hiddenNow = !!e?.hidden && !deps.hidden();
          const inner = !e ? `<span class="ref-gone">${ICONS.fileMissing}<span>Missing</span></span>` : hiddenNow ? `<span class="ref-gone">${ICONS.lockKeyhole}<span>Hidden</span></span>` : `<img alt="${esc(e.name)}" draggable="false">`;
          return `<div class="ref-item${picked === i ? " is-picked" : ""}" data-ref-item="${i}" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.w * (ratio.get(it.h) ?? 0.75)}px">${inner}<span class="ref-grip" data-ref-grip aria-hidden="true"></span></div>`;
        })
        .join("")}</div>${b.items.length ? "" : `<p class="adj-note ref-empty">Drop pictures here from the Library, the canvas or another app, or paste them (Ctrl+V).</p>`}</div>`;
      stage = body.querySelector("[data-ref-stage]");
      placeStage();
      b.items.forEach((it, i) => {
        const e = entries.get(it.h);
        if (!e || (e.hidden && !deps.hidden())) return;
        const big = it.w * view.k > 360;
        void urlOf(it.h, big).then((u) => {
          const node = body.querySelector<HTMLElement>(`[data-ref-item="${i}"]`);
          const img = node?.querySelector("img");
          if (!img || !u) return;
          img.onload = () => {
            const r = img.naturalHeight / Math.max(1, img.naturalWidth);
            ratio.set(it.h, r);
            node!.style.height = `${it.w * r}px`;
          };
          img.src = u;
        });
      });
    };
    const saveView = (() => {
      let t = 0;
      return (): void => {
        clearTimeout(t);
        const b = boardOf();
        if (b) t = window.setTimeout(() => updateBoard(b.id, (x) => ({ ...x, view })), 400);
      };
    })();
    /** The board's own units at a point of the screen. */
    const onBoard = (cx: number, cy: number): { x: number; y: number } => {
      const r = body.querySelector<HTMLElement>("[data-ref-board]")!.getBoundingClientRect();
      return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
    };
    /** Not endless: the view keeps some of the pictures in sight. */
    const clampView = (): void => {
      const b = boardOf();
      const area = body.querySelector<HTMLElement>("[data-ref-board]");
      if (!b || !area || !b.items.length) return;
      const minX = Math.min(...b.items.map((i) => i.x)), maxX = Math.max(...b.items.map((i) => i.x + i.w)), minY = Math.min(...b.items.map((i) => i.y)), maxY = Math.max(...b.items.map((i) => i.y + i.w));
      const w = area.clientWidth, h = area.clientHeight;
      view.x = Math.min(w - 40 - minX * view.k, Math.max(40 - maxX * view.k, view.x));
      view.y = Math.min(h - 40 - minY * view.k, Math.max(40 - maxY * view.k, view.y));
    };
    body.addEventListener("wheel", (e) => {
      if (!boardOf()) return;
      e.preventDefault();
      const p = onBoard(e.clientX, e.clientY);
      const k = Math.min(8, Math.max(0.05, view.k * Math.exp(-e.deltaY / 400)));
      const r = body.querySelector<HTMLElement>("[data-ref-board]")!.getBoundingClientRect();
      view = { k, x: e.clientX - r.left - p.x * k, y: e.clientY - r.top - p.y * k };
      clampView();
      placeStage();
      saveView();
    }, { passive: false });
    body.addEventListener("pointerdown", (e) => {
      const b = boardOf();
      if (!b || e.button !== 0) return;
      const t = e.target as HTMLElement;
      const node = t.closest<HTMLElement>("[data-ref-item]");
      const i = node ? Number(node.dataset["refItem"]) : null;
      const grip = !!t.closest("[data-ref-grip]");
      if (picked !== i) {
        picked = i;
        for (const n of body.querySelectorAll<HTMLElement>("[data-ref-item]")) n.classList.toggle("is-picked", Number(n.dataset["refItem"]) === i);
      }
      body.querySelector<HTMLElement>("[data-ref-board]")?.focus({ preventScroll: true });
      const sx = e.clientX, sy = e.clientY, it = i !== null ? { ...b.items[i]! } : null, v0 = { ...view };
      body.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent): void => {
        const dx = m.clientX - sx, dy = m.clientY - sy;
        if (it && node) {
          if (grip) node.style.width = `${Math.max(16, it.w + dx / view.k)}px`, (node.style.height = `${Math.max(16, it.w + dx / view.k) * (ratio.get(it.h) ?? 0.75)}px`);
          else node.style.left = `${it.x + dx / view.k}px`, (node.style.top = `${it.y + dy / view.k}px`);
        } else {
          view = { ...v0, x: v0.x + dx, y: v0.y + dy };
          clampView();
          placeStage();
        }
      };
      const up = (u: PointerEvent): void => {
        body.removeEventListener("pointermove", move);
        const dx = u.clientX - sx, dy = u.clientY - sy;
        if (it && i !== null && Math.hypot(dx, dy) > 2) {
          const patch = grip ? { w: Math.max(16, it.w + dx / view.k) } : { x: it.x + dx / view.k, y: it.y + dy / view.k };
          void pressCommand("reference.place", { board: b.id, index: i, ...patch });
        } else if (!it) saveView();
      };
      body.addEventListener("pointermove", move);
      body.addEventListener("pointerup", up, { once: true });
      body.addEventListener("pointercancel", up, { once: true });
    });
    body.addEventListener("dblclick", (e) => {
      if (boardOf() && !(e.target as HTMLElement).closest("[data-ref-item]")) void pressCommand("reference.fit", { window: id, board: boardOf()!.id });
    });
    body.addEventListener("keydown", (e) => {
      const b = boardOf();
      if (!b || picked === null || (e.key !== "Delete" && e.key !== "Backspace")) return;
      e.preventDefault();
      void pressCommand("reference.remove", { board: b.id, index: picked });
      picked = null;
    });
    // ---- pictures in: dropped (from the Library, a gallery, another app), or pasted
    body.addEventListener("dragover", (e) => {
      if (!boardOf() || !e.dataTransfer) return;
      if ([...e.dataTransfer.types].some((t) => t === LIBRARY_DRAG || t === "Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    body.addEventListener("drop", (e) => {
      const b = boardOf();
      if (!b || !e.dataTransfer) return;
      e.preventDefault();
      const at = onBoard(e.clientX, e.clientY);
      const lib = e.dataTransfer.getData(LIBRARY_DRAG);
      if (lib) return void addTo(b.id, (JSON.parse(lib) as string[]).filter((h) => typeof h === "string"), at);
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) void deps.importFiles(files).then((hs) => addTo(b.id, hs, at));
    });
    // pictures dragged off the canvas (main.ts: the canvas's move let go over this board)
    body.addEventListener("ref-drop", (e) => {
      const b = boardOf(), d = (e as CustomEvent<{ hashes: string[]; x: number; y: number }>).detail;
      if (b && d) addTo(b.id, d.hashes, onBoard(d.x, d.y));
    });
    el.addEventListener("paste", (e) => {
      const b = boardOf();
      if (!b) return;
      e.preventDefault();
      const area = body.querySelector<HTMLElement>("[data-ref-board]")!.getBoundingClientRect();
      const at = onBoard(area.left + area.width / 2, area.top + area.height / 2);
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) return void deps.importFiles(files).then((hs) => addTo(b.id, hs, at));
      const fromCanvas = deps.canvasPictures();
      if (fromCanvas.length) addTo(b.id, fromCanvas, at);
      else deps.say("Nothing to paste: copy pictures on the canvas or in another app first.");
    });
    // Ctrl+C on a board's picture or the picture shown large: its file, to paste on the canvas or in another app (not a hidden one)
    el.addEventListener("copy", (e) => {
      const b = boardOf();
      const hash = b && picked !== null ? b.items[picked]?.h : one !== null ? shown[one]?.hash : undefined;
      if (!hash) return;
      e.preventDefault();
      void (async () => {
        const entry = (await listing())?.entries.find((x) => x.hash === hash);
        if (entry?.hidden) return deps.say("A hidden picture is not copied out of the app.");
        const rec = await deps.assets.record(hash).catch(() => undefined);
        if (!rec) return;
        try {
          const png = rec.blob.type === "image/png" ? rec.blob : await toPng(rec.blob);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
          deps.say(`“${entry?.name ?? "The picture"}” copied.`);
        } catch {
          deps.say("The picture could not be copied.");
        }
      })();
    });

    win.render = async (): Promise<void> => {
      await fillPick();
      el.dataset["mode"] = win.source.startsWith("board:") ? "board" : "gallery";
      if (win.source.startsWith("board:")) await board();
      else await gallery();
    };
    wins.set(id, win);
    void win.render();
    keepWindows();
    el.focus({ preventScroll: true });
    return win;
  };

  const toPng = async (blob: Blob): Promise<Blob> => {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    return new Promise<Blob>((done, fail) => c.toBlob((b) => (b ? done(b) : fail(new Error("no picture"))), "image/png"));
  };

  /** Pictures put on a board, side by side from a point (each 200 board units wide), at most a thousand on one board. */
  const addTo = (board: string, hashes: readonly string[], at: { x: number; y: number }): void => {
    if (hashes.length) void pressCommand("reference.add", { board, ids: [...hashes], x: at.x, y: at.y });
  };
  const newBoard = async (w?: Win): Promise<void> => {
    const name = await promptDialog({ title: "New board", lines: ["A board of references, saved with this workspace."], value: `Board ${boards().length + 1}`, confirmLabel: "Make it" });
    if (name === null) return void w?.render();
    void pressCommand("reference.newBoard", { name, ...(w ? { window: w.id } : {}) });
  };
  const renderAll = (): void => {
    for (const w of wins.values()) void w.render();
  };
  const winOf = (o: Readonly<Record<string, unknown>>): Win | undefined => (typeof o["window"] === "string" ? wins.get(o["window"]) : undefined);

  // ---- commands (ADR 0205): every action of the windows, for the buttons, menus, keys, macros and outside callers alike
  const ID: OptionSpec = { name: "board", type: "id", doc: "the board's id", required: true };
  const rc = (id: string, title: string, hint: string, risk: NonNullable<Command["risk"]>, options: readonly OptionSpec[], exec: NonNullable<Command["exec"]>, why: () => string | null = () => null): Command => ({ id, group: "Reference", kind: "reference", title, hint, icon: ICONS.referenceWindow, risk, options, why, exec });
  const hasBoard = (o: Readonly<Record<string, unknown>>): Board | null => boardById(String(o["board"] ?? "")) ?? null;
  commands.setProvider("reference", () => [
    rc("reference.open", "Reference window", "A gallery or a board, over every view (Shift+R)", "read", [{ name: "source", type: "text", doc: "all, folder:<id> or board:<id> (all when left out)" }], (o) => {
      const w = open(typeof o["source"] === "string" ? o["source"] : "all");
      return { ok: true, value: w.id };
    }),
    rc("reference.newBoard", "New board", "An empty board of references", "edit", [{ name: "name", type: "text", doc: "its name", required: true }, { name: "window", type: "text", doc: "the window to show it in (a new one when left out)" }], (o) => {
      const name = String(o["name"]).trim().slice(0, 80) || "Board";
      const all = boards();
      if (all.length >= 100) return { ok: false, error: "There are 100 boards already: delete one first." };
      const b: Board = { id: newObjectId(), name, items: [] };
      saveBoards([...all, b]);
      const w = winOf(o);
      if (w) {
        w.source = `board:${b.id}`;
        keepWindows();
      } else open(`board:${b.id}`);
      renderAll();
      return { ok: true, made: [b.id] };
    }),
    rc("reference.renameBoard", "Rename the board", "A new name for it", "edit", [ID, { name: "name", type: "text", doc: "its new name (asked when left out)" }], async (o) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such board." };
      const name = typeof o["name"] === "string" ? o["name"] : await promptDialog({ title: "Rename the board", lines: [], value: b.name, confirmLabel: "Rename" });
      if (name === null) return { ok: true };
      updateBoard(b.id, (x) => ({ ...x, name: name.trim().slice(0, 80) || x.name }));
      renderAll();
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.deleteBoard", "Delete the board", "Its pictures stay in the library", "confirm", [ID], async (o, ctx) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such board." };
      if (ctx.caller !== "agent" && !(await confirmDialog({ title: `Delete the board “${b.name}”?`, lines: [`Its ${plural(b.items.length, "picture")} stay in the library; only the board goes.`], confirmLabel: "Delete it" }))) return { ok: true };
      saveBoards(boards().filter((x) => x.id !== b.id));
      for (const w of wins.values()) if (w.source === `board:${b.id}`) w.source = "all";
      keepWindows();
      renderAll();
      return { ok: true, removed: [b.id] };
    }),
    rc("reference.add", "Put pictures on a board", "Library files, side by side", "edit", [ID, { name: "ids", type: "ids", doc: "the library files (their hashes)", required: true }, { name: "x", type: "number", doc: "where, across" }, { name: "y", type: "number", doc: "where, down" }], async (o) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such board." };
      const l = await listing();
      const known = new Map(l?.entries.map((e) => [e.hash, e]) ?? []);
      const hs = ((o["ids"] as string[]) ?? []).filter((h) => isPicture(known.get(h) ?? ({ type: "", state: "gone" } as unknown as CatalogEntry)));
      if (!hs.length) return { ok: false, error: "Those are not pictures of the library." };
      const room = MAX_ITEMS - b.items.length;
      if (room <= 0) return { ok: false, error: `A board holds at most ${MAX_ITEMS} pictures.` };
      const x = Number(o["x"] ?? 0), y = Number(o["y"] ?? 0);
      const items = hs.slice(0, room).map((h, i): Item => ({ h, x: x + (i % 6) * 220, y: y + Math.floor(i / 6) * 220, w: 200 }));
      updateBoard(b.id, (bd) => ({ ...bd, items: [...bd.items, ...items] }));
      renderAll();
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.place", "Move a picture on a board", "Where it is, or how wide", "edit", [ID, { name: "index", type: "number", doc: "which picture (from 0)", required: true }, { name: "x", type: "number", doc: "across" }, { name: "y", type: "number", doc: "down" }, { name: "w", type: "number", doc: "its width" }], (o) => {
      const b = hasBoard(o), i = Number(o["index"]);
      if (!b || !b.items[i]) return { ok: false, error: "No such picture on that board." };
      const n = (k: string, now: number, min = -1e7): number => (typeof o[k] === "number" && Number.isFinite(o[k]) ? Math.max(min, Math.min(1e7, o[k] as number)) : now);
      updateBoard(b.id, (bd) => ({ ...bd, items: bd.items.map((it, j) => (j === i ? { ...it, x: n("x", it.x), y: n("y", it.y), w: n("w", it.w, 16) } : it)) }));
      renderAll();
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.remove", "Take a picture off a board", "It stays in the library", "edit", [ID, { name: "index", type: "number", doc: "which picture (from 0)", required: true }], (o) => {
      const b = hasBoard(o), i = Number(o["index"]);
      if (!b || !b.items[i]) return { ok: false, error: "No such picture on that board." };
      updateBoard(b.id, (bd) => ({ ...bd, items: bd.items.filter((_, j) => j !== i) }));
      renderAll();
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.fit", "Fit the board", "Every picture in sight", "read", [{ name: "window", type: "text", doc: "the window", required: true }, ID], (o) => {
      const w = winOf(o), b = hasBoard(o);
      if (!w || !b) return { ok: false, error: "No such window or board." };
      const area = w.el.querySelector<HTMLElement>("[data-ref-board]");
      if (!area || !b.items.length) return { ok: true };
      const minX = Math.min(...b.items.map((i) => i.x)), maxX = Math.max(...b.items.map((i) => i.x + i.w)), minY = Math.min(...b.items.map((i) => i.y)), maxY = Math.max(...b.items.map((i) => i.y + i.w));
      const k = Math.min(8, Math.max(0.05, Math.min((area.clientWidth - 24) / Math.max(1, maxX - minX), (area.clientHeight - 24) / Math.max(1, maxY - minY))));
      updateBoard(b.id, (bd) => ({ ...bd, view: { k, x: 12 - minX * k + (area.clientWidth - 24 - (maxX - minX) * k) / 2, y: 12 - minY * k } }));
      void w.render();
      return { ok: true };
    }),
  ]);

  // the windows open last time, opened again
  for (const w of read<{ source: string; x: number; y: number; w: number; h: number }>("reference.windows")) open(w.source, w);
  return { open: (s) => void open(s), refresh: renderAll };
}
