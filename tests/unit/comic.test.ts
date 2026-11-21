import { describe, expect, it } from "vitest";
import { area2, gutterAt, insidePoly, layoutPanels, mergePanels, moveGutter, splitPanel, widenGutters } from "../../src/doc/comic";
import type { Pt } from "../../src/doc/comic";

const box = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const r = (v: number): number => Math.round(v * 1e6) / 1e6; // (a cut's corners are where lines meet: a few bits off)
const bounds = (p: readonly Pt[]) => ({ minX: r(Math.min(...p.map((q) => q[0]))), maxX: r(Math.max(...p.map((q) => q[0]))), minY: r(Math.min(...p.map((q) => q[1]))), maxY: r(Math.max(...p.map((q) => q[1]))) });

describe("comic page panels (ADR 0206)", () => {
  it("a cut across a panel makes two, the gutter between them, each the panel's turn; a cut that misses or leaves a sliver makes none", () => {
    const [a, b] = splitPanel(box(0, 0, 100, 60), [50, -10], [50, 70], 10, 1)!;
    expect(bounds(a).minX === 55 || bounds(b).minX === 55).toBe(true);
    const left = bounds(a).maxX === 45 ? a : b, right = left === a ? b : a;
    expect(bounds(left)).toEqual({ minX: 0, maxX: 45, minY: 0, maxY: 60 });
    expect(bounds(right)).toEqual({ minX: 55, maxX: 100, minY: 0, maxY: 60 });
    expect(Math.sign(area2(left))).toBe(Math.sign(area2(box(0, 0, 1, 1))));
    expect(splitPanel(box(0, 0, 100, 60), [200, 0], [200, 60], 10, 1)).toBeNull();
    expect(splitPanel(box(0, 0, 100, 60), [1, 0], [1, 60], 0, 5)).toBeNull();
    // slanted: both parts keep the line's lean
    expect(splitPanel(box(0, 0, 100, 60), [40, 0], [60, 60], 4, 1)).not.toBeNull();
  });

  it("a gutter is found between facing edges, with every panel along it (one above, two below), and moved as one", () => {
    const panels = [box(0, 0, 100, 40), box(0, 50, 45, 50), box(55, 50, 45, 50)];
    const g = gutterAt(panels, [70, 45], 20)!;
    expect(g.width).toBeCloseTo(10);
    expect(g.a.length + g.b.length).toBe(3);
    const moved = moveGutter(panels, g, g.ny > 0 ? 10 : -10, 1)!;
    expect(bounds(moved[0]!).maxY).toBe(50);
    expect(bounds(moved[1]!).minY).toBe(60);
    expect(bounds(moved[2]!).minY).toBe(60);
    // the vertical gutter below: only the two lower panels
    const v = gutterAt(panels, [50, 80], 20)!;
    expect(v.a.length + v.b.length).toBe(2);
    expect(gutterAt(panels, [20, 20], 20), "inside a panel: no gutter").toBeNull();
    // too far: a panel would fold
    expect(moveGutter(panels, g, g.ny > 0 ? 200 : -200, 1)).toBeNull();
  });

  it("two panels merge into the outline round both; gutters widen by half on each side; a layout fills the page inside its margin", () => {
    const m = mergePanels(box(0, 0, 45, 60), box(55, 0, 45, 60));
    expect(bounds(m)).toEqual({ minX: 0, maxX: 100, minY: 0, maxY: 60 });
    expect(insidePoly(m, [50, 30])).toBe(true);
    const wide = widenGutters([box(0, 0, 45, 60), box(55, 0, 45, 60)], 10, 6, 1)!;
    expect(bounds(wide[0]!).maxX).toBe(42);
    expect(bounds(wide[1]!).minX).toBe(58);
    expect(bounds(wide[0]!).minX, "the page's edge stays").toBe(0);
    const l = layoutPanels(200, 300, 10, 6, [[1], [1, 1]]);
    expect(l).toHaveLength(3);
    expect(bounds(l[0]!)).toEqual({ minX: 10, maxX: 190, minY: 10, maxY: 147 });
    expect(bounds(l[2]!).maxX).toBe(190);
  });
});
