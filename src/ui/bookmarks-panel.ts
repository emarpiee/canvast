import type { EditorState } from "../app/editor-state";
import type { BookmarkList } from "../app/bookmarks";
import { esc } from "./format";
import { ICONS } from "./icons";
import { panelHtml } from "./panel";
import { moreButton, openMoreMenu } from "./more-menu";

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
      tools: `<button type="button" class="layer-btn" data-tour aria-label="Play the bookmarks as a tour" title="Play the bookmarks as a tour: Right and Left step, Escape ends it"${list.items.length ? "" : " disabled"}>${ICONS.projector}</button><button type="button" class="layer-btn" data-add aria-label="Add bookmark" title="Save the current view as a bookmark">${ICONS.bookmarkPlus}</button><button type="button" class="layer-btn" data-add-sel aria-label="Bookmark the picked things" title="Save a bookmark that brings the picked things into view"${editor.selection.size ? "" : " disabled"}>${ICONS.bookmarkCheck}</button>
        <button type="button" class="layer-btn" data-thumbs aria-haspopup="menu" aria-label="Update the bookmark pictures" title="Update the pictures of the bookmarks: the canvas visits each place and takes a fresh picture of it"${list.items.length ? "" : " disabled"}>${ICONS.galleryThumbnails}</button>`,
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
      if (save) void list.rename(li.dataset["id"]!, input.value);
      input.remove();
      schedule();
    };
    input.addEventListener("keydown", (k) => {
      k.stopPropagation(); // typing a name is not a canvas shortcut
      if (k.key === "Enter") done(true);
      else if (k.key === "Escape") done(false);
    });
    input.addEventListener("blur", () => done(true));
    input.addEventListener("click", (c) => c.stopPropagation());
  };
  const go = (li: HTMLElement): void => {
    if (!list.go(li.dataset["id"]!)) {
      editor.message = "That bookmark's place no longer exists.";
      editor.changed();
    }
  };

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const li = t.closest<HTMLElement>("li.bookmark");
    if (t.closest("[data-close]")) {
      editor.bookmarksOpen = false;
      editor.changed();
    } else if (t.closest("[data-tour]")) {
      tour();
    } else if (t.closest("[data-fill]")) {
      thumbs.update(list.items.filter((b) => !b.thumb).map((b) => b.id));
    } else if (t.closest("[data-thumbs]")) {
      const missing = list.items.filter((b) => !b.thumb);
      openMoreMenu(
        t.closest<HTMLElement>("[data-thumbs]")!,
        [
          { label: `Update all ${list.items.length} pictures`, icon: ICONS.galleryThumbnails, aria: "Update the pictures of all bookmarks", run: () => thumbs.update() },
          { label: missing.length ? `Fill in the ${missing.length} missing` : "None are missing", icon: ICONS.imagePlus, disabled: missing.length === 0, aria: "Fill in the missing bookmark pictures", run: () => thumbs.update(missing.map((b) => b.id)) },
        ],
        "Update the bookmark pictures",
      );
    } else if (t.closest("[data-add-sel]")) {
      addSelection();
    } else if (t.closest("[data-add]")) {
      void list.add(capture());
    } else if (li && t.closest("[data-bm-more]")) {
      const id = li.dataset["id"]!;
      const name = li.querySelector(".bookmark-name")?.textContent ?? "bookmark";
      const at = list.items.findIndex((b) => b.id === id);
      openMoreMenu(
        t.closest<HTMLElement>("[data-bm-more]")!,
        [
          { label: "Rename", icon: ICONS.textCursorInput, aria: `Rename ${name}`, run: () => startRename(li) },
          {
            label: "Update to the current view",
            icon: ICONS.refresh,
            aria: `Update ${name} to the current view`,
            run: () =>
              void list.update(id, capture()).then(() => {
                editor.message = "Bookmark updated to this view.";
                editor.changed();
              }),
          },
          { label: "Update its picture", icon: ICONS.galleryThumbnails, aria: `Update the picture of ${name}`, run: () => thumbs.update([id]) },
          { label: "Move up", icon: ICONS.arrowUp, disabled: at <= 0, aria: `Move ${name} up`, run: () => void list.move(id, at - 1) },
          { label: "Move down", icon: ICONS.arrowDown, disabled: at >= list.items.length - 1, aria: `Move ${name} down`, run: () => void list.move(id, at + 1) },
          { label: "Delete", icon: ICONS.trash2, danger: true, aria: `Delete ${name}`, run: () => void list.remove(id) },
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
    void list.move(from, list.items.findIndex((b) => b.id === li.dataset["id"]));
  });
  panel.addEventListener("dragend", () => (dragged = ""));
}
