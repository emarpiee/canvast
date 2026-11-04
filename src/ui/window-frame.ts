import { desktopBridge } from "../storage/desktop-bridge";
import type { SettingsStore } from "../settings/settings";
import { ICONS } from "./icons";

/** How long the row stays after the pointer has gone, and at the start, so that it is seen once. */
const HIDE_AFTER_MS = 500;
const SHOW_AT_START_MS = 3000;

/**
 * The desktop window with no frame (Settings > Appearance > Window frame): a row with the window's name and its buttons, floating over the top of the app, which comes
 * when the pointer reaches the very top edge and goes when it leaves. It takes no room from anything, and only while it shows is there a place that moves the window:
 * a drag area takes every click over it. Over a drag area the page gets no pointer events, so the row goes by where the pointer is next seen, below it.
 * The saved choice is the desktop's, for every workspace: the setting shows it.
 */
export async function mountWindowFrame(settings: SettingsStore): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return;
  const { saved, window: now } = await bridge.frame();
  if (settings.get("ui.frame") !== saved) settings.set("ui.frame", saved);
  settings.subscribe((key) => void (key === "ui.frame" && bridge.setFrame(settings.get("ui.frame"))));
  if (now !== "off") return;
  const place = await bridge.workspace();
  const edge = document.createElement("div");
  edge.className = "win-edge";
  edge.dataset["testid"] = "win-edge";
  const row = document.createElement("div");
  row.className = "win-row";
  row.dataset["testid"] = "win-row";
  row.innerHTML = `
    <span class="win-title"></span>
    <button type="button" data-win="minimize" data-testid="win-minimize" aria-label="Minimize the window" title="Minimize">${ICONS.minimize2}</button>
    <button type="button" data-win="maximize" data-testid="win-maximize" aria-label="Maximize or restore the window" title="Maximize or restore">${ICONS.maximize2}</button>
    <button type="button" data-win="close" data-testid="win-close" aria-label="Close the window" title="Close">${ICONS.x}</button>`;
  row.querySelector(".win-title")!.textContent = `${place?.name ?? ""} — canvast ${document.documentElement.dataset["version"] ?? ""}`;
  row.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-win]")?.dataset["win"];
    if (act === "minimize" || act === "maximize" || act === "close") bridge.windowAct(act);
  });
  let timer = 0;
  const show = (): void => {
    clearTimeout(timer);
    row.classList.add("is-shown");
  };
  const hideSoon = (ms = HIDE_AFTER_MS): void => {
    clearTimeout(timer);
    timer = window.setTimeout(() => row.classList.remove("is-shown"), ms);
  };
  edge.addEventListener("pointerenter", show);
  // (a finger has no way of leaving: the row goes by itself)
  edge.addEventListener("pointerdown", (e) => void (e.pointerType !== "mouse" && (show(), hideSoon(SHOW_AT_START_MS))));
  document.addEventListener("pointermove", (e) => {
    if (!row.classList.contains("is-shown")) return;
    if (e.clientY <= row.getBoundingClientRect().bottom) show();
    else if (!row.matches(":focus-within")) hideSoon();
  }, { passive: true });
  document.body.append(edge, row);
  show();
  hideSoon(SHOW_AT_START_MS);
}
