import { NeedsPassword, WrongPassword, isComicFile, openArchive } from "../assets/archive";
import type { Archive, ArchiveEntry } from "../assets/archive";
import { describeFile } from "../assets/file-kind";
import { FILE_CARD_H, FILE_CARD_W } from "../assets/card";
import { pageFit } from "../assets/pdf-engine";
import { scrubNumbers } from "../colour-picker/scrub";
import { plural } from "../doc/plural";
import { promptDialog } from "./confirm";
import type { CardLook, FileFacts, OpenView, ViewDeps, ViewPlace } from "./file-views";
import { viewKindNamed } from "./file-views";
import { esc, fmtBytes } from "./format";
import { ICONS } from "./icons";
import { barButton } from "./view-bar";
import { pageKey, swipePages } from "./page-turn";
import { openMoreMenu } from "./more-menu";
import { markActions, toggledMark, viewKeeper, viewStateOf } from "./view-state";
import type { MarksChange, ViewState } from "./view-state";

/** A page's longer side on a new card, in pixels (as a PDF's). */
export const ARCHIVE_CARD_EDGE = 1600;
const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
/** A text file inside is shown up to this size; past it, it is imported to be read. */
const MAX_TEXT = 2 * 2 ** 20;
/** The most files one import takes from an archive. */
const MAX_IMPORT = 5000;

type Mode = "files" | "pages" | "file";

/**
 * A ZIP or a comic book (CBZ) in its view. Files: its folders and files as a list, a file opened inside it (a picture, a video or a sound, a
 * text) or imported into the library; Pages: its pictures one at a time, as a comic is read (a CBZ opens there). A file with a password asks
 * for it once, kept in this view only, never stored.
 */
export async function openArchiveView(el: HTMLElement, file: FileFacts, deps: ViewDeps, place: ViewPlace): Promise<OpenView> {
  const archive: Archive = await openArchive(file.blob);
  const { pages } = archive;
  const hash = file.hash;
  let state: ViewState = viewStateOf(await deps.session.catalog?.entry(hash).catch(() => undefined));
  // (the place is kept when the view closes; bookmarks at once)
  const keepState = viewKeeper(deps.session, hash, state);
  const keep = (): void => keepState(state);
  const startPage = Number(place.startAt) > 1 ? Number(place.startAt) : Number(state.at) || 1;
  let current = Math.max(1, Math.min(pages.length, startPage));
  let mode: Mode = pages.length && (isComicFile(file.name) || Number(place.startAt) > 1) ? "pages" : "files";
  let folder = "";
  let zoom: number | "fit" = "fit";
  let password: string | undefined;
  let closed = false;
  const picked = new Set<string>();
  let anchor: string | null = null;
  const urls = new Set<string>();

  const count = pages.length;
  el.innerHTML = `<div class="archive-view" data-testid="archive-view">
    <div class="view-bar">
      ${barButton("files", ICONS.folderOpen, "Files", "The files and folders in it", 'aria-pressed="false"')}
      ${count ? barButton("pages", ICONS.bookOpen, "Pages", `Read its ${plural(count, "picture")} as pages`, 'aria-pressed="false"') : ""}
      <span class="view-gap"></span>
      <span class="archive-tools" data-in="pages">
        ${barButton("prev", ICONS.pageUp, "Previous page", "Previous page (Page Up; the arrows once you click in the page; a swipe or a tap on its left part)")}
        ${barButton("next", ICONS.pageDown, "Next page", "Next page (Page Down, Space; the arrows once you click in the page; a swipe or a tap)")}
        <label class="view-field">Page <input class="adj-num archive-at" type="number" min="1" max="${count}" step="1" aria-label="Page" data-testid="archive-page" /></label><span class="pdf-count">/ ${count}</span>
        <span class="view-gap"></span>
        ${barButton("out", ICONS.minus, "Zoom out", "Zoom out (Ctrl+-)")}
        ${barButton("fit", ICONS.maximize, "Fit the page", "Fit the page (Ctrl+0)")}
        ${barButton("in", ICONS.plus, "Zoom in", "Zoom in (Ctrl++)")}
        <span class="view-gap"></span>
        ${barButton("mark", ICONS.bookmarkPlus, "Bookmark this page", "Bookmark this page, or take its bookmark off", 'aria-pressed="false"')}
        ${barButton("marks", ICONS.tableOfContents, "Go to", "Bookmarks", 'aria-haspopup="menu"')}
        ${place.setPreview ? barButton("card", ICONS.pictureInPicture, "Show this page on the card", "Show this page on the card on the canvas, this copy only (Ctrl+S)") : ""}
      </span>
      <span class="pdf-count" data-in="files" data-testid="archive-summary"></span>
      <span class="view-gap"></span>
      ${barButton("import", ICONS.arrowDownToLine, "Import to the library", "Import to the library: the selected files, or all in this folder when none is; the page in view when reading")}
    </div>
    <nav class="archive-path" data-in="files file" aria-label="Folders" data-testid="archive-path"></nav>
    <div class="archive-list" data-in="files" role="listbox" aria-multiselectable="true" aria-label="Files" tabindex="0" data-testid="archive-list"></div>
    <div class="archive-file" data-in="file" tabindex="0" data-testid="archive-file"></div>
    <div class="archive-pages" data-in="pages" tabindex="0" data-testid="archive-pages"><img class="archive-page" alt="" draggable="false" data-testid="archive-page-img" /></div>
  </div>`;
  const root = el.querySelector<HTMLElement>(".archive-view")!;
  scrubNumbers(root.querySelector<HTMLElement>(".view-bar")!);
  const list = root.querySelector<HTMLElement>(".archive-list")!;
  const crumbs = root.querySelector<HTMLElement>(".archive-path")!;
  const shown = root.querySelector<HTMLElement>(".archive-file")!;
  const pagesBox = root.querySelector<HTMLElement>(".archive-pages")!;
  const img = root.querySelector<HTMLImageElement>(".archive-page")!;
  const input = root.querySelector<HTMLInputElement>(".archive-at")!;
  const summary = root.querySelector<HTMLElement>('[data-testid="archive-summary"]')!;
  const markBtn = root.querySelector<HTMLElement>('[data-view-act="mark"]');

  const say = (message: string): void => {
    deps.session.editor.message = message;
    deps.session.editor.changed();
  };
  const urlOf = (b: Blob): string => {
    const u = URL.createObjectURL(b);
    urls.add(u);
    return u;
  };
  const letGo = (u: string | null | undefined): void => {
    if (u && urls.delete(u)) URL.revokeObjectURL(u);
  };

  /** One file's bytes, the password asked for when it has one (and asked again when wrong); null when it was not given. */
  const read = async (e: ArchiveEntry): Promise<Blob | null> => {
    for (let wrong = false; ; ) {
      try {
        return await archive.read(e, e.locked ? password : undefined);
      } catch (err) {
        if (!(err instanceof NeedsPassword || err instanceof WrongPassword)) throw err;
        if (closed) return null;
        wrong = err instanceof WrongPassword;
        const given = await promptDialog({ title: "This archive has a password", lines: [wrong ? "That password is not the one. Try again." : `Type the password of “${file.name}” to open what is in it.`], value: "", confirmLabel: "Open", secret: true });
        if (given === null) return null;
        password = given;
      }
    }
  };
  const failed = (e: ArchiveEntry, err: unknown): void => say(`“${e.name}” could not be opened: ${err instanceof Error ? err.message : String(err)}`);

  // ---- modes
  const paintMode = (): void => {
    for (const part of root.querySelectorAll<HTMLElement>("[data-in]")) part.hidden = !part.dataset["in"]!.split(" ").includes(mode);
    root.querySelector('[data-view-act="files"]')!.setAttribute("aria-pressed", String(mode !== "pages"));
    root.querySelector('[data-view-act="pages"]')?.setAttribute("aria-pressed", String(mode === "pages"));
  };
  const setMode = (m: Mode): void => {
    if (m !== "file") clearFile();
    mode = m;
    paintMode();
    if (m === "pages") void showPage(current);
    (m === "pages" ? pagesBox : m === "file" ? shown : list).focus({ preventScroll: true });
  };

  // ---- files
  const inFolder = (): ArchiveEntry[] => archive.entries.filter((e) => e.path.slice(0, e.path.length - e.name.length).replace(/\/$/, "") === folder);
  const under = (dir: string): ArchiveEntry[] => archive.entries.filter((e) => !e.dir && (dir === "" || e.path.startsWith(`${dir}/`)));
  const paintPath = (extra?: string): void => {
    const parts = folder ? folder.split("/") : [];
    const links = [`<button type="button" class="archive-crumb" data-folder="">${esc(file.name)}</button>`, ...parts.map((p, i) => `<button type="button" class="archive-crumb" data-folder="${esc(parts.slice(0, i + 1).join("/"))}">${esc(p)}</button>`)];
    if (extra) links.push(`<span class="archive-crumb">${esc(extra)}</span>`);
    crumbs.innerHTML = links.join(`<span class="archive-sep" aria-hidden="true">${ICONS.chevronRight}</span>`);
  };
  const rowHtml = (e: ArchiveEntry): string => {
    const icon = e.dir ? ICONS.folder : e.type.startsWith("image/") ? ICONS.image : ICONS.fileIcon;
    const facts = e.dir ? plural(under(e.path).length, "file") : [fmtBytes(e.size), e.unsupported ? `cannot be opened here: ${e.unsupported}` : ""].filter(Boolean).join(" · ");
    return `<div class="archive-row" role="option" data-path="${esc(e.path)}" aria-selected="${picked.has(e.path)}" title="${esc(e.path)}" data-testid="archive-row">
      <span class="archive-icon" aria-hidden="true">${icon}</span>
      <span class="archive-name">${esc(e.name)}</span>
      ${e.locked ? `<span class="archive-lock" title="It has a password" aria-label="It has a password">${ICONS.lockKeyhole}</span>` : ""}
      <span class="archive-facts">${esc(facts)}</span>
      <span class="archive-date">${e.date ? esc(e.date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })) : ""}</span>
    </div>`;
  };
  const paintSummary = (): void => {
    const files = archive.entries.filter((e) => !e.dir).length;
    summary.textContent = `${plural(files, "file")}${picked.size ? ` · ${picked.size} selected` : ""}${archive.locked ? " · with a password" : ""}`;
  };
  const paintFiles = (): void => {
    const rows = inFolder();
    list.innerHTML = rows.length ? rows.map(rowHtml).join("") : `<p class="archive-empty">${archive.entries.length ? "This folder is empty." : "This archive is empty."}</p>`;
    paintPath();
    paintSummary();
  };
  /** The selection shown on the rows as they are (drawn again, a double-click's second press would land on a new row and be no double-click). */
  const paintPicked = (): void => {
    for (const row of list.querySelectorAll<HTMLElement>(".archive-row")) row.setAttribute("aria-selected", String(picked.has(row.dataset["path"]!)));
    paintSummary();
  };
  const openFolder = (dir: string): void => {
    folder = dir;
    picked.clear();
    anchor = null;
    setMode("files");
    paintFiles();
  };
  const entryAt = (path: string): ArchiveEntry | undefined => archive.entries.find((e) => e.path === path);
  const pick = (path: string, how: "one" | "toggle" | "range"): void => {
    const rows = inFolder().map((e) => e.path);
    if (how === "one") {
      picked.clear();
      picked.add(path);
    } else if (how === "toggle") {
      if (!picked.delete(path)) picked.add(path);
    } else {
      const a = rows.indexOf(anchor ?? path), b = rows.indexOf(path);
      for (const p of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) picked.add(p);
    }
    if (how !== "range") anchor = path;
    paintPicked();
    list.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  // ---- one file shown inside it
  let fileUrl: string | null = null;
  const clearFile = (): void => {
    for (const m of shown.querySelectorAll("video, audio")) (m as HTMLMediaElement).pause();
    shown.replaceChildren();
    letGo(fileUrl);
    fileUrl = null;
  };
  const openEntry = async (e: ArchiveEntry): Promise<void> => {
    if (e.dir) return openFolder(e.path);
    const p = pages.indexOf(e);
    if (p >= 0) {
      current = p + 1;
      return setMode("pages");
    }
    if (e.unsupported) return say(`“${e.name}” cannot be opened here: it is packed with ${e.unsupported}.`);
    const kind = viewKindNamed(e.name);
    const playable = /^(video|audio)\//.test(e.type) || e.type.startsWith("image/");
    const text = describeFile(e.name, e.type).openIn === "text" && e.size <= MAX_TEXT;
    if (!playable && !text) {
      // Its own view (a PDF, a note, a 3D model, another archive) is the library's: it is imported first, then opened there.
      clearFile();
      mode = "file";
      paintMode();
      paintPath(e.name);
      shown.innerHTML = `<div class="archive-note"><p>${kind ? `“${esc(e.name)}” opens in its ${esc(kind.noun)} view once it is in the library.` : `No preview for “${esc(e.name)}” here (${esc(describeFile(e.name, e.type).category)}). Import it to keep it in the library.`}</p>
        ${kind ? `<button type="button" class="assets-btn is-primary" data-view-act="import-open" data-path="${esc(e.path)}" data-testid="archive-import-one">${ICONS.arrowDownToLine}<span>Import and open</span></button>` : `<button type="button" class="assets-btn is-primary" data-view-act="import-one" data-path="${esc(e.path)}" data-testid="archive-import-one">${ICONS.arrowDownToLine}<span>Import to the library</span></button>`}</div>`;
      return;
    }
    let blob: Blob | null;
    try {
      blob = await read(e);
    } catch (err) {
      return failed(e, err);
    }
    if (!blob || closed) return;
    clearFile();
    mode = "file";
    paintMode();
    paintPath(e.name);
    if (text) {
      const pre = document.createElement("pre");
      pre.className = "archive-text";
      pre.dataset["selectable"] = "";
      pre.textContent = await blob.text();
      shown.append(pre);
    } else {
      fileUrl = urlOf(blob);
      const media = document.createElement(e.type.startsWith("image/") ? "img" : e.type.startsWith("video/") ? "video" : "audio");
      media.className = "archive-media";
      if (media instanceof HTMLMediaElement) media.controls = true;
      if (media instanceof HTMLImageElement) media.alt = e.name;
      media.src = fileUrl;
      shown.append(media);
    }
    shown.focus({ preventScroll: true });
  };

  // ---- import into the library (the open folder, hidden in hidden mode: the place's own rule)
  const importEntries = async (entries: ArchiveEntry[], thenOpen = false): Promise<void> => {
    const files = entries.flatMap((e) => (e.dir ? under(e.path) : [e])).filter((e) => !e.unsupported);
    if (!files.length) return say("Nothing here to import.");
    if (files.length > MAX_IMPORT) return say(`At most ${MAX_IMPORT} files are imported from an archive at once: select fewer.`);
    const out: File[] = [];
    for (const e of files) {
      let blob: Blob | null;
      try {
        blob = await read(e);
      } catch (err) {
        failed(e, err);
        continue;
      }
      if (!blob) return; // (no password given: nothing is imported)
      out.push(new File([blob], e.name, { type: e.type, lastModified: e.date?.getTime() ?? Date.now() }));
    }
    // (an import asked for finishes, the view closed meanwhile or not: only what follows it in the view is left out)
    if (!out.length) return;
    const hashes = await place.importFiles(out);
    await place.refresh();
    if (closed) return;
    if (thenOpen && hashes[0]) return place.show(hashes[0]);
    say(`${plural(hashes.length, "file")} imported to the library.`);
  };

  // ---- pages
  let pageUrl: string | null = null;
  let turn = 0;
  const paintBar = (): void => {
    if (document.activeElement !== input) input.value = String(current);
    markBtn?.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === String(current))));
  };
  const fitImg = (): void => {
    const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
    const pad = parseFloat(getComputedStyle(pagesBox).paddingLeft) || 0;
    const k = zoom === "fit" ? Math.min((pagesBox.clientWidth - 2 * pad) / w, (pagesBox.clientHeight - 2 * pad) / h) : zoom;
    img.style.width = `${Math.max(1, w * k)}px`;
    img.style.height = `${Math.max(1, h * k)}px`;
  };
  const showPage = async (n: number): Promise<void> => {
    if (!count) return;
    current = Math.max(1, Math.min(count, n));
    paintBar();
    state = { ...state, at: String(current) };
    const t = ++turn;
    let blob: Blob | null;
    try {
      blob = await read(pages[current - 1]!);
    } catch (err) {
      return failed(pages[current - 1]!, err);
    }
    if (!blob || closed || t !== turn) return;
    const was = pageUrl;
    pageUrl = urlOf(blob);
    img.src = pageUrl;
    img.alt = `Page ${current} of ${count}: ${pages[current - 1]!.name}`;
    try {
      await img.decode();
    } catch {
      if (t === turn) say(`Page ${current} could not be shown: it is not a picture this browser reads.`);
    }
    letGo(was);
    if (t !== turn) return;
    fitImg();
    pagesBox.scrollTo(0, 0);
    img.dataset["page"] = String(current); // (shown: what a test waits for)
  };
  const setZoom = (dir: 1 | -1 | 0): void => {
    if (mode !== "pages") return;
    const now = img.naturalWidth ? img.getBoundingClientRect().width / img.naturalWidth : 1;
    zoom = dir === 0 ? "fit" : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, now * ZOOM_STEP ** dir));
    fitImg();
  };
  // A click on the page's left part goes back, elsewhere on: as a comic's page is turned.
  // view-state: (pages and zoom: what the view shows)
  pagesBox.addEventListener("click", (e) => {
    if (e.target !== img && e.target !== pagesBox) return;
    const r = pagesBox.getBoundingClientRect();
    void showPage(current + (e.clientX - r.left < r.width / 3 ? -1 : 1));
  });
  swipePages(pagesBox, (dir) => void showPage(current + dir));
  pagesBox.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    setZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  const mark = (): ViewState["marks"][number] => ({ at: String(current), label: `Page ${current}` });
  const changeMarks: MarksChange = (change) => {
    state = { ...state, marks: change(state.marks) };
    paintBar();
    keep();
    void place.refresh();
  };
  const toggleMark = async (): Promise<void> => {
    if (!count) return;
    state = toggledMark(state, mark(), Number);
    paintBar();
    keep();
    await place.refresh();
  };
  const card = (): CardLook =>
    count && img.naturalWidth && img.dataset["page"] === String(current)
      ? { preview: current === 1 ? "" : String(current), size: pageFit({ w: img.naturalWidth, h: img.naturalHeight }, ARCHIVE_CARD_EDGE) }
      : { preview: "", size: { w: FILE_CARD_W, h: FILE_CARD_H } };
  const showOnCard = (): void => {
    const c = card();
    place.setPreview?.(c.preview, c.size);
    say(`Page ${current} now shows on the card.`);
  };

  // ---- the bar, the list, the path
  // view-state: (pages and zoom: what the view shows)
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const crumb = t.closest<HTMLElement>("button.archive-crumb");
    if (crumb) return openFolder(crumb.dataset["folder"] ?? "");
    const b = t.closest<HTMLElement>("[data-view-act]");
    switch (b?.dataset["viewAct"]) {
      case "files": return mode === "files" ? undefined : mode === "file" ? openFolder(folder) : setMode("files");
      case "pages": return setMode("pages");
      case "prev": return void showPage(current - 1);
      case "next": return void showPage(current + 1);
      case "out": return setZoom(-1);
      case "in": return setZoom(1);
      case "fit": return setZoom(0);
      case "mark": return void toggleMark();
      case "card": return showOnCard();
      case "marks": {
        const items = state.marks.map((m) => ({ label: m.label, hint: `Bookmark, page ${m.at}`, icon: ICONS.bookmark, run: () => void showPage(Number(m.at)), more: markActions(m, changeMarks) }));
        return openMoreMenu(b!, items.length ? items : [{ label: "No bookmarks yet", hint: "Bookmark a page with the button beside this", icon: ICONS.bookmark, run: () => undefined }], "Go to");
      }
      case "import":
        return void importEntries(mode === "pages" ? [pages[current - 1]!] : picked.size ? [...picked].map(entryAt).filter((x): x is ArchiveEntry => !!x) : inFolder());
      case "import-one":
      case "import-open": {
        const one = entryAt(b!.dataset["path"] ?? "");
        return void (one && importEntries([one], b!.dataset["viewAct"] === "import-open"));
      }
    }
  });
  // view-state: (pages and zoom: what the view shows)
  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".archive-row");
    if (row) pick(row.dataset["path"]!, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "one");
  });
  // view-state: (pages and zoom: what the view shows)
  list.addEventListener("dblclick", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".archive-row");
    const entry = row && entryAt(row.dataset["path"]!);
    if (entry) void openEntry(entry);
  });
  // view-state: (pages and zoom: what the view shows)
  input.addEventListener("change", () => void showPage(Number(input.value) || current));
  input.addEventListener("blur", paintBar);
  const resized = new ResizeObserver(() => {
    if (mode === "pages" && zoom === "fit") fitImg();
  });
  resized.observe(pagesBox);

  /** The keys of the list: arrows move, Shift+arrows select, Enter opens, Backspace goes up a folder, Ctrl+A selects all. */
  const listKey = (e: KeyboardEvent): boolean => {
    const rows = inFolder();
    const at = rows.findIndex((r) => r.path === anchor);
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      for (const r of rows) picked.add(r.path);
      paintPicked();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) pick(next.path, e.shiftKey ? "range" : "one");
      return true;
    }
    if (e.key === "Enter") {
      const entry = rows[at];
      if (entry) void openEntry(entry);
      return !!entry;
    }
    if (e.key === "Backspace" && folder) {
      openFolder(folder.split("/").slice(0, -1).join("/"));
      return true;
    }
    return false;
  };

  paintFiles();
  paintMode();
  if (mode === "pages") void showPage(current);
  else list.focus({ preventScroll: true });
  return {
    hash,
    leave: async () => true,
    close: () => {
      closed = true;
      turn++;
      keep();
      resized.disconnect();
      clearFile();
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
      password = undefined;
      el.replaceChildren();
    },
    zoom: setZoom,
    key: (e) => {
      if (place.setPreview && mode === "pages" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {
        showOnCard();
        return true;
      }
      if ((e.target as HTMLElement).closest("input")) return false;
      if (mode === "files") return listKey(e);
      if (mode === "file") {
        if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          openFolder(folder);
          return true;
        }
        return false;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const turn = pageKey(e, pagesBox) || (e.key === " " ? (e.shiftKey ? -1 : 1) : 0);
      if (turn) void showPage(current + turn);
      else if (e.key === "Home") void showPage(1);
      else if (e.key === "End") void showPage(count);
      else return false;
      return true;
    },
    goTo: (at) => {
      setMode("pages");
      void showPage(Number(at));
    },
    toggleMark,
    changeMarks,
    here: () => (count ? mark() : null),
    card,
  };
}
