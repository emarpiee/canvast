/**
 * Adaptive quality (ADR 0028). The governor watches how long frames take and
 * trades picture quality for speed when they run over budget, and gives it back
 * when there is room: input stays responsive on a slow machine or a 4K screen,
 * and a fast one never loses anything.
 *
 * Level 0 is full quality. Level 1 caps the canvas resolution at 1.5 device
 * pixels per CSS px and shows the zoom preview of the tile cache for cheaper
 * scenes. Level 2 caps it at 1 and prefers the preview even more. The decision
 * is made on whole windows of frames, with hysteresis, so it never flaps.
 */
export type QualityLevel = 0 | 1 | 2;

/** Highest device pixel ratio the canvas is drawn at, per level. */
export const DPR_CAP: Record<QualityLevel, number> = { 0: Infinity, 1: 1.5, 2: 1 };
/** Frame time (ms) above which the tile cache treats a scene as dense and shows a zoom preview, per level. */
export const DENSE_MS: Record<QualityLevel, number> = { 0: 12, 1: 6, 2: 3 };

/** Frames per decision. */
export const WINDOW = 60;
/** 95th percentile over a window above this (a 60 Hz frame is 16.7 ms) counts as slow. */
export const SLOW_P95_MS = 24;
/** ...and below this as comfortable. */
export const FAST_P95_MS = 10;
/** Slow windows in a row before quality drops; comfortable windows in a row before it comes back. */
export const SLOW_WINDOWS = 2;
export const FAST_WINDOWS = 4;

export interface Governor {
  level: QualityLevel;
  slow: number;
  fast: number;
}

export const p95 = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0;
};

/** The state after one full window of frame times (pure: tested without a browser). */
export function nextState(g: Governor, window: readonly number[]): Governor {
  const t = p95(window);
  if (t > SLOW_P95_MS) {
    const slow = g.slow + 1;
    return slow >= SLOW_WINDOWS && g.level < 2 ? { level: (g.level + 1) as QualityLevel, slow: 0, fast: 0 } : { ...g, slow, fast: 0 };
  }
  if (t < FAST_P95_MS) {
    const fast = g.fast + 1;
    return fast >= FAST_WINDOWS && g.level > 0 ? { level: (g.level - 1) as QualityLevel, slow: 0, fast: 0 } : { ...g, slow: 0, fast };
  }
  return { ...g, slow: 0, fast: 0 };
}

export class QualityGovernor {
  private state: Governor = { level: 0, slow: 0, fast: 0 };
  private frames: number[] = [];
  /** `pinned`: level held at 0 whatever the frame times say (a setting). */
  pinned = false;

  constructor(private readonly onChange: (level: QualityLevel) => void) {}

  get level(): QualityLevel {
    return this.state.level;
  }

  /** Record one frame's time; applies a decision after every WINDOW frames. */
  record(ms: number): void {
    if (this.pinned) return;
    this.frames.push(ms);
    if (this.frames.length < WINDOW) return;
    const next = nextState(this.state, this.frames);
    this.frames = [];
    const changed = next.level !== this.state.level;
    this.state = next;
    if (changed) this.onChange(next.level);
  }

  /** Set the level directly (tests, or the pin going on). */
  force(level: QualityLevel): void {
    this.state = { level, slow: 0, fast: 0 };
    this.frames = [];
    this.onChange(level);
  }
}
