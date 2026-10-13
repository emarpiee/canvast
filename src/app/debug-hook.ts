import * as D from "../core/dyadic";
import {
  deserializeCamera,
  screenToWorld,
  serializeCamera,
  worldToScreen,
} from "../core/camera";
import type { ScreenPoint, SerializedCamera } from "../core/camera";
import { findLandmark } from "../scene/landmarks";
import type { ViewState } from "./view-state";
import type { FrameStats } from "./frame-stats";

/**
 * Inspection API for automated navigation tests and manual diagnosis.
 * Installed only in debug builds or when the page URL hash contains "debug".
 * World coordinates cross this boundary as exact "<mantissa>p<exponent>"
 * strings so tests never see a rounded value.
 */
export interface DebugHook {
  camera(): SerializedCamera;
  setCamera(cam: SerializedCamera): void;
  viewport(): { width: number; height: number };
  worldToScreen(x: string, y: string): ScreenPoint;
  screenToWorld(x: number, y: number): { x: string; y: string };
  landmarkScreen(id: string): ScreenPoint & { sizePx: number };
  frameTimes(): number[];
  resetFrameTimes(): void;
  frameCount(): number;
  nextFrame(): Promise<void>;
  /** Count canvas pixels that differ from the background colour (sampled). */
  inkedPixels(step?: number): number;
}

export function installDebugHook(
  view: ViewState,
  stats: FrameStats,
  canvas: HTMLCanvasElement,
  nextFrame: () => Promise<void>,
): void {
  const hook: DebugHook = {
    camera: () => serializeCamera(view.camera),
    setCamera: (c) => view.setCamera(deserializeCamera(c)),
    viewport: () => ({ ...view.viewport }),
    worldToScreen: (x, y) => worldToScreen(view.camera, view.viewport, { x: D.parse(x), y: D.parse(y) }),
    screenToWorld: (x, y) => {
      const p = screenToWorld(view.camera, view.viewport, { x, y });
      return { x: D.toString(p.x), y: D.toString(p.y) };
    },
    landmarkScreen: (id) => {
      const lm = findLandmark(id);
      if (!lm) throw new Error(`unknown landmark ${id}`);
      const s = worldToScreen(view.camera, view.viewport, lm.center);
      return { ...s, sizePx: 2 ** (lm.sizeExp + view.camera.zi + view.camera.zf) };
    },
    frameTimes: () => stats.snapshot(),
    resetFrameTimes: () => stats.reset(),
    frameCount: () => stats.count,
    nextFrame,
    inkedPixels: (step = 1) => {
      const ctx = canvas.getContext("2d")!;
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      // The background is the most common sampled colour.
      const counts = new Map<number, number>();
      const samples: number[] = [];
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const i = (y * width + x) * 4;
          const rgb = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
          samples.push(rgb);
          counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
        }
      }
      let bg = 0;
      let best = -1;
      for (const [rgb, c] of counts) if (c > best) [bg, best] = [rgb, c];
      const channelDiff = (a: number, b: number): number =>
        Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
      let n = 0;
      for (const rgb of samples) if (channelDiff(rgb, bg) > 6) n++;
      return n;
    },
  };
  (window as unknown as { __canvastDebug: DebugHook }).__canvastDebug = hook;
}
