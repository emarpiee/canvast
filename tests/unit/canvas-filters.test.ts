import { describe, expect, it } from "vitest";
import { parseCanvasFilter, type CanvasContext } from "../../src/search/canvas-filters";
import type { CanvasObject } from "../../src/doc/model";

describe("canvas search keywords", () => {
  const ctx: CanvasContext = { sheetName: (id) => (id === "s1" ? "page one" : undefined), onScreen: (o) => o.id !== "far" };
  const base = { id: "a", opacity: 1, attachmentTargetId: null } as const;
  const shape = { ...base, kind: "path", fill: "#e11d1d", stroke: { type: "linear", x0: 0, y0: 0, x1: 1, y1: 0, stops: [{ o: 0, c: "#2563eb" }, { o: 1, c: "#ffffff" }] }, parent: "s1", groups: ["g"], groupNames: { g: "Heads" }, locked: true } as unknown as CanvasObject;
  const text = { ...base, id: "far", kind: "text", color: "#111111" } as unknown as CanvasObject;
  const video = { ...base, kind: "image", media: { kind: "video", t: 0, repeat: false } } as unknown as CanvasObject;
  const t = (w: string, o: CanvasObject) => parseCanvasFilter(w)!(o, ctx);
  it("kind:, group:, in: and is:", () => {
    expect(t("kind:shape", shape)).toBe(true);
    expect(t("kind:video", video)).toBe(true);
    expect(t("kind:picture", video)).toBe(false);
    expect(t("group:head", shape)).toBe(true);
    expect(t("in:page", shape)).toBe(true);
    expect(t("in:page", text)).toBe(false);
    expect(t("is:locked", shape)).toBe(true);
    expect(t("is:offscreen", text)).toBe(true);
    expect(t("is:offscreen", shape)).toBe(false);
    expect(parseCanvasFilter("is:nonsense")).toBeNull();
    expect(parseCanvasFilter("kind:nonsense")).toBeNull();
    expect(parseCanvasFilter("cat")).toBeNull();
  });
  it("fill: and stroke: match a colour name or a hex colour, a gradient by any stop", () => {
    expect(t("fill:red", shape)).toBe(true);
    expect(t("fill:blue", shape)).toBe(false);
    expect(t("stroke:blue", shape)).toBe(true);
    expect(t("stroke:#2563eb", shape)).toBe(true);
    expect(t("colour:blue", shape)).toBe(true);
    expect(t("fill:black", text)).toBe(true);
  });
});
