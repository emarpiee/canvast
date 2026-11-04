import { desktopBridge } from "../storage/desktop-bridge";
import type { SettingsStore } from "../settings/settings";
import { ICONS } from "./icons";

/**
 * The desktop window with no frame (Settings > Appearance > Window frame): minimise, maximise and close at the top right, and what the window moves by: a strip along
 * the top edge and a grip beside the buttons (`-webkit-app-region` in the stylesheet). The saved choice is the desktop's, for every workspace: the setting shows it.
 */
export async function mountWindowFrame(settings: SettingsStore): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return;
  const { saved, window: now } = await bridge.frame();
  if (settings.get("ui.frame") !== saved) settings.set("ui.frame", saved);
  settings.subscribe((key) => void (key === "ui.frame" && bridge.setFrame(settings.get("ui.frame"))));
  if (now !== "off") return;
  document.documentElement.dataset["frame"] = "off";
  const strip = document.createElement("div");
  strip.className = "win-strip";
  const controls = document.createElement("div");
  controls.className = "win-controls";
  controls.innerHTML = `
    <span class="win-grip" data-testid="win-grip" title="Drag to move the window" aria-hidden="true">${ICONS.gripHorizontal}</span>
    <button type="button" data-win="minimize" data-testid="win-minimize" aria-label="Minimize the window" title="Minimize">${ICONS.minimize2}</button>
    <button type="button" data-win="maximize" data-testid="win-maximize" aria-label="Maximize or restore the window" title="Maximize or restore">${ICONS.maximize2}</button>
    <button type="button" data-win="close" data-testid="win-close" aria-label="Close the window" title="Close">${ICONS.x}</button>`;
  controls.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-win]")?.dataset["win"];
    if (act === "minimize" || act === "maximize" || act === "close") bridge.windowAct(act);
  });
  document.body.append(strip, controls);
}
