import { ICONS } from "./icons";

export type AppView = "canvas" | "assets" | "settings" | "photocraft";

/**
 * The top-level switch to the Assets view, and the way into the Settings view: the Assets tab here, and the Settings button at the far end of
 * the top right, beside the dock and in every view (`data-view="settings"`, pressed while Settings is open; any button with that attribute opens it). The Canvas view is the
 * navigator's infinity button, the first control (ADR 0079); here no tab is selected while the canvas is open.
 */
export function mountViewSwitch(root: HTMLElement, onSelect: (v: AppView) => void, /** The PhotoCraft tab beside Library (Settings > ArtCraft > PhotoCraft). */ photoCraft = false): (v: AppView) => void {
  root.innerHTML = `
    <div class="view-switch" data-cmd-group="Navigate" role="tablist" aria-label="View">
      <button type="button" role="tab" data-view="assets" data-testid="view-assets" title="Library">${ICONS.images}<span>Library</span></button>
    </div>
    <div class="view-settings" data-cmd-group="Navigate"><button type="button" data-view="settings" data-testid="view-settings" aria-pressed="false" aria-label="Settings" title="Settings">${ICONS.settings}</button></div>`;
  // PhotoCraft's set, after the canvas's (#photocraft-switch): its tab, and its × while it runs
  const pc = photoCraft ? document.getElementById("photocraft-switch") : null;
  if (pc) {
    pc.innerHTML = `<div class="view-switch pc-switch" data-cmd-group="Navigate" role="tablist" aria-label="PhotoCraft"><button type="button" role="tab" data-view="photocraft" data-testid="view-photocraft" aria-label="PhotoCraft" title="PhotoCraft, the photo editor (it keeps running while you are in another view)">${ICONS.photoCraft}</button><button type="button" class="view-close" data-photocraft-close data-testid="photocraft-close" hidden aria-label="Close PhotoCraft (it asks first when something is not saved)" title="Close PhotoCraft">${ICONS.x}</button></div>`;
    // view-state: (which view shows: also the commands go.canvas, go.library and the Settings pages)
    pc.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
      if (t) onSelect("photocraft");
    });
  }
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]'), ...(pc ? [...pc.querySelectorAll<HTMLButtonElement>('[role="tab"]')] : [])];
  const set = (v: AppView): void => {
    // The Settings button is a button of its own at the top right in every view (not one of the buttons of a bar).
    const gear = document.querySelector<HTMLElement>('button[data-view="settings"]');
    const slot = root.querySelector<HTMLElement>(".view-settings");
    if (gear && slot && gear.parentElement !== slot) slot.append(gear);
    for (const b of document.querySelectorAll<HTMLElement>('[data-view="settings"]')) b.setAttribute("aria-pressed", String(v === "settings"));
    for (const t of tabs) {
      const on = t.dataset["view"] === v;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on || (v === "canvas" && t.dataset["view"] === "assets") ? 0 : -1;
    }
  };
  // view-state: (which view shows: also the commands go.canvas, go.library and the Settings pages)
  root.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (t) onSelect(t.dataset["view"] as AppView);
  });
  // view-state: (which view shows: also the commands go.canvas, go.library and the Settings pages)
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
