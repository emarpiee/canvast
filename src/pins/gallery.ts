import type { Session } from "../app/session";
import type { AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import { LIBRARY_DRAG, libraryCardHtml } from "../ui/assets-view";
import { showMoreButton } from "../ui/show-more";
import { esc } from "../ui/format";
import { ICONS } from "../ui/icons";

/**
 * A Pins window's gallery (ADR 0208): the pictures of a folder of the library (and the folders in it), or all of them, as the library's own
 * cards (its markup and look, its thumbnails through `thumb`), dragged onto a canvas as a library card is. A double-click (or Enter) opens one
 * in the library's viewer, with its zoom and its slideshow: nothing here copies them.
 */
export interface GalleryDeps {
  session: Session;
  /** Hidden items show (hidden mode). */
  hidden(): boolean;
  /** A picture's address, as the library's cards show it. */
  thumb(hash: string): Promise<string>;
  /** Open an item in the library's viewer. */
  open(hash: string): void;
}

/** Cards drawn at a time (more by "Show more": a folder may hold thousands). */
const PAGE = 200;

export interface Listing {
  entries: CatalogEntry[];
  folders: AssetFolder[];
}

export function galleryPictures(l: Listing, folder: string | null, words: string, hidden: boolean): CatalogEntry[] {
  const under = new Set(folder ? [folder] : []);
  for (let grew = !!folder; grew; ) {
    grew = false;
    for (const f of l.folders) if (f.parentId !== null && under.has(f.parentId) && !under.has(f.id)) under.add(f.id), (grew = true);
  }
  const q = words.trim().toLowerCase();
  return l.entries
    .filter((e) => e.type.startsWith("image/") && e.state === "active" && (hidden || !e.hidden) && (!folder || e.folderIds?.some((f) => under.has(f))) && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => b.importedAt - a.importedAt);
}

export function mountGallery(host: HTMLElement, deps: GalleryDeps, folder: string | null): { search(words: string): void; refresh(): void; count(): number } {
  let words = "";
  let pages = 1;
  let shown: CatalogEntry[] = [];
  let io: IntersectionObserver | null = null;
  const draw = async (): Promise<void> => {
    const l = await deps.session.catalog?.list().catch(() => null);
    if (!l) return void (host.innerHTML = `<p class="adj-note">No library is open.</p>`);
    shown = galleryPictures(l, folder, words, deps.hidden());
    const upto = Math.min(shown.length, pages * PAGE);
    host.innerHTML = shown.length
      ? `<div class="assets-grid pins-grid" role="list">${shown
          .slice(0, upto)
          .map((e, i) => libraryCardHtml({ hash: e.hash, label: e.name, title: e.name, draggable: true, attrs: ` data-i="${i}"`, thumb: `<img alt="" draggable="false">`, info: `<span class="asset-info"><span class="asset-name">${esc(e.name)}</span></span>` }))
          .join("")}</div>${upto < shown.length ? showMoreButton({ hidden: shown.length - upto, attrs: "data-pins-more" }) : ""}`
      : `<p class="styles-hint">${ICONS.images}<span>${words ? "No picture has that name here." : `No pictures here${deps.hidden() ? "" : " (hidden ones show in hidden mode)"}.`}</span></p>`;
    // (each card's shape is its picture's, as in the library)
    host.querySelectorAll<HTMLElement>(".asset-cell").forEach((c) => {
      const e = shown[Number(c.dataset["i"])];
      if (e) c.style.setProperty("--ar", String(Math.max(0.2, Math.min(5, (e.pixelW || 1) / (e.pixelH || 1)))));
    });
    io?.disconnect();
    io = new IntersectionObserver((seen) => {
      for (const s of seen) {
        if (!s.isIntersecting) continue;
        io?.unobserve(s.target);
        const img = s.target.querySelector("img");
        const hash = (s.target.querySelector(".asset-card") as HTMLElement | null)?.dataset["hash"];
        if (img && hash) void deps.thumb(hash).then((u) => void (img.src = u)).catch(() => undefined);
      }
    }, { root: host.closest(".panel-body"), rootMargin: "200px" });
    host.querySelectorAll(".asset-cell").forEach((c) => io!.observe(c));
  };
  // view-state: (more of the folder's pictures drawn)
  host.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("[data-pins-more]")) return;
    pages++;
    void draw();
  });
  const hashAt = (t: EventTarget | null): string | undefined => (t as HTMLElement | null)?.closest<HTMLElement>(".asset-card")?.dataset["hash"];
  // commands: pins.view
  host.addEventListener("dblclick", (e) => {
    const h = hashAt(e.target);
    if (h) deps.open(h);
  });
  // commands: pins.view
  host.addEventListener("keydown", (e) => {
    const h = e.key === "Enter" ? hashAt(e.target) : undefined;
    if (!h) return;
    e.preventDefault();
    deps.open(h);
  });
  // view-state: (a card carries its picture as a library card does: a canvas, or a pinned one, places it where it is let go)
  host.addEventListener("dragstart", (e) => {
    const h = hashAt(e.target);
    if (!h || !e.dataTransfer) return;
    e.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify([h]));
    e.dataTransfer.effectAllowed = "copy";
  });
  void draw();
  return {
    search: (w) => {
      words = w;
      pages = 1;
      void draw();
    },
    refresh: () => void draw(),
    count: () => shown.length,
  };
}
