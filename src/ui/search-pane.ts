import { ICONS } from "./icons";
import { esc } from "./format";
import { labelOf } from "./layers-panel";
import { plural } from "../doc/plural";
import { pressCommand, runCommand } from "../commands/registry";
import type { CanvasObject } from "../doc/model";

export interface SearchPaneDeps {
  /** The open canvas's name and its objects, front to back. */
  canvas(): { name: string; objects: Iterable<CanvasObject> };
  /** The Library's file names (hash → name), for the objects' labels. */
  names: ReadonlyMap<string, string>;
  /** Open a Library file: in its own view (a note, a PDF, a 3D model), else shown in the Library. */
  openFile(hash: string): void;
}

/** How many results a group lists. */
const MAX_PER_GROUP = 30;

/**
 * The Search pane (B39): one box for the whole workspace, its results grouped where they are: the open canvas (objects by name or text) and
 * the Library (files by name, tags or words, as its own search box finds them). A canvas result is selected and brought into view; a file
 * opens. Typing is view state; every result runs its command.
 */
export function mountSearchPane(body: HTMLElement, deps: SearchPaneDeps): { focus(): void } {
  body.innerHTML = `
    <div class="search-pane-box"><span class="search-pane-icon" aria-hidden="true">${ICONS.search}</span><input type="search" class="search-pane-input" data-testid="search-pane-input" placeholder="Search the workspace" aria-label="Search the workspace" autocomplete="off" spellcheck="false" data-view-state></div>
    <p class="search-pane-count" data-testid="search-pane-count" aria-live="polite"></p>
    <ul class="side-list search-pane-list" data-testid="search-pane-list" aria-label="Results"></ul>`;
  const input = body.querySelector<HTMLInputElement>(".search-pane-input")!;
  const count = body.querySelector<HTMLElement>(".search-pane-count")!;
  const list = body.querySelector<HTMLElement>(".search-pane-list")!;
  let asked = 0;

  const group = (icon: string, title: string, rows: string[]): string =>
    rows.length ? `<li class="side-row search-pane-group" role="presentation"><span class="side-item">${icon}<span class="side-label">${esc(title)}</span><span class="side-n">${rows.length}</span></span></li>${rows.join("")}` : "";
  const row = (attrs: string, icon: string, text: string, q: string): string => {
    const at = text.toLowerCase().indexOf(q);
    const shown = at < 0 ? esc(text) : `${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + q.length))}</mark>${esc(text.slice(at + q.length))}`;
    return `<li class="side-row search-pane-row"><button type="button" class="side-item" ${attrs} title="${esc(text)}">${icon}<span class="side-label">${shown}</span></button></li>`;
  };

  const search = async (): Promise<void> => {
    const q = input.value.trim().toLowerCase();
    const mine = ++asked;
    if (!q) {
      count.textContent = "";
      list.innerHTML = "";
      return;
    }
    const canvas = deps.canvas();
    const onCanvas: string[] = [];
    for (const o of canvas.objects) {
      const lab = labelOf(o, deps.names);
      if (lab.text.toLowerCase().includes(q)) onCanvas.push(row(`data-object="${esc(o.id)}"`, lab.icon, lab.text, q));
      if (onCanvas.length >= MAX_PER_GROUP) break;
    }
    const found = await runCommand("library.search", { query: q, limit: MAX_PER_GROUP }).catch(() => null);
    if (mine !== asked) return; // (a newer search has begun)
    const items = found?.ok ? ((found.value as { items?: Array<{ hash: string; name: string }> } | undefined)?.items ?? []) : [];
    const inLibrary = items.map((e) => row(`data-file="${esc(e.hash)}"`, ICONS.fileText, e.name, q));
    const n = onCanvas.length + inLibrary.length;
    const places = (onCanvas.length ? 1 : 0) + (inLibrary.length ? 1 : 0);
    count.textContent = n ? `${plural(n, "result")} in ${plural(places, "place")}` : "Nothing found";
    list.innerHTML = group(ICONS.infinity, canvas.name, onCanvas) + group(ICONS.images, "Library", inLibrary);
  };

  let timer = 0;
  // view-state: (typing in the search box)
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void search(), 150);
  });
  // commands: select.items, view.focus (an object on the canvas), library.reveal (a file, through openFile)
  list.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-object], [data-file]");
    if (!t) return;
    if (t.dataset["object"]) {
      void pressCommand("go.canvas");
      void pressCommand("select.items", { ids: [t.dataset["object"]] });
      void pressCommand("view.focus");
    } else if (t.dataset["file"]) deps.openFile(t.dataset["file"]);
  });
  return { focus: () => input.focus() };
}
