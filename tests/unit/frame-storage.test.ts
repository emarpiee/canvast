import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { FrameRecordError, FrameSpace, deserializeFrameCamera, fjump, fpanBy, serializeFrameCamera } from "../../src/core/frames";
import type { Frame, FrameRecord } from "../../src/core/frames";
import { DocumentStore } from "../../src/doc/document-store";
import type { CanvasObject, StrokeObject } from "../../src/doc/model";
import { deserializeObject, homeObject, newObjectId, serializeObject } from "../../src/doc/model";
import { rng } from "./rng";

function stroke(x: D.Dyadic, y: D.Dyadic, unit: number, z: number): StrokeObject {
  return { id: newObjectId(), kind: "stroke", anchor: { x, y }, unit, z, opacity: 1, attachmentTargetId: null, points: [0, 0, 40, 25], width: 3, color: "#102030" };
}

/** What an object is, independent of the tree it lives in: its frame's path from the root and its local numbers. */
function identity(o: CanvasObject): string {
  const path: string[] = [];
  for (let f: Frame | null = o.frame ?? o.id ? (o.frame ?? null) : null; f; f = f.parent) path.push(`${f.n}|${D.toString(f.ox)}|${D.toString(f.oy)}|${f.level}`);
  return `${o.id}|${o.unit}|${D.toString(o.anchor.x)}|${D.toString(o.anchor.y)}|${path.join(">")}`;
}

function scene(seed: number): CanvasObject[] {
  const r = rng(seed);
  const out: CanvasObject[] = [];
  // (Objects a trillion levels coarser than the world are made the way the app makes them: in the camera's frame, below.)
  const depths = [0, 40, -90, 3000, -3000, 20_000, -20_000, 1e6, 1e9, 1e12];
  for (let i = 0; i < 90; i++) {
    const unit = -depths[i % depths.length]! + Math.floor((r() - 0.5) * 70);
    const exp = unit + Math.floor(r() * 8) - 4;
    out.push(stroke(D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 2 ** 30)), exp), D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 2 ** 30)), exp), unit, i));
  }
  return out;
}

describe("frames in storage", () => {
  it("objects at ±10^12 levels and frames above the world: stored frames and objects rebuild the same tree", () => {
    for (const seed of [1, 2, 3]) {
      const doc = new DocumentStore();
      doc.load(scene(seed));
      // Drawn while zoomed far out and far in, in the camera's own frame.
      for (const levels of [-1e12, -4e12, 5e11]) {
        let fc = { f: doc.space.world, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 };
        for (let left = levels; left !== 0; ) {
          const step = Math.sign(left) * Math.min(Math.abs(left), 1e12);
          fc = fjump(doc.space, fc, step);
          left -= step;
        }
        const o = homeObject({ ...stroke(D.fromBigInt(5n, -2), D.fromBigInt(-3n, -1), -Math.floor(fc.z), 100 + levels), frame: fc.f }, doc.space);
        doc.commit(doc.transaction("draw", [o]));
      }
      expect(new Set([...doc.all()].map((o) => o.frame)).size, "many frames").toBeGreaterThan(10);
      const objs = [...doc.all()];
      const records = doc.space.records(objs.flatMap((o) => (o.frame ? [o.frame] : [])));
      const stored = JSON.parse(JSON.stringify({ records, objects: objs.map(serializeObject) }));

      const space = new FrameSpace();
      space.restore(stored.records);
      const back = (stored.objects as ReturnType<typeof serializeObject>[]).map((s) => deserializeObject(s, space));
      expect(back.map(identity).sort()).toEqual(objs.map(identity).sort());
      const again = new DocumentStore();
      again.load(back, space);
      expect([...again.all()].map(identity).sort(), "load keeps objects in their frames").toEqual(objs.map(identity).sort());
      // Stored form is small: no number has more than a few hundred bits.
      for (const s of stored.objects) expect(String(s.ax).length + String(s.ay).length, "frame-local anchor").toBeLessThan(80);
    }
  });

  it("a frame split by the camera (compressed dive) is stored consistently, before and after", () => {
    const doc = new DocumentStore();
    const a = stroke(D.fromBigInt(3n, -1_000_000_000_000), D.ZERO, -1_000_000_000_000, 1);
    doc.load([a]);
    const first = doc.space.records([...doc.all()][0]!.frame ? [[...doc.all()][0]!.frame!] : []);
    // Zoom a camera out to the middle of that dive: the dive frame is split.
    let fc = { f: [...doc.all()][0]!.frame!, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 };
    fc = fjump(doc.space, fc, -5e11);
    const second = doc.space.records([fc.f, [...doc.all()][0]!.frame!]);
    expect(second.length).toBeGreaterThan(first.length);
    const space = new FrameSpace();
    space.restore(JSON.parse(JSON.stringify(second)));
    const o = deserializeObject(JSON.parse(JSON.stringify(serializeObject([...doc.all()][0]!))), space);
    expect(identity(o)).toBe(identity([...doc.all()][0]!));
  });

  it("a saved view round-trips in frame form, at depth, without absolute numbers", () => {
    const doc = new DocumentStore();
    doc.load([stroke(D.ZERO, D.ZERO, 0, 1)]);
    let fc = { f: doc.space.world, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 };
    for (let i = 0; i < 5; i++) fc = fjump(doc.space, fc, 1e12);
    fc = fpanBy(doc.space, fc, 13, -7);
    const view = JSON.parse(JSON.stringify(serializeFrameCamera(fc)));
    expect(view.x.length + view.y.length).toBeLessThan(200);
    const records = JSON.parse(JSON.stringify(doc.space.records([fc.f])));
    const space = new FrameSpace();
    space.restore(records);
    const back = deserializeFrameCamera(space, view);
    expect(D.toString(back.x)).toBe(D.toString(fc.x));
    expect(D.toString(back.y)).toBe(D.toString(fc.y));
    expect([back.z, back.pz, back.f.level]).toEqual([fc.z, fc.pz, fc.f.level]);
  });

  it("damaged frame records are rejected, never half-restored", () => {
    const doc = new DocumentStore();
    doc.load([stroke(D.fromBigInt(1n, 400), D.ZERO, 400, 1), stroke(D.fromBigInt(1n, -400), D.ZERO, -400, 2)]);
    const good: FrameRecord[] = JSON.parse(JSON.stringify(doc.space.records([...doc.all()].flatMap((o) => (o.frame ? [o.frame] : [])))));
    const tries: Array<[string, (r: FrameRecord[]) => FrameRecord[]]> = [
      ["missing parent", (r) => r.filter((x) => x.id !== r.find((y) => y.parent)!.parent)],
      ["cycle", (r) => r.map((x, i) => (i === 0 ? { ...x, parent: r[r.length - 1]!.id } : x))],
      ["duplicate id", (r) => [...r, r[0]!]],
      ["bad level", (r) => r.map((x) => (x.parent ? { ...x, level: "12345" } : x))],
      ["bad number", (r) => r.map((x, i) => (i === 1 ? { ...x, ox: "nope" } : x))],
      ["two roots", (r) => r.map((x) => (x.parent && x.id !== "world" ? { ...x, parent: null } : x))],
    ];
    for (const [what, f] of tries) {
      const space = new FrameSpace();
      expect(() => space.restore(f(JSON.parse(JSON.stringify(good)))), what).toThrow(FrameRecordError);
      expect(space.count, `${what}: nothing was built`).toBe(1);
    }
    // And the good ones restore.
    expect(() => new FrameSpace().restore(good)).not.toThrow();
    // An object naming a frame that is not there is skipped, not placed at the origin.
    expect(() => deserializeObject({ ...serializeObject([...doc.all()][0]!), frame: "nope" }, new FrameSpace())).toThrow();
  });
});
