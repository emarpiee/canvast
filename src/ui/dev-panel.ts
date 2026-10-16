import type { ViewState } from "../app/view-state";
import { zoomByStep } from "../interaction/navigation";
import type { DocumentStore } from "../doc/document-store";
import type { Notice } from "./notices";
import { ICONS } from "./icons";

/**
 * Developer navigation panel (shown only with #debug): fixed-size zoom jumps
 * and continuous auto-zoom about the viewport centre, for exploring extreme
 * depths without holding keys. Auto-zoom keeps running while you draw or
 * edit; it stops with its own button, the mouse wheel, or Escape.
 */
const JUMPS = [-1e12, -1e9, -1e6, -1000, -100, -10, 10, 100, 1000, 1e6, 1e9, 1e12] as const;
const label = (j: number): string => {
  const a = Math.abs(j);
  return `${j > 0 ? "+" : "−"}${a >= 1e6 ? `1e${Math.log10(a)}` : a}`;
};
const SPEEDS = [1, 10, 100, 1000] as const;

/** Sample notices, one set per kind, for trying how each looks and behaves (the Notice button). */
const SAMPLES: ReadonlyArray<Notice> = [
  { kind: "info", text: "Zoom 3,000 levels in. The view is saved with the canvas." },
  { kind: "info", text: "Bookmark updated to this view." },
  { kind: "success", text: "Imported 12 files." },
  { kind: "success", text: "Exported “Board 1” (4.2 MB)." },
  { kind: "warning", text: "Read-only: another tab is editing this workspace." },
  { kind: "warning", text: "Select at least 3 items to distribute." },
  { kind: "error", text: "Could not save: the browser refused to write (storage full?)." },
  { kind: "error", text: "Import failed: “scene.png” is not a picture the browser can read." },
];

/**
 * `onCleared`: called after the canvas was cleared (to drop the selection). `notify`: show a notice (for the Notice buttons).
 */
export function mountDevPanel(root: HTMLElement, view: ViewState, doc: DocumentStore, onCleared: () => void, notify: (n: Notice) => void): void {
  const panel = document.createElement("div");
  panel.className = "hud-dev";
  panel.dataset["testid"] = "dev-panel";
  panel.innerHTML = `
    <div class="dev-row dev-jumps" role="group" aria-label="Zoom jumps">
      ${JUMPS.map((j) => `<button type="button" data-jump="${j}" title="Zoom ${j > 0 ? "in" : "out"} ${Math.abs(j)} levels (×2^${j})">${label(j)}</button>`).join("")}
    </div>
    <div class="dev-row" role="group" aria-label="Auto-zoom">
      <button type="button" data-auto="-1" title="Auto-zoom out">◀ auto out</button>
      <button type="button" data-auto="1" title="Auto-zoom in">auto in ▶</button>
      <select aria-label="Auto-zoom speed (levels per second)" title="Levels per second">
        ${SPEEDS.map((v) => `<option value="${v}"${v === 10 ? " selected" : ""}>${v} lv/s</option>`).join("")}
      </select>
      <button type="button" data-clear aria-label="Clear canvas" title="Clear canvas: delete every object on this canvas (Ctrl+Z brings them back)">Clear</button>
      <button type="button" data-notice aria-label="Show a sample notice" title="Show one random notice (info, success, warning, error or progress). Shift: four at once, to see the stack.">${ICONS.bell}</button>
    </div>`;
  root.appendChild(panel);
  const select = panel.querySelector("select")!;

  let dir = 0;
  let last = 0;
  let raf = 0;
  const autoButtons = [...panel.querySelectorAll<HTMLButtonElement>("[data-auto]")];
  const render = (): void => {
    for (const b of autoButtons) b.setAttribute("aria-pressed", String(Number(b.dataset["auto"]) === dir));
  };
  const stop = (): void => {
    dir = 0;
    cancelAnimationFrame(raf);
    render();
  };
  const tick = (t: number): void => {
    if (!dir) return;
    const dt = Math.min(0.1, (t - last) / 1000); // cap after a stalled frame
    last = t;
    view.zoomBy(dir * Number(select.value) * dt);
    raf = requestAnimationFrame(tick);
  };

  panel.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    if (b.dataset["notice"] !== undefined) {
      const pick = (): Notice => {
        // One in six is a progress notice, at a random point, so the bar and the spinner are seen too.
        if (Math.random() < 1 / 6) return { kind: "progress", text: "Importing 7 of 12 files", progress: Math.random(), channel: "dev" };
        return SAMPLES[Math.floor(Math.random() * SAMPLES.length)]!;
      };
      for (let n = (e as MouseEvent).shiftKey ? 4 : 1; n > 0; n--) notify(pick());
    } else if (b.dataset["clear"] !== undefined) {
      // One undoable transaction, saved like any edit.
      const ids = [...doc.all()].map((o) => o.id);
      if (ids.length) doc.commit(doc.transaction("Clear canvas", [], ids));
      onCleared();
    } else if (b.dataset["jump"]) {
      stop();
      zoomByStep(view, Number(b.dataset["jump"]));
    } else if (b.dataset["auto"]) {
      const d = Number(b.dataset["auto"]);
      if (dir === d) {
        stop();
        return;
      }
      dir = d;
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
      render();
    }
  });
  // The wheel (a manual zoom) and Escape stop auto-zoom; drawing and tool keys do not.
  window.addEventListener("wheel", (e) => dir && !panel.contains(e.target as Node) && stop(), { capture: true });
  window.addEventListener("keydown", (e) => e.key === "Escape" && dir && stop(), { capture: true });
  render();
}
