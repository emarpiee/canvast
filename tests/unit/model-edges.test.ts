import { describe, expect, it } from "vitest";
import { EdgeModel, inkSvg } from "../../src/assets/model-edges";
import type { InkSpec } from "../../src/assets/model-edges";

// A cube a unit across, its faces split in two triangles each (as a file has them), its corners apart per face (as an STL has them).
const corners = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]];
const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
const pos: number[] = [];
for (const [a, b, c, d] of quads) for (const i of [a, b, c, a, c, d]) pos.push(...corners[i!]!);
const cube = () => new EdgeModel({ pos: Float32Array.from(pos), faces: Uint32Array.from(pos.map((_, i) => i).filter((i) => i < pos.length / 3)) });

/** Looking at the middle from `eye`, through a flat lens two units tall. */
function spec(eye: [number, number, number], over: Partial<InkSpec> = {}): InkSpec {
  const len = Math.hypot(...eye), z = eye.map((v) => v / len) as [number, number, number];
  const xr = [z[2], 0, -z[0]], xl = Math.hypot(...xr), x = xr.map((v) => v / xl);
  const y = [z[1] * x[2]! - z[2] * x[1]!, z[2] * x[0]! - z[0] * x[2]!, z[0] * x[1]! - z[1] * x[0]!];
  const dot = (a: readonly number[]) => a[0]! * eye[0] + a[1]! * eye[1] + a[2]! * eye[2];
  const view = [x[0]!, y[0]!, z[0], 0, x[1]!, y[1]!, z[1], 0, x[2]!, y[2]!, z[2], 0, -dot(x), -dot(y), -dot(z), 1];
  const near = 0.1, far = 10;
  const proj = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  return {
    w: 200, h: 200, view, proj, persp: false, camPos: eye, camDir: z, near, quick: false,
    outline: true, outlineWidth: 2, creases: true, creaseWidth: 1, creaseAngle: 40, hidden: false,
    tones: "none", toneSpacing: 8, toneStrength: 1, toneWidth: 1, toneAngle: -45, sketch: 0, fade: 0, weight: false,
    lights: [{ dir: [1, 0, 0], power: 1 }], ambient: 0, fill: false,
    ...over,
  };
}
/** Within ten pixels: where a hidden edge meets the outline, a pixel or two of it can count as seen (under the outline's width). */
const near = (got: number, want: number): void => expect(Math.abs(got - want)).toBeLessThan(10);
const ofRole = (d: ReturnType<EdgeModel["draw"]>, role: string) => d.groups.filter((g) => g.role === role);
const lengthOf = (g: { pts: Float32Array; ends: Uint32Array }) => {
  let n = 0, from = 0;
  for (const end of g.ends) {
    for (let j = from + 1; j < end; j++) n += Math.hypot(g.pts[j * 2]! - g.pts[j * 2 - 2]!, g.pts[j * 2 + 1]! - g.pts[j * 2 - 1]!);
    from = end;
  }
  return n;
};

describe("a 3D model's lines from its own edges", () => {
  it("a cube from a corner: its outline is one closed line of six edges, three creases meet in the middle, the edges behind stay out", () => {
    const d = cube().draw(spec([3, 3, 3]));
    const outline = ofRole(d, "contour");
    expect(outline).toHaveLength(1);
    expect(outline[0]!.ends).toHaveLength(1);
    // (six edges of a unit seen from a corner: each √(2/3) long, at 100 pixels a unit)
    near(lengthOf(outline[0]!), 6 * Math.sqrt(2 / 3) * 100);
    const creases = ofRole(d, "crease");
    expect(creases).toHaveLength(1);
    near(lengthOf(creases[0]!), 3 * Math.sqrt(2 / 3) * 100);
    expect(ofRole(d, "hidden")).toHaveLength(0);
    // The faces split in two make no line: they meet flat.
    near(cube().draw(spec([3, 3, 3], { creaseAngle: 1 })).groups.reduce((n, g) => n + lengthOf(g), 0), 9 * Math.sqrt(2 / 3) * 100);
  });

  it("asked for, the three edges behind come too; creases or the outline can be left out", () => {
    const hidden = ofRole(cube().draw(spec([3, 3, 3], { hidden: true })), "hidden");
    near(hidden.reduce((n, g) => n + lengthOf(g), 0), 3 * Math.sqrt(2 / 3) * 100);
    expect(ofRole(cube().draw(spec([3, 3, 3], { creases: false })), "crease")).toHaveLength(0);
    expect(ofRole(cube().draw(spec([3, 3, 3], { outline: false })), "contour")).toHaveLength(0);
    // Face on, a cube is a square: the outline, nothing inside.
    const square = cube().draw(spec([0, 0, 3]));
    near(lengthOf(ofRole(square, "contour")[0]!), 400);
    expect(ofRole(square, "crease")).toHaveLength(0);
  });

  it("tones: hatching where the light does not fall, dots for halftone; the faces in sight make the fill; an SVG keeps each kind in its group", () => {
    const hatched = cube().draw(spec([3, 3, 3], { tones: "hatch" }));
    expect(ofRole(hatched, "tone").length).toBeGreaterThan(0);
    // (lit from the side: of the three faces in sight, the two turned away are hatched, the lit one is not)
    const lit = cube().draw(spec([3, 3, 3], { tones: "hatch", lights: [{ dir: [1, 0, 0], power: 1 }, { dir: [0, 1, 0], power: 1 }, { dir: [0, 0, 1], power: 1 }] }));
    expect(ofRole(lit, "tone")).toHaveLength(0);
    expect(cube().draw(spec([3, 3, 3], { tones: "halftone" })).dots.length).toBeGreaterThan(0);
    const filled = cube().draw(spec([3, 3, 3], { fill: true }));
    expect(filled.fill.length / 6).toBe(6); // (three faces of two triangles)
    const svg = inkSvg(filled, { contour: "#111111", crease: "#222222", hidden: "#333333", hiddenOpacity: 0.4, hiddenDash: 6, tone: "#444444", fill: "#ffffff" }, { background: "#eeeeee" });
    for (const id of ['id="fill"', 'id="creases"', 'id="outline"', 'fill="#eeeeee"']) expect(svg).toContain(id);
  });

  it("a hand-drawn line strays from the edge but keeps its length, a moving view draws coarser but the same lines", () => {
    const plain = lengthOf(ofRole(cube().draw(spec([3, 3, 3])), "contour")[0]!);
    const sketched = ofRole(cube().draw(spec([3, 3, 3], { sketch: 2 })), "contour");
    const total = sketched.reduce((n, g) => n + lengthOf(g), 0);
    expect(total).toBeGreaterThan(plain);
    expect(total).toBeLessThan(plain * 1.2);
    near(lengthOf(ofRole(cube().draw(spec([3, 3, 3], { quick: true })), "contour")[0]!), plain);
  });
});
