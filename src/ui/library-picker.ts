import { holdColourPopover } from "./colour-popover";
import { placeMenu } from "./more-menu";
import { esc } from "./format";
import { ICONS } from "./icons";
import { plural } from "../doc/plural";

/** An item of the library, as the chooser lists it: its name, a small picture of it when it has one, else its kind (`PNG`, `PDF`). */
export interface LibraryPicture {
  hash: string;
  name: string;
  thumb(): Promise<Blob | undefined>;
  chip?: string;
}

export interface LibraryPickerOptions {
  /** What the items are called, for one and for many (default: picture, pictures). */
  noun?: readonly [string, string];
  /** Files from this device: put in the library at once, and the first one taken is the choice (`accept` as on a file input). */
  importFiles?: { accept: string; run(files: File[]): Promise<string[]> };
}

/** Grid cells drawn at most: a bigger library is narrowed by the search. */
const SHOWN_MAX = 300;

/**
 * The library chooser (ADR 0154): a search by name and a grid of the items given, beside `anchor` or, without one, in the middle of the
 * page. Used wherever something is taken from the library (a texture fill, a custom thumbnail, a note's attachments). Resolves with the
 * hash of the one pressed (or of the first file imported), or null (Escape, a press elsewhere). The paint chooser stays open while it is.
 */
export function openLibraryPicker(anchor: HTMLElement | null, items: readonly LibraryPicture[], opts: LibraryPickerOptions = {}): Promise<string | null> {
  const [one, many] = opts.noun ?? ["picture", "pictures"];
  return new Promise((resolve) => {
    const pop = document.createElement("div");
    pop.className = anchor ? "lib-pick" : "lib-pick is-centred";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", `Choose a ${one} from the library`);
    pop.innerHTML = `<div class="lib-head"><input type="search" data-lib-search placeholder="${items.length ? `Search ${items.length === 1 ? `the ${one}` : `the ${plural(items.length, one, many)}`}` : `No ${many} in the library`}" aria-label="Search the ${many} of the library by name" autocomplete="off">${opts.importFiles ? `<button type="button" class="assets-btn" data-lib-import title="Choose files on this device: they are put in the library and the first one is used">${ICONS.arrowDownToLine}<span>Import…</span></button>` : ""}</div><div class="lib-grid" data-lib-grid></div><p class="op-note" data-lib-empty hidden></p>`;
    const grid = pop.querySelector<HTMLElement>("[data-lib-grid]")!;
    const empty = pop.querySelector<HTMLElement>("[data-lib-empty]")!;
    const urls: string[] = [];
    const draw = (q: string): void => {
      const found = items.filter((i) => !q || i.name.toLowerCase().includes(q));
      const shown = found.slice(0, SHOWN_MAX);
      grid.innerHTML = shown.map((i) => `<button type="button" class="lib-item" data-hash="${esc(i.hash)}" title="${esc(i.name)}" aria-label="${esc(i.name)}"><span class="lib-thumb">${i.chip ? `<span class="lib-chip">${esc(i.chip)}</span>` : ""}</span><span class="lib-name">${esc(i.name)}</span></button>`).join("");
      empty.hidden = shown.length > 0 && found.length <= SHOWN_MAX;
      empty.textContent = found.length > SHOWN_MAX ? `Showing ${SHOWN_MAX} of ${plural(found.length, one, many)}: search by name to find the others.` : items.length ? `No ${one} has that name.` : `The library has no ${many} yet.${opts.importFiles ? " Import one from this device." : ""}`;
      for (const [n, b] of [...grid.querySelectorAll<HTMLElement>(".lib-item")].entries()) {
        void shown[n]!.thumb().then((blob) => {
          if (!blob || !b.isConnected) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          b.querySelector(".lib-thumb")!.innerHTML = `<img src="${url}" alt="" loading="lazy" decoding="async">`;
        });
      }
    };
    let choosingFile = false;
    const done = (hash: string | null): void => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keys, true);
      for (const u of urls) URL.revokeObjectURL(u);
      pop.remove();
      holdColourPopover(false);
      resolve(hash);
    };
    const outside = (e: PointerEvent): void => {
      if (!choosingFile && !pop.contains(e.target as Node)) done(null);
    };
    const keys = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
    pop.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-hash]");
      if (b) done(b.dataset["hash"]!);
    });
    pop.querySelector<HTMLButtonElement>("[data-lib-import]")?.addEventListener("click", (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = opts.importFiles!.accept;
      choosingFile = true;
      input.addEventListener("cancel", () => (choosingFile = false));
      input.addEventListener("change", () => {
        choosingFile = false;
        const files = [...(input.files ?? [])];
        if (!files.length) return;
        button.disabled = true;
        empty.hidden = false;
        empty.textContent = `Putting ${files.length === 1 ? "the file" : plural(files.length, "file")} in the library…`;
        void opts.importFiles!.run(files).then(
          (hashes) => (hashes.length ? done(hashes[0]!) : ((button.disabled = false), (empty.textContent = `That file could not be used as a ${one}.`))),
          (err: Error) => ((button.disabled = false), (empty.textContent = `Not imported: ${err.message}`)),
        );
      });
      input.click();
    });
    pop.querySelector<HTMLInputElement>("[data-lib-search]")!.addEventListener("input", (e) => draw((e.target as HTMLInputElement).value.trim().toLowerCase()));
    holdColourPopover(true);
    document.body.appendChild(pop);
    draw("");
    if (anchor) placeMenu(pop, anchor);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
    pop.querySelector<HTMLInputElement>("[data-lib-search]")!.focus();
  });
}
