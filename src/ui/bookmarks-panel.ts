import type { EditorState } from "../app/editor-state";
import type { BookmarkList } from "../app/bookmarks";
import { esc } from "./format";
import { ICONS } from "./icons";

/**
 * Floating Bookmarks panel (ADR 0025): named places on the canvas. Add saves the
 * current view with a small picture; click goes there; double-click a name to
 * rename; the cross deletes. Hidden by default, like the Layers panel.
 */
export function mountBookmarksPanel(host: HTMLElement, editor: EditorState, list: BookmarkList, capture: () => string | undefined): void {
  const panel = document.createElement("aside");
  panel.className = "layers-panel bookmarks-panel";
  panel.setAttribute("aria-label", "Bookmarks");
  panel.dataset["testid"] = "bookmarks-panel";
  host.appendChild(panel);
  let scheduled = false;

  const render = (): void => {
    scheduled = false;
    panel.hidden = !editor.bookmarksOpen;
    if (!editor.bookmarksOpen) return;
    const rows = list.items
      .map(
        (b) => `<li class="bookmark" data-id="${b.id}">
        ${b.thumb ? `<img class="bookmark-thumb" alt="" src="${b.thumb}">` : '<span class="bookmark-thumb"></span>'}
        <span class="bookmark-name" title="Go there. Double-click to rename.">${esc(b.name)}</span>
        <button type="button" class="layer-btn" data-del aria-label="Delete ${esc(b.name)}" title="Delete">${ICONS.x}</button>
      </li>`,
      )
      .join("");
    panel.innerHTML = `
      <header><h2>Bookmarks <span class="layers-count">${list.items.length}</span></h2>
        <span><button type="button" class="layer-btn" data-add aria-label="Add bookmark" title="Save the current view as a bookmark">${ICONS.bookmarkPlus}</button>
        <button type="button" class="layer-btn" data-close aria-label="Hide the Bookmarks panel" title="Hide the Bookmarks panel">${ICONS.x}</button></span></header>
      <ul aria-label="Saved views">${rows || '<li class="layers-empty">Save the current place and zoom to come back to it.</li>'}</ul>`;
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

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-close]")) {
      editor.bookmarksOpen = false;
      editor.changed();
    } else if (t.closest("[data-add]")) {
      void list.add(capture());
    } else if (t.closest("[data-del]")) {
      void list.remove(t.closest<HTMLElement>("li.bookmark")!.dataset["id"]!);
    } else if (t.closest(".bookmark input")) {
      // editing the name
    } else {
      const li = t.closest<HTMLElement>("li.bookmark");
      if (li && !list.go(li.dataset["id"]!)) {
        editor.message = "That bookmark's place no longer exists.";
        editor.changed();
      }
    }
  });

  panel.addEventListener("dblclick", (e) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>(".bookmark-name");
    const li = name?.closest<HTMLElement>("li.bookmark");
    if (!name || !li) return;
    const input = document.createElement("input");
    input.type = "text";
    input.value = name.textContent ?? "";
    input.maxLength = 80;
    input.setAttribute("aria-label", "Bookmark name");
    name.replaceWith(input);
    input.focus();
    input.select();
    const done = (save: boolean): void => {
      if (save) void list.rename(li.dataset["id"]!, input.value);
      else schedule();
    };
    input.addEventListener("keydown", (k) => {
      k.stopPropagation(); // typing a name is not a canvas shortcut
      if (k.key === "Enter") done(true);
      else if (k.key === "Escape") done(false);
    });
    input.addEventListener("blur", () => done(true));
  });
}
