import { ICONS } from "./icons";

export type AppView = "canvas" | "assets" | "settings";

/**
 * The top-level switch to the Assets view, and the way into the Settings view: the Assets tab here, and the Settings button at the far end of
 * the top right, beside the dock and in every view (`data-view="settings"`, pressed while Settings is open; any button with that attribute opens it). The Canvas view is the
 * navigator's infinity button, the first control (ADR 0079); here no tab is selected while the canvas is open.
 */
export function mountViewSwitch(root: HTMLElement, onSelect: (v: AppView) => void): (v: AppView) => void {
  root.innerHTML = `
    <div class="view-switch" data-cmd-group="Navigate" role="tablist" aria-label="View">
      <button type="button" role="tab" data-view="assets" data-testid="view-assets" title="Assets view">${ICONS.images}<span>Assets</span></button>
    </div>
    <div class="view-settings" data-cmd-group="Navigate"><button type="button" data-view="settings" data-testid="view-settings" aria-pressed="false" aria-label="Settings" title="Settings">${ICONS.settings}</button></div>`;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const set = (v: AppView): void => {
    // The Settings button sits at the end of the canvas's bottom-right bar; the other views have no such bar, so it stays at the top right there.
    const gear = document.querySelector<HTMLElement>('button[data-view="settings"]');
    const slot = v === "canvas" ? document.querySelector<HTMLElement>(".hud-controls") : root.querySelector<HTMLElement>(".view-settings");
    if (gear && slot && gear.parentElement !== slot) slot.append(gear);
    for (const b of document.querySelectorAll<HTMLElement>('[data-view="settings"]')) b.setAttribute("aria-pressed", String(v === "settings"));
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
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest('[data-view="settings"]')) onSelect("settings");
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
