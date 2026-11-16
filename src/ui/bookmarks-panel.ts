import type { EditorState } from "../app/editor-state";
import type { BookmarkList } from "../app/bookmarks";
import { esc } from "./format";
import { ICONS } from "./icons";
import { panelHtml } from "./panel";
import { moreButton, openMoreMenu } from "./more-menu";
import { commands, pressCommand } from "../commands/registry";
import type { Command, Options, OptionSpec, Result, Risk } from "../commands/types";

/**
 * Floating Bookmarks panel (ADR 0025, 0065): named places on the canvas, each a card with its picture. Add saves the current view with
 * a small picture; a click on the card goes there; each card has Rename (or double-click the name), Update (the bookmark now points at
 * the view as it is, with a fresh picture) and Delete. Hidden by default, like the Layers panel. Built for touch too: the buttons are
 * large, always shown on a touch screen, and the card never needs hover.
 */
export interface BookmarkThumbs {
  /** Give bookmarks fresh pictures by visiting their places (ADR 0124): the ones named, or all of them. */
  update(ids?: readonly string[]): void;
}

export function mountBookmarksPanel(host: HTMLElement, editor: EditorState, list: BookmarkList, capture: () => string | undefined, tour: () => void = () => undefined, thumbs: BookmarkThumbs = { update: () => undefined }, addSelection: () => void = () => undefined): void {
  const panel = document.createElement("aside");
  panel.className = "layers-panel bookmarks-panel";
  panel.setAttribute("aria-label", "Bookmarks");
  panel.dataset["testid"] = "bookmarks-panel";
  host.appendChild(panel);
  let scheduled = false;
  const when = (at: number): string => {
    const d = new Date(at);
    const today = new Date();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === today.toDateString() ? `Today, ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  };

  const render = (): void => {
    scheduled = false;
    panel.hidden = !editor.bookmarksOpen;
    if (!editor.bookmarksOpen) return;
    // A name being typed is not redrawn under the cursor.
    if (panel.querySelector("li.bookmark input")) return;
    const missing = list.items.filter((b) => !b.thumb);
    const rows = list.items
      .map(
        (b) => `<li class="bookmark" data-id="${b.id}" draggable="true">
        <div class="bookmark-go" role="button" tabindex="0" aria-label="Go to ${esc(b.name)}" title="Go there">
          ${b.thumb ? `<img class="bookmark-thumb" alt="" src="${b.thumb}">` : '<span class="bookmark-thumb"></span>'}
          <span class="bookmark-text"><span class="bookmark-name" title="Double-click to rename">${esc(b.name)}</span><span class="bookmark-meta">${esc(when(b.at))}</span></span>
        </div>
        ${moreButton(`More actions for bookmark ${b.name}`, "data-bm-more")}
      </li>`,
      )
      .join("");
    panel.innerHTML = panelHtml({
      title: "Bookmarks",
      count: list.items.length,
      tools: `<button type="button" class="layer-btn" data-tour aria-label="Play the bookmarks as a tour" title="Play the bookmarks as a tour: Right and Left step, Escape ends it"${list.items.length ? "" : " disabled"}>${ICONS.play}</button><button type="button" class="layer-btn" data-add aria-label="Add bookmark" title="Save the current view as a bookmark">${ICONS.bookmarkPlus}</button><button type="button" class="layer-btn" data-add-sel aria-label="Bookmark the selected objects" title="Save a bookmark that brings the selected objects into view"${editor.selection.size ? "" : " disabled"}>${ICONS.bookmarkCheck}</button>
        <button type="button" class="layer-btn" data-thumbs aria-haspopup="menu" aria-label="Update the bookmark pictures" title="Update the pictures of the bookmarks: the canvas visits each place and takes a fresh picture of it"${list.items.length ? "" : " disabled"}>${ICONS.refresh}</button>`,
      sub: missing.length ? `<p class="bm-missing" data-testid="bm-missing"><span>${missing.length} bookmark${missing.length === 1 ? " has" : "s have"} no picture.</span><button type="button" data-fill>Fill in</button></p>` : "",
      body: `<ul aria-label="Saved views">${rows || `<li class="layers-empty">No bookmarks yet. Move to a place and zoom, then press ${ICONS.bookmarkPlus} to come back to it any time.</li>`}</ul>`,
    });
  };
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  list.subscribe(schedule);
  editor.subscribe(schedule);
  render();

  /** Swap the name for a box; Enter or leaving keeps it, Escape does not. */
  const startRename = (li: HTMLElement): void => {
    const name = li.querySelector<HTMLElement>(".bookmark-name");
    if (!name) return;
    const input = document.createElement("input");
    input.type = "text";
    input.value = name.textContent ?? "";
    input.maxLength = 80;
    input.setAttribute("aria-label", "Bookmark name");
    name.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const done = (save: boolean): void => {
      if (finished) return;
      finished = true;
      if (save) pressCommand("bookmark.rename", { bookmark: li.dataset["id"]!, name: input.value });
      input.remove();
      schedule();
    };
    input.addEventListener("keydown", (k) => {
      k.stopPropagation(); // typing a name is not a canvas shortcut
      if (k.key === "Enter") done(true);
      else if (k.key === "Escape") done(false);
    });
    input.addEventListener("blur", () => done(true));
    input.addEventListener("click", (c) => c.stopPropagation()); // view-state: (a click in the name box stays there)
  };
  // The bookmarks' commands (ADR 0205): the panel's buttons and menus run them by id, as the palette, a macro and an outside caller do.
  const BM: OptionSpec = { name: "bookmark", type: "id", doc: "the bookmark", required: true };
  const bm = (id: string, title: string, hint: string, options: readonly OptionSpec[], exec: (o: Options) => Result | void | Promise<Result | void>, risk: Risk = "edit"): Command => ({ id, group: "Bookmarks", kind: "bookmark", title, hint, risk, options, why: () => null, exec });
  const known = (o: Options): string | null => (list.items.some((b) => b.id === o["bookmark"]) ? null : `There is no bookmark "${String(o["bookmark"])}".`);
  const withBm = (fn: (id: string, o: Options) => Result | void | Promise<Result | void>) => (o: Options): Result | void | Promise<Result | void> => { const no = known(o); return no ? { ok: false, error: no } : fn(String(o["bookmark"]), o); };
  commands.setProvider("bookmarks", () => [
    bm("bookmark.add", "Bookmark this view", "Where you are now", [{ name: "name", type: "text", doc: "its name (default: one made for it)" }], async (o) => {
      const before = new Set(list.items.map((b) => b.id));
      await list.add(capture());
      const made = list.items.find((b) => !before.has(b.id));
      if (made && typeof o["name"] === "string") await list.rename(made.id, o["name"]);
      return made ? { ok: true, made: [made.id] } : { ok: true };
    }),
    bm("bookmark.go", "Go to a bookmark", "Its place and zoom", [BM], withBm((id) => (list.go(id) ? { ok: true } : { ok: false, error: "That bookmark's place no longer exists." }))),
    bm("bookmark.rename", "Rename a bookmark", "Give it a new name", [BM, { name: "name", type: "text", doc: "the new name", required: true }], withBm((id, o) => void list.rename(id, String(o["name"])))),
    bm("bookmark.update", "Update a bookmark to this view", "Where you are now", [BM], withBm((id) => void list.update(id, capture()).then(() => { editor.message = "Bookmark updated to this view."; editor.changed(); }))),
    bm("bookmark.move", "Move a bookmark", "Its place in the list and the tour", [BM, { name: "to", type: "number", doc: "its new place, from 0", required: true, min: 0, max: 100000 }], withBm((id, o) => void list.move(id, Number(o["to"])))),
    bm("bookmark.delete", "Delete a bookmark", "Remove it from the list", [BM], withBm((id) => void list.remove(id)), "confirm"),
    bm("bookmark.pictures", "Update the bookmarks' pictures", "Draw them again, or only the missing", [{ name: "bookmarks", type: "ids", doc: "which (default: all)" }, { name: "missing", type: "boolean", doc: "only those with no picture" }], (o) => {
      const ids = (o["bookmarks"] as string[] | undefined) ?? (o["missing"] === true ? list.items.filter((b) => !b.thumb).map((b) => b.id) : undefined);
      thumbs.update(ids);
    }),
  ]);
  const go = (li: HTMLElement): void => void pressCommand("bookmark.go", { bookmark: li.dataset["id"]! });

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const li = t.closest<HTMLElement>("li.bookmark");
    if (t.closest("[data-close]")) {
      pressCommand("panel.bookmarks");
    } else if (t.closest("[data-tour]")) {
      pressCommand("view.tour");
    } else if (t.closest("[data-fill]")) {
      pressCommand("bookmark.pictures", { missing: true });
    } else if (t.closest("[data-thumbs]")) {
      const missing = list.items.filter((b) => !b.thumb);
      openMoreMenu(
        t.closest<HTMLElement>("[data-thumbs]")!,
        [
          { label: list.items.length === 1 ? "Update the picture" : `Update all ${list.items.length} pictures`, hint: "Draw them again", icon: ICONS.refresh, aria: "Update the pictures of all bookmarks", command: "bookmark.pictures", run: () => void pressCommand("bookmark.pictures") },
          { label: missing.length ? `Fill in the ${missing.length} missing` : "None are missing", hint: "Only those with no picture", icon: ICONS.imagePlus, disabled: missing.length === 0, aria: "Fill in the missing bookmark pictures", command: "bookmark.pictures", run: () => void pressCommand("bookmark.pictures", { missing: true }) },
        ],
        "Update the bookmark pictures",
      );
    } else if (t.closest("[data-add-sel]")) {
      pressCommand("bookmark.selection"); // (the canvas's command: src/app/canvas-commands.ts)
    } else if (t.closest("[data-add]")) {
      pressCommand("bookmark.add");
    } else if (li && t.closest("[data-bm-more]")) {
      const id = li.dataset["id"]!;
      const name = li.querySelector(".bookmark-name")?.textContent ?? "bookmark";
      const at = list.items.findIndex((b) => b.id === id);
      openMoreMenu(
        t.closest<HTMLElement>("[data-bm-more]")!,
        [
          { label: "Rename", hint: "Give it a new name", icon: ICONS.textCursorInput, aria: `Rename ${name}`, command: "bookmark.rename", run: () => startRename(li) },
          {
            label: "Update to the current view",
            hint: "Where you are now",
            icon: ICONS.refresh,
            aria: `Update ${name} to the current view`,
            command: "bookmark.update",
            run: () => void pressCommand("bookmark.update", { bookmark: id }),
          },
          { label: "Update its picture", hint: "From the current view", icon: ICONS.refresh, aria: `Update the picture of ${name}`, command: "bookmark.pictures", run: () => void pressCommand("bookmark.pictures", { bookmarks: [id] }) },
          { label: "Move up", hint: "Earlier in the list", icon: ICONS.arrowUp, disabled: at <= 0, aria: `Move ${name} up`, command: "bookmark.move", run: () => void pressCommand("bookmark.move", { bookmark: id, to: at - 1 }) },
          { label: "Move down", hint: "Later in the list", icon: ICONS.arrowDown, disabled: at >= list.items.length - 1, aria: `Move ${name} down`, command: "bookmark.move", run: () => void pressCommand("bookmark.move", { bookmark: id, to: at + 1 }) },
          { label: "Delete", hint: "Remove this bookmark", icon: ICONS.trash2, danger: true, aria: `Delete ${name}`, command: "bookmark.delete", run: () => void pressCommand("bookmark.delete", { bookmark: id }) },
        ],
        `Actions for bookmark ${name}`,
      );
    } else if (li && !t.closest(".bookmark input") && t.closest(".bookmark-go")) {
      go(li);
    }
  });
  panel.addEventListener("keydown", (e) => {
    const go_ = (e.target as HTMLElement).closest<HTMLElement>(".bookmark-go");
    if (go_ && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      e.stopPropagation();
      go(go_.closest<HTMLElement>("li.bookmark")!);
    } else if (go_ && e.key === "F2") startRename(go_.closest<HTMLElement>("li.bookmark")!);
  });
  // view-state: (opens the name box; what is typed runs bookmark.rename)
  panel.addEventListener("dblclick", (e) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>(".bookmark-name");
    const li = name?.closest<HTMLElement>("li.bookmark");
    if (li) startRename(li);
  });
  // Drag a card onto another to move it there (the tour follows the order).
  let dragged = "";
  panel.addEventListener("dragstart", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li.bookmark");
    if (!li || (e.target as HTMLElement).closest("input")) return e.preventDefault();
    dragged = li.dataset["id"]!;
    e.dataTransfer?.setData("text/plain", dragged); // (Firefox starts no drag without data)
  });
  panel.addEventListener("dragover", (e) => {
    if (dragged && (e.target as HTMLElement).closest("li.bookmark")) e.preventDefault();
  });
  panel.addEventListener("drop", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li.bookmark");
    const from = dragged;
    dragged = "";
    if (!li || !from || li.dataset["id"] === from) return;
    e.preventDefault();
    pressCommand("bookmark.move", { bookmark: from, to: list.items.findIndex((b) => b.id === li.dataset["id"]) });
  });
  panel.addEventListener("dragend", () => (dragged = ""));
}
