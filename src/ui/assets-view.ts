import type { Session, AssetPlace } from "../app/session";
import type { AssetLibrary } from "../assets/asset-library";
import type { CatalogListing } from "../assets/asset-catalog";
import { ICONS } from "./icons";
import { esc, fmtBytes } from "./format";
import { confirmDialog } from "./confirm";

/**
 * Assets view: the full-window library of the workspace's shared originals
 * (ADR 0007). It reads the one authoritative catalog. Nothing here copies
 * bytes: placing an asset creates a new canvas instance that references the
 * same original.
 *
 * Shows each asset's identity, usage (instances and canvases), storage size
 * and whether its original is stored; lists every canvas where it is used
 * with a Show action that opens that canvas, selects the instances and frames
 * them; places new instances; and deletes unused assets from the library.
 * Originals referenced by instances whose bytes are gone are listed as
 * missing, with how to restore them.
 */
export interface AssetsView {
  show(): void;
  hide(): void;
  /** Import files into the library only (no placement). */
  importFiles(files: File[]): Promise<void>;
}

type UsageFilter = "all" | "used" | "unused";
type SortKey = "newest" | "name" | "size" | "uses";

const THUMB_PX = 256;

export function mountAssetsView(root: HTMLElement, session: Session, assets: AssetLibrary, showCanvas: () => void): AssetsView {
  root.innerHTML = `
    <div class="assets-bar" role="toolbar" aria-label="Asset library">
      <h1 class="assets-title">Assets <span class="assets-count" data-testid="assets-count"></span></h1>
      <input type="search" class="assets-search" data-testid="assets-search" placeholder="Search name or type" aria-label="Search assets">
      <select data-testid="assets-usage" aria-label="Show">
        <option value="all">All assets</option><option value="used">In use</option><option value="unused">Unused</option>
      </select>
      <select data-testid="assets-sort" aria-label="Sort by">
        <option value="newest">Newest first</option><option value="name">Name</option><option value="size">Largest first</option><option value="uses">Most used</option>
      </select>
      <label class="assets-size">Size <input type="range" min="96" max="240" step="24" value="144" aria-label="Thumbnail size"></label>
      <button type="button" class="assets-btn" data-action="import" data-testid="assets-import">${ICONS.upload}<span>Import</span></button>
      <input type="file" accept="image/*" multiple hidden data-testid="assets-import-input">
    </div>
    <p class="assets-status" role="status" data-testid="assets-status"></p>
    <div class="assets-body">
      <div class="assets-scroll"><div class="assets-grid" role="list" data-testid="assets-grid"></div></div>
      <aside class="asset-inspector" data-testid="asset-inspector" aria-label="Asset details" hidden></aside>
    </div>`;
  const grid = root.querySelector<HTMLElement>(".assets-grid")!;
  const inspector = root.querySelector<HTMLElement>(".asset-inspector")!;
  const status = root.querySelector<HTMLElement>(".assets-status")!;
  const count = root.querySelector<HTMLElement>(".assets-count")!;
  const search = root.querySelector<HTMLInputElement>(".assets-search")!;
  const usageSel = root.querySelector<HTMLSelectElement>('[data-testid="assets-usage"]')!;
  const sortSel = root.querySelector<HTMLSelectElement>('[data-testid="assets-sort"]')!;
  const sizeInput = root.querySelector<HTMLInputElement>(".assets-size input")!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-testid="assets-import-input"]')!;
  const importBtn = root.querySelector<HTMLButtonElement>('[data-action="import"]')!;

  let visible = false;
  let listing: CatalogListing | null = null;
  let selected: string | null = null;
  let places: AssetPlace[] = [];
  let generation = 0;
  const thumbs = new Map<string, Promise<string>>();

  // ---- thumbnails: generated lazily from the stored original, kept in memory only
  const thumbFor = (hash: string): Promise<string> => {
    let p = thumbs.get(hash);
    if (!p) {
      p = (async () => {
        const rec = await assets.record(hash);
        if (!rec) throw new Error("missing");
        try {
          const bmp = await createImageBitmap(rec.blob);
          const s = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(bmp.width * s));
          c.height = Math.max(1, Math.round(bmp.height * s));
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(bmp, 0, 0, c.width, c.height);
          bmp.close();
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
          if (blob) return URL.createObjectURL(blob);
        } catch {
          // fall through to the original (e.g. a format createImageBitmap rejects)
        }
        return URL.createObjectURL(rec.blob);
      })();
      thumbs.set(hash, p);
    }
    return p;
  };
  const loadThumb = (img: HTMLImageElement): void => {
    const hash = img.dataset["hash"]!;
    thumbFor(hash).then(
      (url) => {
        img.src = url;
      },
      () => img.classList.add("is-broken"),
    );
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      loadThumb(e.target as HTMLImageElement);
    }
  });
  const dropStaleThumbs = (): void => {
    const live = new Set(listing?.entries.map((e) => e.hash));
    for (const [hash, p] of thumbs) {
      if (live.has(hash)) continue;
      thumbs.delete(hash);
      void p.then((url) => URL.revokeObjectURL(url), () => undefined);
    }
  };

  // ---- data
  const refresh = async (): Promise<void> => {
    if (!visible) return;
    const gen = ++generation;
    if (!session.catalog) {
      grid.innerHTML = `<p class="assets-empty">Storage is unavailable, so there is no asset library in this tab.</p>`;
      return;
    }
    await session.persistence.flush(); // usage reflects every edit made so far
    const l = await session.catalog.list();
    if (gen !== generation) return;
    listing = l;
    dropStaleThumbs();
    if (selected && !l.entries.some((e) => e.hash === selected) && !l.missing.some((m) => m.hash === selected)) selected = null;
    places = selected ? await session.assetPlaces(selected) : [];
    if (gen !== generation) return;
    render();
  };

  const kindOf = (type: string): string => (type.split("/")[1] ?? type).toUpperCase();
  const usesText = (instances: number, canvases: number): string =>
    instances === 0 ? "Unused" : `${instances} use${instances === 1 ? "" : "s"} · ${canvases} canvas${canvases === 1 ? "" : "es"}`;

  const filtered = (): CatalogListing["entries"] => {
    if (!listing) return [];
    const q = search.value.trim().toLowerCase();
    const usage = usageSel.value as UsageFilter;
    const rows = listing.entries.filter(
      (e) =>
        (!q || e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || e.hash.startsWith(q)) &&
        (usage === "all" || (usage === "used" ? e.instances > 0 : e.instances === 0)),
    );
    const key = sortSel.value as SortKey;
    const cmp: Record<SortKey, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
      newest: (a, b) => b.importedAt - a.importedAt,
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.size - a.size,
      uses: (a, b) => b.instances - a.instances,
    };
    return rows.sort((a, b) => cmp[key](a, b) || (a.hash < b.hash ? -1 : 1));
  };

  // ---- rendering
  const render = (): void => {
    if (!listing) return;
    const rows = filtered();
    const usageAll = usageSel.value === "all" && !search.value.trim();
    count.textContent = `${listing.entries.length}`;
    const cards = rows.map((e) => {
      const small = Math.max(e.pixelW, e.pixelH) < THUMB_PX ? " is-pixelated" : "";
      return `<button type="button" role="listitem" class="asset-card${e.present ? "" : " is-missing"}" data-testid="asset-card" data-hash="${e.hash}"
          aria-pressed="${selected === e.hash}" title="${esc(e.name || "Untitled")}">
        <span class="asset-thumb">${e.present ? `<img alt="" class="${small.trim()}" data-hash="${e.hash}">` : `<span class="asset-missing-label">Original missing</span>`}</span>
        <span class="asset-name">${esc(e.name || "Untitled")}</span>
        <span class="asset-meta">${e.pixelW}×${e.pixelH} · ${esc(kindOf(e.type))} · ${fmtBytes(e.size)}</span>
        <span class="asset-uses" data-testid="asset-uses">${usesText(e.instances, e.canvases)}</span>
      </button>`;
    });
    const missing = usageAll
      ? listing.missing.map(
          (m) => `<button type="button" role="listitem" class="asset-card is-missing" data-testid="asset-missing" data-hash="${m.hash}" aria-pressed="${selected === m.hash}">
            <span class="asset-thumb"><span class="asset-missing-label">Original missing</span></span>
            <span class="asset-name">Missing original</span>
            <span class="asset-meta">${m.hash.slice(0, 12)}…</span>
            <span class="asset-uses" data-testid="asset-uses">${usesText(m.instances, m.canvases)}</span>
          </button>`,
        )
      : [];
    grid.innerHTML = cards.length + missing.length
      ? cards.join("") + missing.join("")
      : listing.entries.length
        ? `<p class="assets-empty">No assets match.</p>`
        : `<p class="assets-empty">No assets yet. Import images here, or drop them on a canvas.</p>`;
    grid.style.setProperty("--thumb", `${sizeInput.value}px`);
    for (const img of grid.querySelectorAll<HTMLImageElement>("img[data-hash]")) io.observe(img);
    renderInspector();
    importBtn.disabled = session.readOnly;
  };

  const renderInspector = (): void => {
    const e = listing?.entries.find((x) => x.hash === selected);
    const m = listing?.missing.find((x) => x.hash === selected);
    if (!e && !m) {
      inspector.hidden = true;
      return;
    }
    inspector.hidden = false;
    const instances = e?.instances ?? m!.instances;
    const where = session.current && session.tree ? crumbOf(session.current.canvasId) : "the open canvas";
    const placeRows = places
      .map(
        (p) => `<li><span>${esc(p.boardName)} › ${esc(p.canvasName)} <span class="asset-place-n">${p.ids.length}</span></span>
          <button type="button" class="assets-btn" data-action="show" data-canvas="${p.canvasId}" data-testid="asset-show"
            aria-label="Show ${p.ids.length} instance(s) on ${esc(p.boardName)} › ${esc(p.canvasName)}">${ICONS.locate}<span>Show</span></button></li>`,
      )
      .join("");
    const ro = session.readOnly ? " disabled title=\"Read-only: another tab is editing\"" : "";
    inspector.innerHTML = `
      <div class="asset-insp-head">
        <h2>${esc(e ? e.name || "Untitled" : "Missing original")}</h2>
        <button type="button" class="assets-icon" data-action="close" aria-label="Close details">${ICONS.x}</button>
      </div>
      ${e?.present ? `<div class="asset-preview"><img alt="Preview of ${esc(e.name)}" data-hash="${e.hash}" class="${Math.max(e.pixelW, e.pixelH) < THUMB_PX ? "is-pixelated" : ""}"></div>` : ""}
      <dl>
        ${e ? `<dt>Type</dt><dd>${esc(e.type)}</dd><dt>Pixels</dt><dd>${e.pixelW} × ${e.pixelH}</dd><dt>Stored size</dt><dd>${fmtBytes(e.size)} (one copy)</dd>
               <dt>Imported</dt><dd>${new Date(e.importedAt).toLocaleString()}</dd>` : ""}
        <dt>Content hash</dt><dd class="asset-hash" title="${selected}">${selected!.slice(0, 16)}…</dd>
        <dt>Used</dt><dd data-testid="asset-usage">${usesText(instances, e?.canvases ?? m!.canvases)}</dd>
      </dl>
      ${e && !e.present ? `<p class="asset-warn">The original file is missing from storage. Import the same file again to restore it everywhere.</p>` : ""}
      ${m ? `<p class="asset-warn" data-testid="asset-missing-help">Instances use an original that is not stored. Import the same file again to restore all ${instances} of them.</p>` : ""}
      ${places.length ? `<h3>Where it is used</h3><ul class="asset-places" data-testid="asset-places">${placeRows}</ul>` : ""}
      <div class="asset-actions">
        ${e?.present ? `<button type="button" class="assets-btn is-primary" data-action="place" data-testid="asset-place"${ro}>${ICONS.mapPin}<span>Place on ${esc(where)}</span></button>` : ""}
        ${e ? `<button type="button" class="assets-btn is-danger" data-action="delete" data-testid="asset-delete"${instances > 0 ? " disabled" : ro}>Delete from library</button>
               ${instances > 0 ? `<p class="asset-note" data-testid="asset-delete-note">In use, so it cannot be deleted. Remove its ${instances} instance(s) from their canvases first.</p>` : ""}` : ""}
      </div>`;
    const prev = inspector.querySelector<HTMLImageElement>(".asset-preview img");
    if (prev) loadThumb(prev);
  };

  const crumbOf = (canvasId: string): string => {
    for (const b of session.tree?.boards ?? []) {
      const c = b.canvases.find((x) => x.id === canvasId);
      if (c) return `${b.board.name} › ${c.name}`;
    }
    return "the open canvas";
  };

  const select = async (hash: string | null): Promise<void> => {
    selected = hash;
    places = hash ? await session.assetPlaces(hash) : [];
    render();
  };

  // ---- events
  grid.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".asset-card");
    if (card) void select(card.dataset["hash"]!); // Escape or the close button clears the selection
  });
  inspector.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || !selected) return;
    const hash = selected;
    switch (b.dataset["action"]) {
      case "close":
        void select(null);
        break;
      case "show": {
        const p = places.find((x) => x.canvasId === b.dataset["canvas"]);
        if (p) {
          showCanvas();
          void session.reveal(p.canvasId, p.ids);
        }
        break;
      }
      case "place":
        showCanvas();
        void session.placeAsset(hash);
        break;
      case "delete": {
        const e = listing?.entries.find((x) => x.hash === hash);
        void confirmDialog({
          title: `Delete “${e?.name || "Untitled"}” from the library?`,
          lines: [`Its original (${fmtBytes(e?.size ?? 0)}) is erased from this browser's storage once nothing can use it any more.`],
          confirmLabel: "Delete asset",
        }).then(async (ok) => {
          if (ok) await session.deleteAsset(hash);
          await refresh();
          search.focus();
        });
        break;
      }
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected) {
      void select(null);
      e.stopPropagation();
    }
  });
  for (const el of [search, usageSel, sortSel]) el.addEventListener("input", render);
  sizeInput.addEventListener("input", () => grid.style.setProperty("--thumb", `${sizeInput.value}px`));
  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    void view.importFiles(files);
  });

  // Messages from storage operations (delete, refusals, errors) are shown here while the view is open.
  session.editor.subscribe(() => {
    if (!visible || !session.editor.message) return;
    status.textContent = session.editor.message;
    session.editor.message = "";
  });
  session.subscribeAssets(() => void refresh());
  session.subscribe(() => void refresh()); // tree renamed, role changed

  const view: AssetsView = {
    show() {
      visible = true;
      root.hidden = false;
      status.textContent = "";
      void refresh();
      search.focus();
    },
    hide() {
      visible = false;
      root.hidden = true;
    },
    async importFiles(files) {
      if (session.editor.blockEdit()) return;
      let n = 0;
      for (const f of files) {
        try {
          await assets.importFile(f);
          n++;
        } catch (e) {
          session.editor.message = `Could not import ${f.name || "file"}: ${(e as Error).message}`;
          session.editor.changed();
        }
      }
      if (n) {
        session.editor.message = `Imported ${n} file(s) into the library.`;
        session.editor.changed();
      }
      await refresh();
    },
  };
  return view;
}
