import { desktopBridge } from "../storage/desktop-bridge";
import type { SettingsStore } from "../settings/settings";
import { ICONS } from "./icons";
import { onModalChange } from "./modal";

declare const __CANVAST_VERSION__: string;

/** How long the row stays after the pointer has gone, and at the start, so that it is seen once. */
const HIDE_AFTER_MS = 150;
const SHOW_AT_START_MS = 3000;
/** How near the top of the window the pointer brings the row. */
const REACH_PX = 8;

/**
 * The desktop window with no frame (Settings > Appearance > Window frame): a row with the window's name and its buttons, floating over the top of the app, which comes
 * when the pointer reaches the very top edge and goes when it leaves. It takes no room from anything, and only while it shows is there a place that moves the window:
 * a drag area takes every click over it. Over a drag area the page gets no pointer events, so the row goes by where the pointer is next seen, below it.
 * It is there from the first moment and above everything: a modal makes all outside itself inert, so the row moves into the newest modal, in the top layer so that
 * nothing of the modal's look reaches it. In front of a modal that cannot be closed (the start, the lock and the busy screens) it stays, so that the workspace's name
 * and the window's buttons are never out of reach, and it goes only after them.
 */
export async function mountWindowRow(): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return;
  if ((await bridge.frame()).window !== "off") return;
  const workspace = await bridge.workspace();
  const edge = document.createElement("div");
  edge.className = "win-edge";
  edge.dataset["testid"] = "win-edge";
  edge.popover = "manual";
  const row = document.createElement("div");
  row.className = "win-row";
  row.dataset["testid"] = "win-row";
  row.popover = "manual";
  row.innerHTML = `
    <span class="win-title"></span>
    <button type="button" data-win="minimize" data-testid="win-minimize" aria-label="Minimize the window" title="Minimize">${ICONS.minimize2}</button>
    <button type="button" data-win="maximize" data-testid="win-maximize" aria-label="Maximize or restore the window" title="Maximize or restore">${ICONS.maximize2}</button>
    <button type="button" data-win="close" data-testid="win-close" aria-label="Close the window" title="Close">${ICONS.x}</button>`;
  row.querySelector(".win-title")!.textContent = `${workspace?.name ?? ""} — canvast ${__CANVAST_VERSION__}`;
  row.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-win]")?.dataset["win"];
    if (act === "minimize" || act === "maximize" || act === "close") bridge.windowAct(act);
  });
  let timer = 0;
  let heldUntil = 0;
  let pinned = false;
  const show = (): void => {
    clearTimeout(timer);
    timer = 0;
    row.classList.add("is-shown");
  };
  /** (a timer already running is left alone: a pointer still moving does not put the row's going off) */
  const hideSoon = (ms = HIDE_AFTER_MS): void => {
    if (timer || pinned) return;
    timer = window.setTimeout(() => {
      timer = 0;
      row.classList.remove("is-shown");
    }, ms);
  };
  edge.addEventListener("pointerenter", show);
  // (a finger has no way of leaving: the row goes by itself)
  edge.addEventListener("pointerdown", (e) => void (e.pointerType !== "mouse" && (show(), (heldUntil = Date.now() + SHOW_AT_START_MS), hideSoon(SHOW_AT_START_MS))));
  document.addEventListener("pointermove", (e) => {
    if (!row.classList.contains("is-shown")) {
      if (e.clientY <= REACH_PX) show(); // (also with something drawn over the edge)
      return;
    }
    if (e.clientY <= row.getBoundingClientRect().bottom) {
      if (Date.now() >= heldUntil) show();
    } else if (!row.matches(":has(:focus-visible)") && Date.now() >= heldUntil) hideSoon(); // (a button reached by Tab keeps it; one clicked does not)
  }, { passive: true });
  // The pointer gone out of the window: over the top, which a quick move does without ever being seen at the edge, the row comes; anywhere else it goes.
  document.documentElement.addEventListener("mouseleave", (e) => {
    if (e.clientY <= REACH_PX) show();
    else if (Date.now() >= heldUntil) hideSoon();
  });
  const showForAMoment = (): void => {
    show();
    heldUntil = Date.now() + SHOW_AT_START_MS;
    hideSoon(SHOW_AT_START_MS);
  };
  const place = (): void => {
    const top = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1);
    const host = top ?? document.body;
    if (row.parentElement !== host) host.append(edge, row);
    for (const part of [edge, row]) if (!part.matches(":popover-open")) part.showPopover();
    const held = top?.dataset["locked"] !== undefined;
    if (held === pinned) return;
    pinned = held;
    if (held) show();
    else showForAMoment();
  };
  onModalChange(place);
  place();
  if (!pinned) showForAMoment();
}

/** The saved choice is the desktop's, for every workspace: the setting shows it. It applies at the next start. */
export async function followFrameSetting(settings: SettingsStore): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return;
  const { saved } = await bridge.frame();
  if (settings.get("ui.frame") !== saved) settings.set("ui.frame", saved);
  settings.subscribe((key) => void (key === "ui.frame" && bridge.setFrame(settings.get("ui.frame"))));
}
