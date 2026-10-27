import { describe, expect, it } from "vitest";
import { canvasFileHead, readCanvasFile } from "../../src/storage/canvas-file";

const stroke = (id: string, x: number, width = 3) => ({
  id,
  kind: "stroke",
  ax: `${x}p0`,
  ay: "0p0",
  unit: 0,
  z: x,
  opacity: 1,
  attachmentTargetId: null,
  points: [0, 0, 40, 10, 80, -5],
  width,
  color: "#2563eb",
});
const ID = "f".repeat(32);
const file = (over: Record<string, unknown> = {}, objects: unknown[] = [stroke("a".repeat(32), 100)]): string =>
  JSON.stringify({ ...canvasFileHead(ID, 7, "device-1", new Date(0)), ...over, objects, frames: [] });

describe("canvas file (.cvst)", () => {
  it("reads its header and objects; exact coordinates come back exact", () => {
    const r = readCanvasFile(file({}, [stroke("a".repeat(32), 100), stroke("b".repeat(32), 2 ** 60)]), "characters");
    expect(r.head).toEqual({ format: "canvast-canvas", version: 1, id: ID, revision: 7, savedAt: "1970-01-01T00:00:00.000Z", savedBy: "device-1" });
    expect(r.canvas.objects.map((o) => o.id)).toEqual(["a".repeat(32), "b".repeat(32)]);
    expect(r.problems).toEqual([]);
  });

  it("skips a damaged object with a line saying so, and keeps the rest", () => {
    const r = readCanvasFile(file({}, [stroke("a".repeat(32), 1), stroke("c".repeat(32), 2, -1)]), "characters");
    expect(r.canvas.objects.map((o) => o.id)).toEqual(["a".repeat(32)]);
    expect(r.problems.join(" ")).toMatch(/1 damaged object on “characters” was skipped/);
  });

  it("refuses what is not a canvas file, a damaged header and a newer version", () => {
    expect(() => readCanvasFile("{not json", "x")).toThrow(/not JSON/);
    expect(() => readCanvasFile(JSON.stringify({ objects: [] }), "x")).toThrow(/not a canvas file/);
    expect(() => readCanvasFile(file({ id: "../evil" }), "x")).toThrow(/header .* is damaged/);
    expect(() => readCanvasFile(file({ revision: -1 }), "x")).toThrow(/header .* is damaged/);
    expect(() => readCanvasFile(file({ version: 2 }), "x")).toThrow(/newer canvast/);
  });
});
