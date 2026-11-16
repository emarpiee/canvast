import { PHOTOCRAFT_FEATURES } from "./features";
import type { PhotoCraftFeatures } from "./features";
import { photoCraftPayload, photoCraftWasm } from "./payload";
import { PREFS_KEY, preparePrefs, themeIs, themeKeys, themeWanted } from "./prefs";

/**
 * PhotoCraft running in a frame of its own (same origin, no address: the page's security policy holds in it too, so it can reach no
 * network). Its released web build is started as it is; the few places where its page would use the browser are met here instead:
 *
 * | Its page does | canvast does |
 * | --- | --- |
 * | its file picker (an `<input type=file>` in a small card) | asks `host.pick` (the library chooser), puts the files in the input and presses its Ok |
 * | a download (`<a download>` of a blob) | hands the file to `host.saved` (the library, the canvas) |
 * | `fonts/manifest.txt` and the fonts it lists | serves the library's fonts |
 * | links, the window's own "Reload" | none (there is no network); Reload starts it again |
 * | a dropped file opens | `open(files)` drops them on it |
 *
 * Nothing of PhotoCraft's code is changed: what it runs, and the order it runs in, are the release's.
 */
export interface PhotoCraftHost {
  /** Its File > Open or Place asks for files (`accept` and `multiple` as on its file input). Null: cancelled. */
  pick(accept: string, multiple: boolean): Promise<File[] | null>;
  /** A file it saved or exported (a Blob of this page). */
  saved(name: string, file: Blob): void;
  /** Fonts for its font menus: their family and style as their own names give them. */
  fonts(): Promise<Array<{ family: string; style: string; ext: string; blob(): Promise<Blob | null> }>>;
  /** It stopped (out of memory, an error of its own) or could not start. */
  failed(message: string): void;
  /** Its "Reload" was pressed. */
  reload(): void;
}

export interface PhotoCraftFrame {
  readonly iframe: HTMLIFrameElement;
  /** Resolves once it runs (its loading message is gone); rejects when it cannot start. */
  readonly ready: Promise<void>;
  /** Opens files in it, each in a tab of its own. */
  open(files: readonly File[]): Promise<void>;
  /** Whether a document in it has changes not saved (asked as closing its page would, and nothing done in it since its last save). */
  unsaved(): boolean;
  /** Whether anything was pressed or typed in it since it started. */
  touched(): boolean;
  /** A paste that reached the app's page while PhotoCraft is shown: given to it, as if pasted in it. */
  paste(data: DataTransfer): void;
  /** Takes it away (what is not saved is lost: ask `unsaved` first). */
  destroy(): void;
}

/** What canvast adds to its page: the file picker's card is never seen while the library stands in for it. */
const BRIDGE_STYLE = "#rfd-overlay{display:none!important}";

/** A key the browser or the app window would act on as well. */
export function browserKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) return !["c", "v", "x", "control", "meta", "shift", "alt"].includes(k);
  if (/^f\d{1,2}$/.test(k)) return true;
  return e.altKey && (k === "arrowleft" || k === "arrowright" || k === "home");
}

type FrameWindow = Window & typeof globalThis & { __photocraftWasm?: Uint8Array; __photocraftFailed?: (m: string) => void };

/** Starts PhotoCraft in a new frame inside `container`. Throws when this build has no PhotoCraft. */
export function startPhotoCraft(container: HTMLElement, host: PhotoCraftHost, features: PhotoCraftFeatures = PHOTOCRAFT_FEATURES): PhotoCraftFrame {
  const payload = photoCraftPayload();
  if (!payload) throw new Error("PhotoCraft is not in this build.");
  let keys: ReturnType<typeof themeKeys> = [];
  let savedPrefs: string | null = null;
  try {
    const saved = (savedPrefs = localStorage.getItem(PREFS_KEY));
    keys = themeKeys(saved);
    localStorage.setItem(PREFS_KEY, preparePrefs(saved, features.menus, features.tools, keys));
  } catch {
    // (no storage: it starts with its defaults, and shows every menu item)
  }
  const iframe = document.createElement("iframe");
  iframe.title = "PhotoCraft";
  iframe.className = "photocraft-frame";
  iframe.setAttribute("allow", "fullscreen"); // (same origin: the clipboard is the page's)
  container.append(iframe);
  const win = iframe.contentWindow as FrameWindow;
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PhotoCraft</title><style>${payload.style}${features.bridge.openFromLibrary ? BRIDGE_STYLE : ""}</style></head><body>${payload.body}</body></html>`);
  doc.close();

  let destroyed = false;
  const stop = (message: string): void => {
    if (!destroyed) host.failed(message);
  };

  /** When something was last done in it, and when a file of it last came back (`unsaved`). */
  let lastInput = 0;
  let lastSaved = -1;

  // ---- downloads: its saved and exported files come back here
  const blobs = new Map<string, Blob>();
  const createUrl = win.URL.createObjectURL.bind(win.URL);
  win.URL.createObjectURL = (o: Blob | MediaSource): string => {
    const url = createUrl(o);
    if (o instanceof win.Blob) blobs.set(url, o);
    return url;
  };
  const revokeUrl = win.URL.revokeObjectURL.bind(win.URL);
  win.URL.revokeObjectURL = (url: string): void => {
    blobs.delete(url);
    revokeUrl(url);
  };
  const anchorClick = win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    const blob = this.download ? blobs.get(this.href) : undefined;
    if (!blob) return; // (a link: there is no network)
    if (!features.bridge.saveToLibrary) return void anchorClick.call(this);
    const name = this.download;
    lastSaved = performance.now();
    // (copied into this page at once: a Blob of the frame cannot be read once the frame is gone)
    void blob.arrayBuffer().then((buf) => host.saved(name, new Blob([new Uint8Array(buf)], { type: blob.type })), (e: unknown) => stop(`A file it saved could not be read: ${String(e)}`));
  };
  win.open = (): null => null;

  // ---- its file picker: the library chooser instead
  if (features.bridge.openFromLibrary) {
    const handled = new WeakSet<HTMLInputElement>();
    const pickFor = (input: HTMLInputElement): void => {
      if (handled.has(input)) return;
      handled.add(input);
      void host.pick(input.accept, input.multiple).then(async (files) => {
        if (destroyed) return;
        if (!files?.length) return void input.dispatchEvent(new win.Event("cancel"));
        const dt = new win.DataTransfer();
        for (const f of files) dt.items.add(new win.File([new win.Uint8Array(await f.arrayBuffer())], f.name, { type: f.type, lastModified: f.lastModified }));
        input.files = dt.files;
        input.dispatchEvent(new win.Event("change"));
      }, () => input.dispatchEvent(new win.Event("cancel")));
    };
    const inputClick = win.HTMLInputElement.prototype.click;
    win.HTMLInputElement.prototype.click = function (this: HTMLInputElement): void {
      if (this.type === "file") return pickFor(this);
      inputClick.call(this);
    };
    // (without a press just before, it shows its card and waits for its Ok instead of clicking the input)
    new win.MutationObserver(() => {
      const input = doc.querySelector<HTMLInputElement>("#rfd-overlay input[type=file]");
      if (input) pickFor(input);
    }).observe(doc.body, { childList: true });
  }

  // ---- fonts: the library's, as files next to its page
  let fontList: Awaited<ReturnType<PhotoCraftHost["fonts"]>> = [];
  const respond = (body: BodyInit | null, status = 200): Response => new win.Response(body, { status });
  win.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof win.URL ? input.href : (input as Request).url;
    if (!features.bridge.libraryFonts) return respond(null, 404);
    if (url === "fonts/manifest.txt") {
      fontList = await host.fonts().catch(() => []);
      return respond(fontList.map((f, i) => `${f.family.replace(/\|/g, " ")} | ${f.style.replace(/\|/g, " ")} | fonts/${i}.${f.ext}`).join("\n"));
    }
    const m = /^fonts\/(\d+)\.\w+$/.exec(url);
    const blob = m ? await fontList[Number(m[1])]?.blob() : null;
    return blob ? respond(new win.Uint8Array(await blob.arrayBuffer())) : respond(null, 404);
  };

  // ---- its keys are its own: a shortcut of it (Ctrl+= zooms its document) never also does what the browser or the app window does with it
  // (zoom the page, save it, print, find, go back). Seen last, after PhotoCraft has read it; copy, cut and paste keep the browser's way,
  // which its clipboard needs. (Keys a browser never lets a page have, Ctrl+W or Ctrl+T, stay the browser's.)
  win.addEventListener("keydown", (e) => {
    if (browserKey(e)) e.preventDefault();
  });
  // ---- a picture pasted: its page takes only words from a paste (its web build reads no picture from the clipboard), so a picture
  // pasted is dropped on it, as a file dragged in: on the document open, a layer; with none open, a document of its own. Words go on.
  win.addEventListener("paste", (e) => {
    const pictures = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!pictures.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void dropOn(pictures, win.innerWidth / 2, win.innerHeight / 2);
  }, true);

  // ---- strokes as smooth as on a desktop: it draws from every pointer move it is given, and a browser gives one a frame. The moves
  // the browser kept in between (a pointer event's coalesced ones) are given too, as the moves its page reads, before the last one.
  win.addEventListener("pointermove", (e) => {
    if (!e.buttons || typeof e.getCoalescedEvents !== "function") return;
    const between = e.getCoalescedEvents().slice(0, -1);
    for (const c of between) doc.dispatchEvent(new win.MouseEvent("mousemove", { clientX: c.clientX, clientY: c.clientY, screenX: c.screenX, screenY: c.screenY, buttons: e.buttons, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true }));
  }, true);

  // (its page cannot know a download was kept, so a document stays "not saved" after its Save: canvast knows when a file of it came
  // back, and whether anything was done in it since; nothing is done in it without a press or a key)
  // (the keys canvast presses itself, for its theme, are not something done in it)
  let pressing = false;
  for (const kind of ["pointerdown", "keydown"]) win.addEventListener(kind, () => void (pressing || (lastInput = performance.now())), true);

  // ---- its own messages: running, stopped, could not start
  // view-state: (a click in PhotoCraft's frame: its own)
  doc.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a) return;
    e.preventDefault();
    if (a.getAttribute("href") === "") host.reload(); // (its "Reload")
  }, true);
  let started!: () => void;
  let notStarted!: (e: Error) => void;
  const ready = new Promise<void>((ok, no) => { started = ok; notStarted = no; });
  ready.catch(() => undefined);
  // The theme chosen, by its own Window › Theme commands, once it runs (prefs.ts `themeKeys`). Its runtime takes keys only while its canvas
  // has the focus, which the page around it may still hold: the frame and its canvas are given it, the keys pressed, and pressed again
  // until what it saves says the theme is the one chosen (every half second, for 15 seconds at most).
  const wanted = themeWanted(savedPrefs);
  const pressKeys = (): void => {
    const canvas = doc.getElementById("photocraft_canvas");
    iframe.focus();
    canvas?.focus();
    pressing = true;
    for (const k of keys) for (const type of ["keydown", "keyup"]) (canvas ?? doc).dispatchEvent(new win.KeyboardEvent(type, { key: k.key, code: k.key, bubbles: true, cancelable: true }));
    pressing = false;
  };
  void ready.then(async () => {
    if (!keys.length) return;
    for (let i = 0; i < 30 && !destroyed; i++) {
      pressKeys();
      await new Promise((ok) => setTimeout(ok, 500));
      if (themeIs(localStorage.getItem(PREFS_KEY), wanted)) return;
    }
  }, () => undefined);
  const watch = new win.MutationObserver(() => {
    const loading = doc.getElementById("photocraft_loading");
    if (!loading) started();
    else if (/failed to start/i.test(loading.textContent ?? "")) notStarted(new Error(loading.textContent!.trim()));
    const stopped = doc.getElementById("photocraft_stopped");
    if (stopped && !stopped.hidden) stop(stopped.textContent?.replace(/\s+/g, " ").trim() ?? "PhotoCraft stopped.");
  });
  watch.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  win.__photocraftFailed = (m: string): void => notStarted(new Error(m));

  // ---- start it: its WebAssembly, unpacked in its frame, then its code as one module
  void photoCraftWasm(payload, win).then((wasm) => {
    if (destroyed) return;
    win.__photocraftWasm = wasm;
    const s = doc.createElement("script");
    s.type = "module";
    s.textContent = `${payload.glue}\ntry { await globalThis.__photocraftInit({ module_or_path: globalThis.__photocraftWasm }); } catch (e) { globalThis.__photocraftFailed?.(String(e && e.message || e)); } finally { delete globalThis.__photocraftWasm; }`;
    doc.body.append(s);
  }, (e: unknown) => notStarted(new Error(`Its files could not be unpacked: ${String(e)}`)));

  const canvas = (): HTMLCanvasElement | null => doc.getElementById("photocraft_canvas") as HTMLCanvasElement | null;
  /** Files dropped on it at (x, y) of its page, as if dragged there: on a document's canvas placed as layers, elsewhere opened. */
  async function dropOn(files: readonly File[], x: number, y: number): Promise<void> {
    const target = canvas();
    if (!target || !files.length) return;
    const dt = new win.DataTransfer();
    for (const f of files) dt.items.add(new win.File([new win.Uint8Array(await f.arrayBuffer())], f.name, { type: f.type, lastModified: f.lastModified }));
    for (const type of ["dragover", "drop"]) target.dispatchEvent(new win.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    iframe.focus();
  }
  return {
    iframe,
    ready,
    async open(files) {
      await ready;
      // (dropped away from a document's canvas, a file opens in a tab of its own; on it, it would be placed as a layer)
      await dropOn(files, 1, 1);
    },
    touched: () => lastInput > 0,
    paste(data) {
      const dt = new win.DataTransfer();
      for (const type of ["text/plain", "text/html", "text/uri-list"]) {
        const v = data.getData(type);
        if (v) dt.setData(type, v);
      }
      for (const f of data.files) dt.items.add(new win.File([f], f.name, { type: f.type, lastModified: f.lastModified }));
      iframe.focus();
      (doc.activeElement ?? doc.body).dispatchEvent(new win.ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    unsaved() {
      if (destroyed) return false;
      // (its page asks before closing when a document has unsaved changes: asked the same way; not when nothing was done since it saved)
      return !win.dispatchEvent(new win.Event("beforeunload", { cancelable: true })) && lastInput > lastSaved;
    },
    destroy() {
      destroyed = true;
      watch.disconnect();
      blobs.clear();
      iframe.remove();
    },
  };
}
