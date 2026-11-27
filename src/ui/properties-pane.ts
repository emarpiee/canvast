import { ICONS } from "./icons";
import { esc, fmtBytes } from "./format";
import { labelOf } from "./layers-panel";
import { plural } from "../doc/plural";
import { pressCommand } from "../commands/registry";
import type { CanvasObject } from "../doc/model";
import type { CatalogEntry } from "../assets/asset-catalog";

export interface PropertiesPaneDeps {
  /** The open canvas's name, how many objects it has, and what is selected on it. */
  canvas(): { name: string; count: number; selected: CanvasObject[] };
  /** The Library's file names (hash → name), for the objects' labels. */
  names: ReadonlyMap<string, string>;
  entry(hash: string): Promise<CatalogEntry | undefined>;
  thumb(hash: string): Promise<Blob | undefined>;
  /** Drawn as a padlock (a hidden item while they are locked): nothing of it is shown. */
  locked(hash: string): boolean;
  /** Calls back when the selection or the canvas changes. */
  subscribe(fn: () => void): void;
}

/** How many selected items a selection of several lists by name. */
const LISTED = 8;

/**
 * The Properties pane (B39): what is selected on the canvas, as the Library's details say it: a file's picture, name, kind and size, Show in
 * the Library, its tags, fields and note; several items by name; nothing selected, the canvas itself. A hidden item that is locked shows as
 * one, nothing more.
 */
export function mountPropertiesPane(body: HTMLElement, deps: PropertiesPaneDeps): void {
  body.innerHTML = `<div class="props-pane" data-testid="properties-pane"></div>`;
  const box = body.querySelector<HTMLElement>(".props-pane")!;
  let url: string | null = null;
  let drawn = "";
  let asked = 0;

  const rows = (e: CatalogEntry): string => {
    const out: string[] = [];
    if (e.tags?.length) out.push(`<div class="props-pane-row"><span class="props-pane-key">${ICONS.tag}tags</span><span class="props-pane-tags">${e.tags.map((t) => `<span class="props-pane-tag">#${esc(t)}</span>`).join("")}</span></div>`);
    for (const f of e.fields ?? []) out.push(`<div class="props-pane-row"><span class="props-pane-key">${ICONS.textCursorInput}${esc(f.key)}</span><span class="props-pane-value">${esc(f.value)}</span></div>`);
    if (e.note) out.push(`<div class="props-pane-row"><span class="props-pane-key">${ICONS.fileText}note</span><span class="props-pane-value">${esc(e.note)}</span></div>`);
    return out.length ? `<h3 class="props-pane-h">Properties</h3>${out.join("")}` : "";
  };

  const render = async (): Promise<void> => {
    const c = deps.canvas();
    const key = `${c.name}|${c.count}|${c.selected.map((o) => o.id).join(",")}`;
    if (key === drawn) return;
    drawn = key;
    const mine = ++asked;
    const one = c.selected.length === 1 ? c.selected[0]! : null;
    if (!c.selected.length) {
      box.innerHTML = `<h2 class="props-pane-title">${esc(c.name)}</h2><p class="props-pane-sub">Canvas · ${plural(c.count, "object")}</p><p class="props-pane-empty">Select something on the canvas to see its details here.</p>`;
      return;
    }
    if (!one) {
      const listed = c.selected.slice(0, LISTED).map((o) => {
        const lab = o.kind === "image" && deps.locked(o.assetId) ? { icon: ICONS.lock, text: "A hidden item" } : labelOf(o, deps.names);
        return `<li class="props-pane-item">${lab.icon}<span>${esc(lab.text)}</span></li>`;
      });
      box.innerHTML = `<h2 class="props-pane-title">${plural(c.selected.length, "item")} selected</h2><ul class="props-pane-list">${listed.join("")}</ul>${c.selected.length > LISTED ? `<p class="props-pane-sub">and ${c.selected.length - LISTED} more</p>` : ""}`;
      return;
    }
    if (one.kind !== "image") {
      const lab = labelOf(one, deps.names);
      box.innerHTML = `<h2 class="props-pane-title">${esc(lab.text)}</h2><p class="props-pane-sub">${one.kind === "text" ? "Text" : one.kind === "path" ? "Shape" : "Stroke"} on ${esc(c.name)}</p>`;
      return;
    }
    if (deps.locked(one.assetId)) {
      box.innerHTML = `<h2 class="props-pane-title">${ICONS.lock} A hidden item</h2><p class="props-pane-sub">Unlock the hidden items to see it.</p>`;
      return;
    }
    const [e, blob] = await Promise.all([deps.entry(one.assetId).catch(() => undefined), deps.thumb(one.assetId).catch(() => undefined)]);
    if (mine !== asked) return; // (the selection changed meanwhile)
    if (url) URL.revokeObjectURL(url);
    url = blob ? URL.createObjectURL(blob) : null;
    const name = e?.name ?? deps.names.get(one.assetId) ?? "A file";
    const kind = (e?.type.split("/")[1] ?? "").toUpperCase();
    const sub = [kind, e && e.pixelW ? `${e.pixelW} × ${e.pixelH} px` : "", e ? fmtBytes(e.size) : ""].filter(Boolean).join(" · ");
    box.innerHTML = `<h2 class="props-pane-title" title="${esc(name)}">${esc(name)}</h2><p class="props-pane-sub">${esc(sub)}</p>
      ${url ? `<img class="props-pane-picture" src="${url}" alt="">` : ""}
      <div class="props-pane-actions"><button type="button" class="assets-btn" data-command="library.reveal" data-hash="${esc(one.assetId)}">${ICONS.images}<span>Show in Library</span></button></div>
      ${e ? rows(e) : ""}`;
  };

  // commands: library.reveal (Show in Library)
  box.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-command='library.reveal']");
    if (b) void pressCommand("library.reveal", { hashes: [b.dataset["hash"]!] });
  });
  deps.subscribe(() => void render());
  void render();
}
