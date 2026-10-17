import type { EditorState } from "../app/editor-state";
import type { BookmarkList } from "../app/bookmarks";
import { esc } from "./format";
import { ICONS } from "./icons";
import { moreButton, openMoreMenu } from "./more-menu";

/**
 * Floating Bookmarks panel (ADR 0025, 0065): named places on the canvas, each a card with its picture. Add saves the current view with
 * a small picture; a click on the card goes there; each card has Rename (or double-click the name), Update (the bookmark now points at
 * the view as it is, with a fresh picture) and Delete. Hidden by default, like the Layers panel. Built for touch too: the buttons are
 * large, always shown on a touch screen, and the card never needs hover.
 */
export function mountBookmarksPanel(host: HTMLElement, editor: EditorState, list: BookmarkList, capture: () => string | undefined, tour: () => void = () => undefined): void {
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
    const rows = list.items
      .map(
        (b) => `<li class="bookmark" data-id="${b.id}">
        <div class="bookmark-go" role="button" tabindex="0" aria-label="Go to ${esc(b.name)}" title="Go there">
          ${b.thumb ? `<img class="bookmark-thumb" alt="" src="${b.thumb}">` : '<span class="bookmark-thumb"></span>'}
          <span class="bookmark-text"><span class="bookmark-name" title="Double-click to rename">${esc(b.name)}</span><span class="bookmark-meta">${esc(when(b.at))}</span></span>
        </div>
        ${moreButton(`More actions for bookmark ${b.name}`, "data-bm-more")}
      </li>`,
      )
      .join("");
    panel.innerHTML = `
      <header><h2>Bookmarks <span class="layers-count">${list.items.length}</span></h2>
        <span class="layers-tools"><button type="button" class="layer-btn" data-tour aria-label="Play the bookmarks as a tour" title="Play the bookmarks as a tour: Right and Left step, Escape ends it"${list.items.length ? "" : " disabled"}>${ICONS.projector}</button><button type="button" class="layer-btn" data-add aria-label="Add bookmark" title="Save the current view as a bookmark">${ICONS.bookmarkPlus}</button>
        <button type="button" class="layer-btn" data-close aria-label="Hide the Bookmarks panel" title="Hide the Bookmarks panel">${ICONS.x}</button></span></header>
      <ul aria-label="Saved views">${rows || `<li class="layers-empty">No bookmarks yet. Move to a place and zoom, then press ${ICONS.bookmarkPlus} to come back to it any time.</li>`}</ul>`;
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
    } else if (t.closest("[data-add]")) {
      void list.add(capture());
    } else if (li && t.closest("[data-bm-more]")) {
      const id = li.dataset["id"]!;
      const name = li.querySelector(".bookmark-name")?.textContent ?? "bookmark";
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
}
