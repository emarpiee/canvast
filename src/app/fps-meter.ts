/**
 * The frames-per-second counter (the "60 FPS" kind). It counts the browser's own display frames
 * (requestAnimationFrame), so it reads the display rate while the page is responsive and drops when the main thread
 * is busy, whether or not canvast has anything to draw. It runs only while the readout is shown.
 */
export interface FpsReading {
  /** Frames per second over the last second. */
  fps: number;
  /** Average time between display frames (ms). */
  avgMs: number;
  /** Longest time between two display frames in the last second (ms). */
  worstMs: number;
}

export class FpsMeter {
  private readonly stamps: number[] = [];

  /** Call once per display frame with its timestamp (ms). */
  tick(now: number): void {
    this.stamps.push(now);
    while (this.stamps.length > 2 && now - this.stamps[0]! > 1000) this.stamps.shift();
  }

  read(): FpsReading | null {
    const s = this.stamps;
    if (s.length < 2) return null;
    let worst = 0;
    for (let i = 1; i < s.length; i++) worst = Math.max(worst, s[i]! - s[i - 1]!);
    const span = s[s.length - 1]! - s[0]!;
    if (span <= 0) return null;
    return { fps: ((s.length - 1) * 1000) / span, avgMs: span / (s.length - 1), worstMs: worst };
  }

  reset(): void {
    this.stamps.length = 0;
  }
}
