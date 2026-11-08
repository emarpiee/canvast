/**
 * The Trash in the library: this workspace's `.trash/` for the mode, never the system's. It is a state of the library view, as the viewer is: the library's own cards in place
 * of its grid, and its details panel for what is picked, with Restore and Delete for good.
 */
import { showMoreButton } from "./show-more";
import { plural } from "../doc/plural";
import type { TrashFile } from "../storage/store";
import { confirmDialog } from "./confirm";
import { bindContextMenu } from "./context-menu";
import { esc, fmtBytes } from "./format";
import { ICONS } from "./icons";
import type { MenuItem } from "./more-menu";

export interface TrashDeps {
  box: HTMLElement;
  details: HTMLElement;
  list(): Promise<TrashFile[]>;
  read(path: string): Promise<Blob | null>;
  restore(path: string): Promise<"restored" | "already" | "shut">;
  erase(path: string): Promise<void>;
  say(text: string): void;
  /** How many files the trash holds and their size: its count in the sidebar and the status bar. */
  counted(n: number, bytes: number): void;
  readOnly(): boolean;
  /** The library's own tile for a file with no picture. */
  tile(name: string): string;
  /** The library's own picture of a file (its thumbnail, made as the library makes one: a note's page, a PDF's, a video's frame…), or null. */
  picture(path: string, name: string): Promise<Blob | null>;
}

export interface TrashView {
  /** Show the files whose names hold what else the search box says. */
  show(typed: string): Promise<void>;
  /** Read the folder again. */
  refresh(): Promise<void>;
  drawDetails(): void;
  selectAll(): void;
  clear(): void;
}

/** The search box's word for this state. */
export const TRASH_WORD = /(^|\s)is:trash(?=\s|$)/i;
/** How many cards are drawn at once: a long trash shows more on asking. */
const PAGE = 300;
const PICTURE = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i;

export function mountTrashView(deps: TrashDeps): TrashView {
  const { box, details } = deps;
  let files: TrashFile[] = [];
  let words: string[] = [];
  let shown = PAGE;
  const picked = new Set<string>();
  let anchor: string | null = null;
  const urls = new Map<string, string>();
  const fit = (): TrashFile[] => files.filter((f) => words.every((w) => f.name.toLowerCase().includes(w)));
  /** A file's picture as the library draws it, made once (as it scrolls into view): every kind the library shows, not only pictures. */
  const urlOf = async (path: string, name: string): Promise<string | null> => {
    if (urls.has(path)) return urls.get(path)!;
    const blob = await deps.picture(path, name).catch(() => null);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(path, url);
    return url;
  };
  const seeing = new IntersectionObserver((seen) => {
    for (const s of seen) {
      if (!s.isIntersecting) continue;
      seeing.unobserve(s.target);
      const slot = s.target as HTMLElement;
      void urlOf(slot.dataset["path"]!, slot.dataset["name"]!).then((url) => {
        if (!url || !slot.isConnected) return;
        // (the card takes the picture's shape, as the library's do; the tile stays for what has none)
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        img.addEventListener("load", () => slot.closest<HTMLElement>(".asset-cell")?.style.setProperty("--ar", String(img.naturalWidth / Math.max(1, img.naturalHeight) || 1)), { once: true });
        img.src = url;
        slot.replaceChildren(img);
      });
    }
  }, { root: box, rootMargin: "400px" });

  const cardHtml = (f: TrashFile): string => `<div class="asset-cell" role="listitem" style="--ar: ${PICTURE.test(f.name) ? 1.33 : 1}">
      <button type="button" class="asset-card" data-testid="trash-card" data-path="${esc(f.path)}" aria-pressed="${picked.has(f.path)}" aria-label="${esc(f.name)}, ${fmtBytes(f.size)}" title="${esc(f.name)}">
        <span class="asset-thumb thumb-slot" data-path="${esc(f.path)}" data-name="${esc(f.name)}">${deps.tile(f.name)}</span>
        <span class="asset-info"><span class="asset-name">${esc(f.name)}</span><span class="asset-size">${fmtBytes(f.size)}</span></span>
      </button></div>`;
  const draw = (): void => {
    seeing.disconnect();
    const list = fit();
    box.innerHTML = list.length
      ? `<div class="assets-grid" role="list" data-testid="trash-grid">${list.slice(0, shown).map(cardHtml).join("")}</div>${list.length > shown ? showMoreButton({ attrs: 'data-trash="more"', label: `Show ${plural(Math.min(PAGE, list.length - shown), "more file")}` }) : ""}`
      : `<p class="asset-note" data-testid="trash-empty">${files.length ? "No file in the trash has that name." : "The trash is empty. It lists this workspace's .trash folder, not your system's trash."}</p>`;
    for (const slot of box.querySelectorAll(".thumb-slot[data-path]")) seeing.observe(slot);
    drawDetails();
  };
  const showPicks = (): void => {
    for (const c of box.querySelectorAll<HTMLElement>("[data-testid='trash-card']")) c.setAttribute("aria-pressed", String(picked.has(c.dataset["path"]!)));
    drawDetails();
  };
  const actionsHtml = (): string => {
    const dis = deps.readOnly() ? " disabled" : "";
    return `<div class="trash-actions">
      <button type="button" class="assets-btn" data-trash="restore" data-testid="trash-restore"${dis}>${ICONS.archiveRestore}<span>Restore</span></button>
      <button type="button" class="assets-btn is-danger" data-trash="erase" data-testid="trash-erase"${dis}>${ICONS.trash2}<span>Delete for good</span></button>
    </div>`;
  };
  function drawDetails(): void {
    details.hidden = false;
    delete details.dataset["hash"];
    const on = files.filter((f) => picked.has(f.path));
    if (!on.length) {
      details.innerHTML = `<p class="asset-note asset-insp-empty" data-testid="inspector-empty">Select a file to restore it or delete it for good. A file comes back where it was; its tags and folder come back only if the library still remembers it.</p>`;
      return;
    }
    if (on.length > 1) {
      details.innerHTML = `<div class="asset-insp-head"><h2>${plural(on.length, "file")} selected</h2></div><p class="asset-note">${fmtBytes(on.reduce((n, f) => n + f.size, 0))}</p>${actionsHtml()}`;
      return;
    }
    const f = on[0]!;
    const was = f.path.startsWith(".trash/library/") ? f.path.slice(".trash/".length, f.path.lastIndexOf("/")) : "";
    details.innerHTML = `<div class="asset-insp-head"><h2 title="${esc(f.name)}">${esc(f.name)}</h2></div>
      <div class="asset-preview-box" hidden><span class="asset-preview"><img alt="" data-trash-preview></span></div>
      <p class="asset-note">${fmtBytes(f.size)}${was ? ` · was in ${esc(was)}` : ""}</p>${actionsHtml()}`;
    const img = details.querySelector<HTMLImageElement>("[data-trash-preview]");
    if (img) void urlOf(f.path, f.name).then((url) => {
      if (!url || !img.isConnected) return;
      img.src = url;
      img.closest<HTMLElement>(".asset-preview-box")!.hidden = false;
    });
  }

  /** What the cards drawn are of: drawn again only when that changes, so pictures do not blink. */
  let drawnOf: string | null = null;
  const drawIfChanged = (): void => {
    const now = `${shown}\n${words.join(" ")}\n${files.map((f) => f.path).join("\n")}`;
    if (box.hidden || now === drawnOf) return;
    drawnOf = now;
    draw();
  };
  const refresh = async (): Promise<void> => {
    files = await deps.list().catch((e: unknown) => {
      deps.say(`Could not read the trash: ${(e as Error).message}`);
      return [];
    });
    for (const p of [...picked]) if (!files.some((f) => f.path === p)) picked.delete(p);
    for (const [p, u] of urls) if (!files.some((f) => f.path === p)) (URL.revokeObjectURL(u), urls.delete(p));
    deps.counted(files.length, files.reduce((n, f) => n + f.size, 0));
    drawIfChanged();
    if (!box.hidden) drawDetails();
  };
  const restore = async (): Promise<void> => {
    let back = 0, had = 0, shut = 0, failed = 0;
    for (const path of [...picked]) {
      const r = await deps.restore(path).catch(() => null);
      if (r === "restored") back++;
      else if (r === "already") had++;
      else if (r === "shut") shut++;
      else failed++;
    }
    const said = [back ? `Restored ${plural(back, "file")}.` : "", had ? `The library already has ${plural(had, "file")}: left in the trash.` : "", shut ? `${plural(shut, "file")} did not open with this key: left in the trash.` : "", failed ? `${plural(failed, "file")} could not be restored.` : ""];
    deps.say(said.filter(Boolean).join(" "));
    await refresh();
  };
  const erase = async (): Promise<void> => {
    const on = files.filter((f) => picked.has(f.path));
    const ok = await confirmDialog({ title: on.length === 1 ? `Delete “${on[0]?.name}” for good?` : `Delete ${plural(on.length, "file")} for good?`, lines: ["Erased from the workspace's .trash folder. This cannot be undone."], confirmLabel: "Delete for good" });
    if (!ok) return;
    for (const f of on) await deps.erase(f.path).catch(() => undefined);
    await refresh();
  };
  const act = (e: Event): void => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-trash]");
    if (!b || b.disabled) return;
    if (b.dataset["trash"] === "more") {
      shown += PAGE;
      drawIfChanged();
    } else void (b.dataset["trash"] === "restore" ? restore() : erase());
  };
  details.addEventListener("click", act);
  box.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-testid='trash-card']");
    act(e);
    if (!card) {
      if (!(e.target as HTMLElement).closest("button")) (picked.clear(), showPicks());
      return;
    }
    const path = card.dataset["path"]!;
    if (e.shiftKey && anchor) {
      const paths = fit().slice(0, shown).map((f) => f.path);
      const [a, b] = [paths.indexOf(anchor), paths.indexOf(path)].sort((x, y) => x - y);
      for (const p of paths.slice(a!, b! + 1)) picked.add(p);
    } else if (e.ctrlKey || e.metaKey) {
      if (!picked.delete(path)) picked.add(path);
      anchor = path;
    } else {
      picked.clear();
      picked.add(path);
      anchor = path;
    }
    showPicks();
  });
  bindContextMenu(box, {
    label: "Trash",
    build: (at): MenuItem[] => {
      const card = (at.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-testid='trash-card']");
      if (!card || deps.readOnly()) return [];
      if (!picked.has(card.dataset["path"]!)) {
        picked.clear();
        picked.add(card.dataset["path"]!);
        showPicks();
      }
      return [
        { label: "Restore", hint: "Put it back where it was", icon: ICONS.archiveRestore, run: () => void restore() },
        { label: "Delete for good", hint: "Cannot be undone", icon: ICONS.trash2, danger: true, run: () => void erase() },
      ];
    },
  });

  return {
    refresh,
    drawDetails,
    selectAll: () => {
      for (const f of fit().slice(0, shown)) picked.add(f.path);
      showPicks();
    },
    clear: () => {
      picked.clear();
      showPicks();
    },
    async show(typed) {
      const next = typed.replace(TRASH_WORD, " ").toLowerCase().split(/\s+/).filter(Boolean);
      if (next.join(" ") !== words.join(" ")) shown = PAGE;
      words = next;
      drawIfChanged();
      await refresh();
    },
  };
}
