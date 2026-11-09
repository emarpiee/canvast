import { describe, expect, it } from "vitest";
import { newLinkObject, withBalloonLinks } from "../../src/doc/balloon-link";
import { newBalloon, type Box } from "../../src/doc/balloon-geometry";
import type { DerivationSource } from "../../src/doc/boolean-group";
import type { CanvasObject, PathObject } from "../../src/doc/model";
import * as D from "../../src/core/dyadic";

const box: Box = [0, 0, 100, 60];
const balloon = (id: string, x: number): PathObject => ({ id, kind: "path", anchor: { x: D.fromNumber(x), y: D.fromNumber(0) }, unit: 0, z: 1, fill: "#ffffff", stroke: "#000000", width: 2, sub: [], shape: "balloon", params: { box, balloon: newBalloon(box) } }) as unknown as PathObject;
const src = (...all: CanvasObject[]): DerivationSource => ({ get: (id) => all.find((o) => o.id === id), all: () => all, space: {} as DerivationSource["space"] });

describe("a connector between balloons", () => {
  const a = balloon("a", 0), b = balloon("b", 300);
  const made = withBalloonLinks(src(a, b), [newLinkObject(a, b)], []).next as PathObject[];
  const link = made.find((o) => o.params?.link && o.params.link.cover === undefined)!;
  it("is made with a cover for the outlines, under one balloon and over the other", () => {
    expect(made.length).toBe(2);
    expect(link.sub.length).toBe(1);
    expect(link.z).toBeLessThan(a.z);
    expect(made.find((o) => o.params!.link!.cover === link.id)!.z).toBeGreaterThan(a.z);
  });
  it("what covers the outlines stays between the bodies; deleting the connector takes it along", () => {
    const cover = made.find((o) => o.params!.link!.cover === link.id)!;
    const xs = cover.sub[0]!.n.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThan(40); // (from a's middle: its edge is 50 away)
    expect(Math.max(...xs)).toBeLessThan(260);
    expect(withBalloonLinks(src(a, b, ...made), [], [link.id]).removed.sort()).toEqual(made.map((o) => o.id).sort());
  });
  it("an end stands where its handle put it", () => {
    const moved = { ...link, params: { ...link.params!, link: { ...link.params!.link!, aAt: [0, 1] as const } } } as PathObject;
    const out = withBalloonLinks(src(a, b, ...made), [moved], []).next.find((o) => o.id === link.id) as PathObject;
    expect(D.toNumber(out.anchor.y)).toBe(60);
  });
  it("follows a balloon that moves, and goes with a removed balloon, cover too", () => {
    const moved = balloon("b", 500);
    const out = withBalloonLinks(src(a, b, ...made), [moved], []).next as PathObject[];
    const again = out.find((o) => o.id === link.id)!;
    expect(Math.max(...again.sub[0]!.n.filter((_, i) => i % 2 === 0))).toBeGreaterThan(Math.max(...link.sub[0]!.n.filter((_, i) => i % 2 === 0)));
    const gone = withBalloonLinks(src(a, b, ...made), [], ["b"]);
    expect(gone.removed.sort()).toEqual([...made.map((o) => o.id), "b"].sort());
  });
});
