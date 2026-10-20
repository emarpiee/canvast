/**
 * A tour of the bookmarks (ADR 0116): the bookmarks in order, one view at a time, each reached by a glide. The bars fade out while it
 * runs (the Zen mode, restored after); Right, Space or Page Down go on, Left or Page Up go back, Escape ends it. A small caption names
 * the stop and has the same buttons for touch.
 */
import type { BookmarkList } from "./bookmarks";
import type { ViewState } from "./view-state";
import type { SettingsStore } from "../settings/settings";
import { esc } from "../ui/format";
import { ICONS } from "../ui/icons";

export function mountTour(host: HTMLElement, view: ViewState, list: BookmarkList, settings: SettingsStore): { start(): void; active(): boolean } {
  const caption = document.createElement("div");
  caption.className = "tour-caption";
  caption.dataset["testid"] = "tour-caption";
  caption.setAttribute("role", "status");
  caption.hidden = true;
  host.appendChild(caption);
  let at = -1;
  let zenBefore = false;
  let glideBefore = 0;
  let timer = 0;

  const show = (i: number): void => {
    const items = list.items;
    if (!items.length) return stop();
    at = Math.max(0, Math.min(items.length - 1, i));
    const b = items[at]!;
    view.glideMs = glideBefore > 0 ? Math.max(glideBefore, 900) : 0; // a tour glides slowly enough to follow (or not at all with reduced motion)
    clearTimeout(timer);
    // With a wait set, the tour moves on by itself once the view has arrived (a glide cut short by the person stops it).
    const wait = settings.get("tour.pause") * 1000;
    list.go(b.id, () => {
      if (wait > 0 && at === i && at < items.length - 1) timer = window.setTimeout(() => at === i && show(at + 1), wait);
    });
    caption.innerHTML = `<button type="button" data-prev aria-label="Previous stop"${at === 0 ? " disabled" : ""}>${ICONS.chevronLeft}</button>
      <span class="tour-name">${esc(b.name)}</span><span class="tour-n">${at + 1} / ${items.length}</span>
      <button type="button" data-next aria-label="Next stop"${at === items.length - 1 ? " disabled" : ""}>${ICONS.chevronRight}</button>
      <button type="button" data-end aria-label="End the tour" title="End the tour (Escape)">${ICONS.x}</button>`;
  };
  const stop = (): void => {
    if (at < 0) return;
    at = -1;
    clearTimeout(timer);
    caption.hidden = true;
    view.glideMs = glideBefore;
    if (!zenBefore) void settings.set("ui.zen", false);
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    const go = e.key === "ArrowRight" || e.key === " " || e.key === "PageDown" ? 1 : e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 0;
    if (go) show(at + go);
    else if (e.key === "Escape") stop();
    else return;
    e.preventDefault();
    e.stopPropagation(); // (nothing else reacts to the keys of a tour)
  };
  caption.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    if (b.hasAttribute("data-prev")) show(at - 1);
    else if (b.hasAttribute("data-next")) show(at + 1);
    else stop();
  });
  return {
    active: () => at >= 0,
    start() {
      if (!list.items.length || at >= 0) return;
      zenBefore = settings.get("ui.zen");
      glideBefore = view.glideMs;
      if (!zenBefore) void settings.set("ui.zen", true);
      caption.hidden = false;
      window.addEventListener("keydown", onKey, true);
      show(0);
    },
  };
}
