import { ICONS } from "./icons";

export type AppView = "canvas" | "assets" | "settings";

/**
 * The top-level switch between Canvas view and Assets view: three buttons
 * that act as tabs. Left/Right arrows move between them, as in a tab list.
 */
export function mountViewSwitch(root: HTMLElement, onSelect: (v: AppView) => void): (v: AppView) => void {
  root.innerHTML = `
    <div class="view-switch" role="tablist" aria-label="View">
      <button type="button" role="tab" data-view="canvas" data-testid="view-canvas" title="Canvas view">${ICONS.infinity}<span>Canvas</span></button>
      <button type="button" role="tab" data-view="assets" data-testid="view-assets" title="Assets view">${ICONS.images}<span>Assets</span></button>
      <button type="button" role="tab" data-view="settings" data-testid="view-settings" title="Settings">${ICONS.settings}<span>Settings</span></button>
    </div>`;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const set = (v: AppView): void => {
    for (const t of tabs) {
      const on = t.dataset["view"] === v;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    }
  };
  root.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (t) onSelect(t.dataset["view"] as AppView);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = tabs.findIndex((t) => t === document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    next.focus();
    onSelect(next.dataset["view"] as AppView);
    e.preventDefault();
    e.stopPropagation();
  });
  return set;
}
