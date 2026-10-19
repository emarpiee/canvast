import { holdColourPopover } from "./colour-popover";
import { placeMenu } from "./more-menu";
import { esc } from "./format";

/** A picture of the library, as the chooser lists it: its name and, when it has one, a small picture of it. */
export interface LibraryPicture {
  hash: string;
  name: string;
  thumb(): Promise<Blob | undefined>;
}

/**
 * A small panel beside `anchor` with the pictures of the library (the first way to give a texture fill its picture, ADR 0154): a search by
 * name and a grid of small pictures. Resolves with the hash of the one pressed, or null (Escape, a press elsewhere). The paint chooser stays
 * open while it is.
 */
export function openLibraryPicker(anchor: HTMLElement, items: readonly LibraryPicture[]): Promise<string | null> {
  return new Promise((resolve) => {
    const pop = document.createElement("div");
    pop.className = "lib-pick";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Choose a picture from the library");
    pop.innerHTML = `<input type="search" data-lib-search placeholder="Search ${items.length} pictures" aria-label="Search the pictures of the library by name" autocomplete="off"><div class="lib-grid" data-lib-grid></div><p class="op-note" data-lib-empty hidden></p>`;
    const grid = pop.querySelector<HTMLElement>("[data-lib-grid]")!;
    const empty = pop.querySelector<HTMLElement>("[data-lib-empty]")!;
    const urls: string[] = [];
    const draw = (q: string): void => {
      const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q));
      grid.innerHTML = shown.map((i) => `<button type="button" class="lib-item" data-hash="${esc(i.hash)}" title="${esc(i.name)}" aria-label="${esc(i.name)}"><span class="lib-thumb"></span><span class="lib-name">${esc(i.name)}</span></button>`).join("");
      empty.hidden = shown.length > 0;
      empty.textContent = items.length ? "No picture has that name." : "The library has no pictures yet. Choose a file to put one in it.";
      for (const [n, b] of [...grid.querySelectorAll<HTMLElement>(".lib-item")].entries()) {
        void shown[n]!.thumb().then((blob) => {
          if (!blob || !b.isConnected) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          b.querySelector(".lib-thumb")!.innerHTML = `<img src="${url}" alt="" loading="lazy" decoding="async">`;
        });
      }
    };
    const done = (hash: string | null): void => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keys, true);
      for (const u of urls) URL.revokeObjectURL(u);
      pop.remove();
      holdColourPopover(false);
      resolve(hash);
    };
    const outside = (e: PointerEvent): void => {
      if (!pop.contains(e.target as Node)) done(null);
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
    pop.querySelector<HTMLInputElement>("[data-lib-search]")!.addEventListener("input", (e) => draw((e.target as HTMLInputElement).value.trim().toLowerCase()));
    holdColourPopover(true);
    document.body.appendChild(pop);
    draw("");
    placeMenu(pop, anchor);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
    pop.querySelector<HTMLInputElement>("[data-lib-search]")!.focus();
  });
}
