import type { AssetFolder } from "../assets/asset-catalog";
import { plural } from "../doc/plural";
import { esc, fmtBytes } from "./format";
import { makeModal, showModal } from "./modal";
import { capList, showMoreButton } from "./show-more";

/** What the list needs to know of a library item. */
export interface ExportItem { hash: string; name: string; size: number; folderIds?: string[] }
export interface ExportChoice { everything: boolean; hashes: string[]; canvases: boolean; styles: boolean }

/** Every item chosen: one by one, or in a chosen folder or a folder inside it. */
export function chosenItems(items: readonly ExportItem[], folders: readonly AssetFolder[], ids: ReadonlySet<string>, folderIds: ReadonlySet<string>): ExportItem[] {
  const parent = new Map(folders.map((f) => [f.id, f.parentId] as const));
  const inChosen = (id: string | undefined): boolean => {
    for (let at = id, n = 0; at !== undefined && n < 256; at = parent.get(at) ?? undefined, n++) if (folderIds.has(at)) return true;
    return false;
  };
  return items.filter((i) => ids.has(i.hash) || inChosen(i.folderIds?.[0]));
}

const SHOWN = 40;
const box = (attr: string, id: string, on: boolean, label: string, hint: string): string =>
  `<li><label class="pg-check"><input type="checkbox" ${attr}="${esc(id)}"${on ? " checked" : ""}> <span>${esc(label)}</span></label><span>${esc(hint)}</span></li>`;

/** The shared modal of Advanced export: everything, or the items and folders searched for and ticked. Null: cancelled. */
export function chooseExport(items: readonly ExportItem[], folders: readonly AssetFolder[], maxFile: number | null): Promise<ExportChoice | null> {
  const ids = new Set<string>(), folderIds = new Set<string>();
  let query = "", more = false;
  const dlg = makeModal({
    className: "confirm advanced-export",
    testid: "advanced-export",
    titleId: "advanced-export-title",
    html: `
    <h2 id="advanced-export-title">Advanced export</h2>
    <p>Choose what goes in the backup.</p>
    <label class="pg-check"><input type="checkbox" data-ax-all data-testid="advanced-all"> <span>Everything</span></label>
    <div data-ax-pick>
      <div class="layers-filter"><input type="search" data-ax-search placeholder="Search items and folders" aria-label="Search items and folders"></div>
      <ul class="confirm-list advanced-export-list" data-ax-found></ul>
      <div data-ax-more></div>
      <label class="pg-check"><input type="checkbox" data-ax-canvases> <span>Also the canvases, and the files they show</span></label>
      <label class="pg-check"><input type="checkbox" data-ax-styles checked> <span>Saved styles, and the fonts and pictures they use</span></label>
      <p data-ax-sum data-testid="advanced-sum"></p>
      <div class="confirm-warn" role="note" data-ax-warn hidden></div>
    </div>
    <div class="confirm-actions">
      <button type="button" value="cancel">Cancel</button>
      <button type="button" class="is-primary" value="ok" data-testid="advanced-ok">Export</button>
    </div>`,
  });
  const q = <T extends HTMLElement>(s: string): T => dlg.querySelector<T>(s)!;
  const all = q<HTMLInputElement>("[data-ax-all]"), ok = q<HTMLButtonElement>('[value="ok"]');
  const nameOf = new Map(folders.map((f) => [f.id, f] as const));
  const pathOf = (id: string | undefined): string => {
    const names: string[] = [];
    for (let f = id === undefined ? undefined : nameOf.get(id), n = 0; f && n < 256; f = f.parentId ? nameOf.get(f.parentId) : undefined, n++) names.unshift(f.name);
    return names.join(" / ");
  };
  const sum = (): void => {
    const chosen = chosenItems(items, folders, ids, folderIds);
    const canvases = q<HTMLInputElement>("[data-ax-canvases]").checked;
    q("[data-ax-sum]").textContent = `Chosen: ${plural(chosen.length, "item")}, ${fmtBytes(chosen.reduce((t, i) => t + i.size, 0))}${canvases ? ", and the canvases" : ""}.`;
    ok.disabled = !all.checked && !chosen.length && !canvases;
    const big = maxFile === null ? 0 : chosen.filter((i) => i.size > maxFile).length;
    const warn = q("[data-ax-warn]");
    warn.hidden = !big;
    if (big) warn.textContent = `${plural(big, "file")} ${big === 1 ? "is" : "are"} too big for a backup made in a browser and will be left out.`;
  };
  const found = (): void => {
    const w = query.trim().toLowerCase();
    const has = (s: string): boolean => !w || s.toLowerCase().includes(w);
    const rows = [
      ...folders.filter((f) => has(f.name)).map((f) => box("data-ax-folder", f.id, folderIds.has(f.id), f.name, pathOf(f.parentId ?? undefined) || "Folder")),
      ...items.filter((i) => has(i.name)).map((i) => box("data-ax-item", i.hash, ids.has(i.hash), i.name, `${fmtBytes(i.size)}${i.folderIds?.[0] ? ` · ${pathOf(i.folderIds[0])}` : ""}`)),
    ];
    const cap = capList(rows, SHOWN, more);
    q("[data-ax-found]").innerHTML = cap.shown.join("") || `<li><span>Nothing found.</span></li>`;
    q("[data-ax-more]").innerHTML = cap.long ? showMoreButton({ open: more, hidden: cap.hidden, attrs: "data-ax-showmore" }) : "";
  };
  dlg.addEventListener("input", (e) => {
    if ((e.target as HTMLElement).matches("[data-ax-search]")) {
      query = (e.target as HTMLInputElement).value;
      more = false;
      found();
    }
  });
  dlg.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    const toggle = (set: Set<string>, id: string): void => void (t.checked ? set.add(id) : set.delete(id));
    if (t.dataset["axItem"] !== undefined) toggle(ids, t.dataset["axItem"]);
    if (t.dataset["axFolder"] !== undefined) toggle(folderIds, t.dataset["axFolder"]);
    q("[data-ax-pick]").hidden = all.checked;
    sum();
  });
  return new Promise((resolve) => {
    let answer: ExportChoice | null = null;
    dlg.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-ax-showmore]")) {
        more = !more;
        found();
        return;
      }
      const b = t.closest<HTMLButtonElement>(".confirm-actions button");
      if (!b) return;
      if (b.value === "ok") answer = { everything: all.checked, hashes: chosenItems(items, folders, ids, folderIds).map((i) => i.hash), canvases: q<HTMLInputElement>("[data-ax-canvases]").checked, styles: q<HTMLInputElement>("[data-ax-styles]").checked };
      dlg.close();
    });
    found();
    sum();
    showModal(dlg, () => resolve(answer));
    q<HTMLInputElement>("[data-ax-search]").focus();
  });
}
