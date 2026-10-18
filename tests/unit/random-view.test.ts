import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { fromAbsoluteCamera } from "../../src/core/frames";
import { HOME } from "../../src/core/camera";
import { DocumentStore } from "../../src/doc/document-store";
import type { PathObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";
import { rectSubs } from "../../src/doc/path";
import { FrameIndex } from "../../src/scene/frame-index";
import { OFFSET_RANGE, ZOOM_RANGE, randomEmptyView, randomPlace, viewIsEmpty } from "../../src/interaction/random-view";

const lcg = (seed: number) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
};
const vp = { width: 800, height: 600 };

describe("random empty view (the dice)", () => {
  const doc = new DocumentStore();
  const box: PathObject = { id: newObjectId(), kind: "path", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: rectSubs(0, 0, 200, 100), fill: "#2563eb", stroke: null, width: 2 };
  const index = new FrameIndex(() => doc.space);
  index.insert(box);
  const empty = viewIsEmpty(index, vp);

  it("a view on the content, or next to it, is not empty; one far away is", () => {
    expect(empty(fromAbsoluteCamera(doc.space, HOME.center, 0))).toBe(false);
    expect(empty(fromAbsoluteCamera(doc.space, { x: D.fromNumber(1400), y: D.fromNumber(50) }, 0)), "within two windows of it").toBe(false);
    expect(empty(fromAbsoluteCamera(doc.space, { x: D.fromNumber(1e6), y: D.fromNumber(50) }, 0))).toBe(true);
  });
  it("every pick is empty, within the zoom and offset limits, and different picks differ", () => {
    const rand = lcg(7);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const fc = randomEmptyView(doc.space, empty, rand)!;
      expect(fc).not.toBeNull();
      expect(empty(fc)).toBe(true);
      expect(fc.z).toBeGreaterThanOrEqual(-8);
      seen.add(`${fc.x.m}/${fc.x.e}|${fc.y.m}/${fc.y.e}|${fc.z.toFixed(3)}`);
    }
    expect(seen.size).toBeGreaterThan(35);
  });
  it("places stay inside the limits; a canvas with no empty place gives null", () => {
    const rand = lcg(3);
    for (let i = 0; i < 200; i++) {
      const p = randomPlace(rand);
      expect(p.z).toBeGreaterThanOrEqual(ZOOM_RANGE[0]);
      expect(p.z).toBeLessThanOrEqual(ZOOM_RANGE[1]);
      expect(Math.abs(D.toNumber(p.x))).toBeLessThanOrEqual(2 ** OFFSET_RANGE[1]);
    }
    expect(randomEmptyView(doc.space, () => false, rand)).toBeNull();
  });
});
