import { PHOTOCRAFT_FEATURES } from "./features";
import type { PhotoCraftFeatures } from "./features";
import { photoCraftPayload, photoCraftWasm } from "./payload";
import { PREFS_KEY, preparePrefs } from "./prefs";

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
  /** Whether a document in it has changes not saved (asked as closing its page would). */
  unsaved(): boolean;
  /** Takes it away (what is not saved is lost: ask `unsaved` first). */
  destroy(): void;
}

/** What canvast adds to its page: the file picker's card is never seen while the library stands in for it. */
const BRIDGE_STYLE = "#rfd-overlay{display:none!important}";

type FrameWindow = Window & typeof globalThis & { __photocraftWasm?: Uint8Array; __photocraftFailed?: (m: string) => void };

/** Starts PhotoCraft in a new frame inside `container`. Throws when this build has no PhotoCraft. */
export function startPhotoCraft(container: HTMLElement, host: PhotoCraftHost, features: PhotoCraftFeatures = PHOTOCRAFT_FEATURES): PhotoCraftFrame {
  const payload = photoCraftPayload();
  if (!payload) throw new Error("PhotoCraft is not in this build.");
  try {
    localStorage.setItem(PREFS_KEY, preparePrefs(localStorage.getItem(PREFS_KEY), features.menus, features.tools));
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

  // ---- its own messages: running, stopped, could not start
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
  return {
    iframe,
    ready,
    async open(files) {
      await ready;
      const target = canvas();
      if (!target || !files.length) return;
      const dt = new win.DataTransfer();
      for (const f of files) dt.items.add(new win.File([new win.Uint8Array(await f.arrayBuffer())], f.name, { type: f.type, lastModified: f.lastModified }));
      // (dropped away from a document's canvas, a file opens in a tab of its own; on it, it would be placed as a layer)
      target.dispatchEvent(new win.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 1, clientY: 1 }));
      iframe.focus();
    },
    unsaved() {
      if (destroyed) return false;
      // (its page asks before closing when a document has unsaved changes: asked the same way)
      return !win.dispatchEvent(new win.Event("beforeunload", { cancelable: true }));
    },
    destroy() {
      destroyed = true;
      watch.disconnect();
      blobs.clear();
      iframe.remove();
    },
  };
}
