import { ICONS } from "./icons";

export type AppView = "canvas" | "assets" | "settings";

/**
 * The top-level switch to the Assets view and the Settings view: two buttons that act as tabs (Left and Right move between them, as in
 * a tab list). The Canvas view is the navigator's pill, the first control, which names the open board and canvas (ADR 0079); here no tab
 * is selected while the canvas is open.
 */
export function mountViewSwitch(root: HTMLElement, onSelect: (v: AppView) => void): (v: AppView) => void {
  root.innerHTML = `
    <div class="view-switch" role="tablist" aria-label="View">
      <button type="button" role="tab" data-view="assets" data-testid="view-assets" title="Assets view">${ICONS.images}<span>Assets</span></button>
      <button type="button" role="tab" data-view="settings" data-testid="view-settings" title="Settings">${ICONS.settings}<span>Settings</span></button>
    </div>`;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const set = (v: AppView): void => {
    for (const t of tabs) {
      const on = t.dataset["view"] === v;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on || (v === "canvas" && t.dataset["view"] === "assets") ? 0 : -1;
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
    next.focus(); // the view that opens may take focus; the arrow keys stay on the tab list, as in any tab list
    e.preventDefault();
    e.stopPropagation();
  });
  return set;
}
