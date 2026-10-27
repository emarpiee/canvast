import { describe, expect, it } from "vitest";
import { itemsIn, justifiedLayout, listLayout, MIN_CARD_W, nearestInRow, rowOf, squaresLayout } from "../../src/ui/library-layout";

describe("library layout", () => {
  it("fills every full row to the width at one height, leaves the last row at the thumbnail height, and never goes below the narrowest card", () => {
    const ratios = [1, 1.5, 0.5, 2, 1, 1, 3, 0.4, 1.2];
    const l = justifiedLayout(ratios, 500, 100, 8);
    expect(l.boxes).toHaveLength(ratios.length);
    for (const r of l.rows.slice(0, -1)) {
      const row = l.boxes.slice(r.start, r.end);
      const last = row[row.length - 1]!;
      expect(last.x + last.w).toBeCloseTo(500, 6);
      for (const b of row) expect(b.h).toBeCloseTo(r.h, 6);
    }
    const last = l.rows[l.rows.length - 1]!;
    for (let k = last.start; k < last.end; k++) {
      expect(l.boxes[k]!.h).toBe(100);
      expect(l.boxes[k]!.w).toBeCloseTo(Math.max(MIN_CARD_W, ratios[k]! * 100), 6);
    }
    // A picture wider than the view alone is shrunk to it.
    expect(justifiedLayout([20], 300, 100, 8).boxes[0]!.w).toBe(300);
    const bottom = l.rows[l.rows.length - 1]!;
    expect(l.height).toBeCloseTo(bottom.y + bottom.h, 6);
  });

  it("finds the items in view, the row of an item and the nearest card above or below, in all three layouts", () => {
    const sq = squaresLayout(10, 320, 100, 10);
    expect(sq.rows[0]!.end - sq.rows[0]!.start).toBe(3);
    expect(itemsIn(sq, 0, 50)).toEqual([0, 3]);
    expect(itemsIn(sq, 150, 250)).toEqual([3, 9]);
    expect(itemsIn(sq, 5000, 6000)).toEqual([0, 0]);
    expect(rowOf(sq, 7)).toBe(2);
    expect(nearestInRow(sq, 1, sq.boxes[2]!.x + 1)).toBe(5);
    const list = listLayout(1000, 400, 46, 4);
    expect(itemsIn(list, 50 * 500, 50 * 500 + 100)).toEqual([500, 503]);
    expect(list.height).toBe(1000 * 50 - 4);
    const j = justifiedLayout(Array.from({ length: 5000 }, (_, i) => 0.5 + (i % 7) / 3), 1200, 144, 8);
    const [a, b] = itemsIn(j, j.height / 2, j.height / 2 + 900);
    expect(a).toBeGreaterThan(0);
    for (let k = a; k < b; k++) expect(j.boxes[k]!.y + j.boxes[k]!.h).toBeGreaterThanOrEqual(j.height / 2);
    expect(j.boxes[a - 1]!.y + j.boxes[a - 1]!.h).toBeLessThan(j.height / 2);
  });
});
