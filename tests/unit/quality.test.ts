import { describe, expect, it } from "vitest";
import { FAST_P95_MS, FAST_WINDOWS, QualityGovernor, SLOW_P95_MS, SLOW_WINDOWS, WINDOW, nextState } from "../../src/app/quality";
import type { Governor } from "../../src/app/quality";

const frames = (ms: number): number[] => Array.from({ length: WINDOW }, () => ms);
const step = (g: Governor, ms: number, times: number): Governor => Array.from({ length: times }).reduce<Governor>((s) => nextState(s, frames(ms)), g);

describe("adaptive quality (ADR 0028)", () => {
  it("drops after consecutive slow windows, recovers after consecutive comfortable ones, with hysteresis and limits", () => {
    const start: Governor = { level: 0, slow: 0, fast: 0 };
    expect(step(start, SLOW_P95_MS + 5, SLOW_WINDOWS - 1).level).toBe(0); // one slow window is not enough
    expect(step(start, SLOW_P95_MS + 5, SLOW_WINDOWS).level).toBe(1);
    expect(step(start, SLOW_P95_MS + 5, SLOW_WINDOWS * 5).level).toBe(2); // never below the lowest quality
    const mid = step(start, SLOW_P95_MS + 5, SLOW_WINDOWS);
    expect(nextState(step(mid, SLOW_P95_MS + 5, 1), frames(15)).slow, "a middling window resets the count").toBe(0);
    expect(step(mid, FAST_P95_MS - 3, FAST_WINDOWS - 1).level).toBe(1);
    expect(step(mid, FAST_P95_MS - 3, FAST_WINDOWS).level).toBe(0);
    expect(step(start, 1, 50).level, "full quality stays full").toBe(0);
  });

  it("decides on whole windows of frames, and not at all when pinned", () => {
    const seen: number[] = [];
    const g = new QualityGovernor((l) => seen.push(l));
    for (let i = 0; i < WINDOW * SLOW_WINDOWS - 1; i++) g.record(40);
    expect(g.level).toBe(0);
    g.record(40);
    expect(g.level).toBe(1);
    expect(seen).toEqual([1]);
    const pinned = new QualityGovernor(() => seen.push(99));
    pinned.pinned = true;
    for (let i = 0; i < WINDOW * 10; i++) pinned.record(100);
    expect(pinned.level).toBe(0);
  });
});

describe("cooperative index build (ADR 0029)", () => {
  it("inserts every object in slices that let the browser run in between, and stops when a newer build starts", async () => {
    const { fillCooperatively } = await import("../../src/scene/spatial-index");
    const objs = Array.from({ length: 100 }, (_, i) => ({ id: String(i) })) as never[];
    let clock = 0;
    const inserted: unknown[] = [];
    let yields = 0;
    const progress: number[] = [];
    await fillCooperatively(objs, (o) => inserted.push(o), 100, () => true, { budgetMs: 10, now: () => clock++, yieldNow: async () => void yields++, onProgress: (d) => progress.push(d) });
    expect(inserted).toHaveLength(100);
    expect(yields, "several slices, not one long task").toBeGreaterThan(3);
    expect(progress.at(-1)).toBe(100);
    // A newer build began: the older one stops at its next yield.
    const stale: unknown[] = [];
    let alive = true;
    await fillCooperatively(objs, (o) => stale.push(o), 100, () => alive, { budgetMs: 10, now: () => clock++, yieldNow: async () => void (alive = false) });
    expect(stale.length).toBeLessThan(100);
  });
});

describe("frame rate counter", () => {
  it("reads the display rate from frame timestamps over the last second, and the worst gap", async () => {
    const { FpsMeter } = await import("../../src/app/fps-meter");
    const m = new FpsMeter();
    expect(m.read()).toBeNull();
    for (let i = 0; i <= 60; i++) m.tick(1000 + (i * 1000) / 60); // a steady 60 Hz second
    const r = m.read()!;
    expect(r.fps).toBeCloseTo(60, 0);
    expect(r.avgMs).toBeCloseTo(16.67, 1);
    expect(r.worstMs).toBeCloseTo(16.67, 1);
    m.tick(2000 + 120); // the page was blocked for 120 ms
    const slow = m.read()!;
    expect(slow.worstMs).toBeCloseTo(120 + 16.67 - 16.67, 0);
    expect(slow.fps).toBeLessThan(55);
    m.tick(5000); // long idle gap: older frames fall out of the window
    expect(m.read()!.fps).toBeLessThan(1);
  });

  it("keeps recent frame times for the draw-cost figure", async () => {
    const { FrameStats } = await import("../../src/app/frame-stats");
    const s = new FrameStats();
    for (const ms of [4, 5, 6, 7, 40]) s.record(ms);
    expect(s.recent(50, 60)).toBe(6);
    expect(s.recent(95, 2)).toBe(40);
  });
});
