import { deserializeFrameCamera } from "../core/frames";
import type { FrameCamera, FrameSpace } from "../core/frames";
import type { Bookmark } from "../storage/bookmarks";
import { captureThumb } from "./bookmarks";

/**
 * Update the pictures of bookmarks (ADR 0124). The canvas visits each place in turn, waits until the pictures that place needs have been
 * decoded, takes a clean small picture of it (no selection outlines) and goes on; at the end the view goes back where it was and every new
 * picture is written at once. It is one place at a time and a frame or two each, so a dozen bookmarks take about a second, and nothing
 * runs unless it is asked for. While it runs a veil covers the page (Escape stops it).
 */
export interface ThumbJob {
  bookmarks: readonly Bookmark[];
  space: FrameSpace;
  canvas: HTMLCanvasElement;
  getCamera(): FrameCamera;
  setCamera(fc: FrameCamera): void;
  /** Draw the canvas now, clean (no selection outlines, the pattern as it is). */
  renderClean(): void;
  /** Whether nothing is still being decoded for the canvas. */
  assetsIdle(): boolean;
  /** Camera moves are not to be remembered while this is on. */
  hold(on: boolean): void;
  /** The new pictures are ready to be written. */
  save(thumbs: ReadonlyMap<string, string>): Promise<void>;
  say(text: string): void;
  /** Redraw the canvas normally. */
  redraw(): void;
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const MAX_WAIT_MS = 2500;

/** Wait until the canvas has drawn the new place with its pictures (the decode queue idle for a few frames), or give up after a while. */
async function settled(job: ThumbJob): Promise<void> {
  const t0 = performance.now();
  let calm = 0;
  while (performance.now() - t0 < MAX_WAIT_MS && calm < 3) {
    await nextFrame();
    calm = job.assetsIdle() ? calm + 1 : 0;
  }
}

export interface ThumbResult {
  done: number;
  failed: number;
  stopped: boolean;
}

export async function updateThumbs(job: ThumbJob): Promise<ThumbResult> {
  const home = job.getCamera();
  const veil = document.createElement("div");
  veil.className = "thumb-veil";
  veil.dataset["testid"] = "thumb-veil";
  veil.setAttribute("role", "status");
  const text = document.createElement("p");
  veil.append(text);
  document.body.appendChild(veil);
  let stopped = false;
  const key = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      stopped = true;
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener("keydown", key, true);
  veil.addEventListener("click", () => (stopped = true));
  job.hold(true);
  const out = new Map<string, string>();
  let failed = 0;
  try {
    for (const [i, b] of job.bookmarks.entries()) {
      if (stopped) break;
      text.textContent = `Updating the bookmark pictures: ${i + 1} of ${job.bookmarks.length} · press Escape to stop`;
      let fc: FrameCamera;
      try {
        fc = deserializeFrameCamera(job.space, b.view);
      } catch {
        failed++; // its place no longer exists
        continue;
      }
      job.setCamera(fc);
        await settled(job);
      job.renderClean();
      const thumb = captureThumb(job.canvas);
      if (thumb) out.set(b.id, thumb);
      else failed++;
    }
  } finally {
    job.setCamera(home);
    job.hold(false);
    window.removeEventListener("keydown", key, true);
    veil.remove();
    job.redraw();
  }
  await job.save(out);
  job.say(`${out.size} bookmark picture${out.size === 1 ? "" : "s"} updated${failed ? `; ${failed} could not be (the place is gone)` : ""}${stopped ? " (stopped early)" : ""}.`);
  return { done: out.size, failed, stopped };
}
