import type { ViewState } from "../app/view-state";
import { zoomByStep } from "../interaction/navigation";

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

export function mountDevPanel(root: HTMLElement, view: ViewState): void {
  const panel = document.createElement("div");
  panel.className = "hud-dev";
  panel.dataset["testid"] = "dev-panel";
  panel.innerHTML = `
    <div class="dev-row" role="group" aria-label="Zoom jumps">
      ${JUMPS.map((j) => `<button type="button" data-jump="${j}" title="Zoom ${j > 0 ? "in" : "out"} ${Math.abs(j)} levels (×2^${j})">${label(j)}</button>`).join("")}
    </div>
    <div class="dev-row" role="group" aria-label="Auto-zoom">
      <button type="button" data-auto="-1" title="Auto-zoom out">◀ auto out</button>
      <button type="button" data-auto="1" title="Auto-zoom in">auto in ▶</button>
      <select aria-label="Auto-zoom speed (levels per second)" title="Levels per second">
        ${SPEEDS.map((v) => `<option value="${v}"${v === 10 ? " selected" : ""}>${v} lv/s</option>`).join("")}
      </select>
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
    if (b.dataset["jump"]) {
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
