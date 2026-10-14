import type { Session, AssetPlace } from "../app/session";
import type { AssetLibrary } from "../assets/asset-library";
import { duplicateNotice } from "../assets/asset-library";
import type { AssetFolder, CatalogListing } from "../assets/asset-catalog";
import { folderPath, folderSubtree, meta } from "../assets/asset-catalog";
import { newObjectId } from "../doc/model";
import { ICONS } from "./icons";
import { esc, fmtBytes } from "./format";
import { confirmDialog } from "./confirm";
import { runExport } from "./archive-ui";

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
 *
 * Organization (ADR 0011): a sidebar scopes the grid to all assets,
 * favourites, unfiled assets, a folder (with its subfolders) or a tag. The
 * inspector edits an asset's favourite flag, tags and folders; an asset can
 * be in any number of folders without being copied.
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
      <input type="search" class="assets-search" data-testid="assets-search" placeholder="Search name, type or tag (#tag for exact)" aria-label="Search assets">
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
      <nav class="assets-side" data-testid="assets-side" aria-label="Library"></nav>
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
  const side = root.querySelector<HTMLElement>(".assets-side")!;

  let visible = false;
  let listing: CatalogListing | null = null;
  let selected: string | null = null;
  let places: AssetPlace[] = [];
  let generation = 0;
  /** Sidebar scope: "all", "favorites", "unfiled", "folder:<id>" or "tag:<lowercased tag>". */
  let scope = "all";
  /** Inline name input in the sidebar: a new folder (under `parent`) or a rename. */
  let naming: { kind: "new"; parent: string | null } | { kind: "rename"; id: string } | null = null;
  const thumbs = new Map<string, Promise<string>>();

  // ---- thumbnails: generated lazily from the stored original, kept in memory only
  const thumbFor = (hash: string): Promise<string> => {
    let p = thumbs.get(hash);
    if (!p) {
      p = (async () => {
        const rec = await assets.record(hash);
        if (!rec) throw new Error("missing");
        try {
          // Decoded straight at thumbnail size: a full-size decode of each of hundreds of originals is what made the grid heavy.
          const k = Math.min(1, THUMB_PX / Math.max(rec.pixelW, rec.pixelH));
          const bmp = await createImageBitmap(rec.blob, k < 1 ? { resizeWidth: Math.max(1, Math.round(rec.pixelW * k)), resizeHeight: Math.max(1, Math.round(rec.pixelH * k)), resizeQuality: "high" } : undefined);
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
    if (scope.startsWith("folder:") && !l.folders.some((f) => `folder:${f.id}` === scope)) scope = "all";
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
    // shortcut: a linear filter over the in-memory listing; add a tag/name index if libraries reach tens of thousands.
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const usage = usageSel.value as UsageFilter;
    const inFolders = scope.startsWith("folder:") ? folderSubtree(listing.folders, scope.slice(7)) : null;
    const inScope = (e: CatalogListing["entries"][number]): boolean => {
      const m = meta(e);
      if (scope === "favorites") return m.favorite;
      if (scope === "unfiled") return m.folderIds.length === 0;
      if (inFolders) return m.folderIds.some((id) => inFolders.has(id));
      if (scope.startsWith("tag:")) return m.tags.some((t) => t.toLowerCase() === scope.slice(4));
      return true;
    };
    const matches = (e: CatalogListing["entries"][number]): boolean => {
      const tags = meta(e).tags.map((t) => t.toLowerCase());
      return words.every((w) =>
        w.startsWith("#")
          ? tags.includes(w.slice(1))
          : e.name.toLowerCase().includes(w) || e.type.toLowerCase().includes(w) || e.hash.startsWith(w) || tags.some((t) => t.includes(w)),
      );
    };
    const rows = listing.entries.filter((e) => inScope(e) && matches(e) && (usage === "all" || (usage === "used" ? e.instances > 0 : e.instances === 0)));
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
    const usageAll = usageSel.value === "all" && !search.value.trim() && scope === "all";
    count.textContent = `${listing.entries.length}`;
    const cards = rows.map((e) => {
      const small = Math.max(e.pixelW, e.pixelH) < THUMB_PX ? " is-pixelated" : "";
      return `<button type="button" role="listitem" class="asset-card${e.present ? "" : " is-missing"}" data-testid="asset-card" data-hash="${e.hash}"
          aria-pressed="${selected === e.hash}" title="${esc(e.name || "Untitled")}">
        <span class="asset-thumb">${e.present ? `<img alt="" class="${small.trim()}" data-hash="${e.hash}">` : `<span class="asset-missing-label">Original missing</span>`}</span>
        <span class="asset-name">${meta(e).favorite ? `<span class="asset-star" aria-label="Favourite">★</span> ` : ""}${esc(e.name || "Untitled")}</span>
        ${meta(e).tags.length ? `<span class="asset-tags" data-testid="asset-card-tags">${meta(e).tags.map((t) => `#${esc(t)}`).join(" ")}</span>` : ""}
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
    renderSide();
    renderInspector();
    importBtn.disabled = session.readOnly;
  };

  const renderSide = (): void => {
    if (!listing) return;
    const entries = listing.entries;
    const tagCounts = new Map<string, { label: string; n: number }>();
    for (const e of entries) for (const t of meta(e).tags) {
      const k = t.toLowerCase();
      const c = tagCounts.get(k);
      if (c) c.n++;
      else tagCounts.set(k, { label: t, n: 1 });
    }
    const ro = session.readOnly;
    const item = (key: string, label: string, n: number, depth = 0, extra = ""): string =>
      `<li class="side-row" style="--depth:${depth}"><button type="button" class="side-item${scope === key ? " is-active" : ""}" data-scope="${esc(key)}" aria-current="${scope === key}">
        <span class="side-label">${label}</span><span class="side-n">${n}</span></button>${extra}</li>`;
    const nameInput = (value: string, label: string): string =>
      `<li class="side-row"><input class="side-name" data-testid="folder-name-input" value="${esc(value)}" aria-label="${label}" maxlength="120"></li>`;
    const subtreeCount = (id: string): number => {
      const ids = folderSubtree(listing!.folders, id);
      return entries.filter((e) => meta(e).folderIds.some((x) => ids.has(x))).length;
    };
    const tree = (parent: string | null, depth: number): string =>
      listing!.folders
        .filter((f) => f.parentId === parent)
        .map((f) =>
          naming?.kind === "rename" && naming.id === f.id
            ? nameInput(f.name, `New name for folder ${f.name}`)
            : item(
                `folder:${f.id}`,
                esc(f.name),
                subtreeCount(f.id),
                depth,
                ro ? "" : `<button type="button" class="side-mini" data-folder-action="new" data-id="${f.id}" aria-label="New folder inside ${esc(f.name)}" title="New subfolder">+</button>
                 <button type="button" class="side-mini" data-folder-action="rename" data-id="${f.id}" aria-label="Rename folder ${esc(f.name)}" title="Rename">Rename</button>
                 <button type="button" class="side-mini" data-folder-action="delete" data-id="${f.id}" aria-label="Delete folder ${esc(f.name)}" title="Delete folder">Delete</button>`,
              ) +
              (naming?.kind === "new" && naming.parent === f.id ? nameInput("", `Name of the new folder inside ${f.name}`) : "") +
              tree(f.id, depth + 1),
        )
        .join("");
    side.innerHTML = `
      <ul class="side-list">
        ${item("all", "All assets", entries.length)}
        ${item("favorites", "★ Favourites", entries.filter((e) => meta(e).favorite).length)}
        ${item("unfiled", "Unfiled", entries.filter((e) => meta(e).folderIds.length === 0).length)}
      </ul>
      <div class="side-head"><h2>Folders</h2>${ro ? "" : `<button type="button" class="side-mini" data-folder-action="new" data-id="" data-testid="folder-new" aria-label="New folder">+ Folder</button>`}</div>
      <ul class="side-list" data-testid="folder-tree">
        ${naming?.kind === "new" && naming.parent === null ? nameInput("", "Name of the new folder") : ""}
        ${tree(null, 0) || (naming ? "" : `<li class="side-empty">No folders yet.</li>`)}
      </ul>
      <div class="side-head"><h2>Tags</h2></div>
      <ul class="side-list" data-testid="tag-list">
        ${[...tagCounts].sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([k, c]) => item(`tag:${k}`, `#${esc(c.label)}`, c.n)).join("") || `<li class="side-empty">No tags yet.</li>`}
      </ul>`;
    const input = side.querySelector<HTMLInputElement>(".side-name");
    if (input) {
      input.focus();
      input.select();
    }
  };

  const renderInspector = (): void => {
    const e = listing?.entries.find((x) => x.hash === selected);
    const m = listing?.missing.find((x) => x.hash === selected);
    if (!e && !m) {
      inspector.hidden = true;
      return;
    }
    inspector.hidden = false;
    // Keep a half-typed tag (and its focus) when the inspector re-renders for the same asset.
    const typing = inspector.dataset["hash"] === selected ? inspector.querySelector<HTMLInputElement>(".tag-input") : null;
    const draft = typing?.value ?? "";
    const hadFocus = !!typing && document.activeElement === typing;
    inspector.dataset["hash"] = selected!;
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
      ${e ? organizeHtml(e) : ""}
      ${places.length ? `<h3>Where it is used</h3><ul class="asset-places" data-testid="asset-places">${placeRows}</ul>` : ""}
      <div class="asset-actions">
        ${e?.present ? `<button type="button" class="assets-btn is-primary" data-action="place" data-testid="asset-place"${ro}>${ICONS.mapPin}<span>Place on ${esc(where)}</span></button>` : ""}
        ${e?.present ? `<button type="button" class="assets-btn" data-action="export" data-testid="asset-export">Export as archive</button>` : ""}
        ${e ? `<button type="button" class="assets-btn is-danger" data-action="delete" data-testid="asset-delete"${instances > 0 ? " disabled" : ro}>Delete from library</button>
               ${instances > 0 ? `<p class="asset-note" data-testid="asset-delete-note">In use, so it cannot be deleted. Remove its ${instances} instance(s) from their canvases first.</p>` : ""}` : ""}
      </div>`;
    const prev = inspector.querySelector<HTMLImageElement>(".asset-preview img");
    if (prev) loadThumb(prev);
    const tagInput = inspector.querySelector<HTMLInputElement>(".tag-input");
    if (tagInput && draft) tagInput.value = draft;
    if (tagInput && hadFocus) tagInput.focus();
  };

  /** Favourite, tags and folders of an entry (inspector). */
  const organizeHtml = (e: CatalogListing["entries"][number]): string => {
    const m = meta(e);
    const dis = session.readOnly ? " disabled" : "";
    const folders = listing!.folders;
    const sorted = [...folders].sort((a, b) => folderPath(folders, a.id).join("/").localeCompare(folderPath(folders, b.id).join("/")));
    return `
      <div class="asset-organize">
        <button type="button" class="assets-btn" data-action="favorite" data-testid="asset-favorite" aria-pressed="${m.favorite}"${dis}>${m.favorite ? "★ Favourite" : "☆ Add to favourites"}</button>
        <h3>Tags</h3>
        <div class="tag-chips" data-testid="asset-tags">
          ${m.tags.map((t) => `<span class="tag-chip">#${esc(t)}<button type="button" data-action="untag" data-tag="${esc(t)}" aria-label="Remove tag ${esc(t)}"${dis}>×</button></span>`).join("")}
          <input class="tag-input" data-testid="asset-tag-input" placeholder="Add tag, press Enter" aria-label="Add a tag" maxlength="64"${dis}>
        </div>
        <h3>Folders</h3>
        ${
          sorted.length
            ? `<ul class="asset-folders" data-testid="asset-folders">${sorted
                .map(
                  (f: AssetFolder) =>
                    `<li><label><input type="checkbox" data-folder="${f.id}"${m.folderIds.includes(f.id) ? " checked" : ""}${dis}>${esc(folderPath(folders, f.id).join(" › "))}</label></li>`,
                )
                .join("")}</ul>`
            : `<p class="asset-note">No folders yet. Create one with “+ Folder” in the sidebar.</p>`
        }
      </div>`;
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
      case "favorite": {
        // The button shows the stored state it would change; set the opposite explicitly.
        const on = b.getAttribute("aria-pressed") !== "true";
        void session.organize((c) => c.updateMeta(hash, { favorite: on }));
        break;
      }
      case "untag": {
        const tag = b.dataset["tag"]!;
        void session.organize((c) => c.updateMeta(hash, { removeTags: [tag] }));
        break;
      }
      case "export":
        void runExport(session, { kind: "assets", hashes: [hash] });
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
  inspector.addEventListener("keydown", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("tag-input") || e.key !== "Enter" || !selected) return;
    e.preventDefault();
    const hash = selected;
    const add = input.value.split(",");
    input.value = ""; // consumed; the re-render must not restore it
    if (add.join("").trim()) void session.organize((c) => c.updateMeta(hash, { addTags: add })).then(() => inspector.querySelector<HTMLInputElement>(".tag-input")?.focus());
  });
  inspector.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const id = box.dataset["folder"];
    if (!id || !selected) return;
    const hash = selected;
    void session.organize((c) => c.updateMeta(hash, box.checked ? { addFolders: [id] } : { removeFolders: [id] }));
  });

  // ---- sidebar: scope, folders
  side.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset["scope"]) {
      scope = b.dataset["scope"];
      render();
      return;
    }
    const id = b.dataset["id"] ?? "";
    const f = listing?.folders.find((x) => x.id === id);
    switch (b.dataset["folderAction"]) {
      case "new":
        naming = { kind: "new", parent: id || null };
        renderSide();
        break;
      case "rename":
        naming = { kind: "rename", id };
        renderSide();
        break;
      case "delete":
        if (!f) break;
        void confirmDialog({
          title: `Delete folder “${f.name}”?`,
          lines: ["Its subfolders are deleted too. The assets in them stay in the library; they are only taken out of these folders."],
          confirmLabel: "Delete folder",
        }).then(async (ok) => {
          if (ok && (await session.organize((c) => c.deleteFolder(id))) && scope === `folder:${id}`) scope = "all";
        });
        break;
    }
  });
  side.addEventListener("keydown", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("side-name") || !naming) return;
    if (e.key === "Escape") {
      naming = null;
      renderSide();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const n = naming;
      const name = input.value;
      naming = null;
      if (n.kind === "new") {
        const id = newObjectId();
        void session.organize((c) => c.createFolder(name, n.parent, id)).then((ok) => {
          if (!ok) renderSide();
        });
      } else void session.organize((c) => c.renameFolder(n.id, name)).then(() => renderSide());
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
      const seen: Array<{ name: string; duplicate: "present" | "restored" }> = [];
      for (const f of files) {
        try {
          const { record, duplicate } = await assets.importFileDetailed(f);
          if (duplicate) seen.push({ name: record.name || f.name, duplicate });
          n++;
        } catch (e) {
          session.editor.message = `Could not import ${f.name || "file"}: ${(e as Error).message}`;
          session.editor.changed();
        }
      }
      if (n) {
        const notice = duplicateNotice(seen, n);
        session.editor.message = !notice ? `Imported ${n} file(s) into the library.` : seen.length === n ? notice : `${n - seen.length} new file(s) imported. ${notice}`;
        session.editor.changed();
      }
      await refresh();
    },
  };
  return view;
}
