import { describe, expect, it } from "vitest";
import { SettingsStore } from "../../src/settings/settings";

function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("settings (device scope)", () => {
  it("gives defaults, stores valid values, rejects invalid ones and resets", () => {
    const st = memory();
    const s = new SettingsStore(st);
    expect(s.get("pen.widthPx")).toBe(3);
    expect(s.set("pen.widthPx", 8)).toBe(true);
    expect(s.set("pen.widthPx", 9999)).toBe(false); // outside 0.5-128
    expect(s.set("pen.color", "red")).toBe(false);
    expect(s.get("pen.widthPx")).toBe(8);
    expect(new SettingsStore(st).get("pen.widthPx")).toBe(8); // survives a reload
    s.reset("pen.widthPx");
    expect(new SettingsStore(st).get("pen.widthPx")).toBe(3);
  });

  it("falls back to the default for damaged or hand-edited stored values", () => {
    expect(new SettingsStore(memory({ "canvast.settings": "{not json" })).get("ui.view")).toBe("canvas");
    const s = new SettingsStore(memory({ "canvast.settings": JSON.stringify({ "ui.view": "mars", "pen.widthPx": "wide", "pen.color": "#2563eb" }) }));
    expect([s.get("ui.view"), s.get("pen.widthPx"), s.get("pen.color")]).toEqual(["canvas", 3, "#2563eb"]);
  });

  it("adopts the old stand-alone last-view key once, and drops it on the next save", () => {
    const st = memory({ "canvast.view": "assets" });
    const s = new SettingsStore(st);
    expect(s.get("ui.view")).toBe("assets");
    s.set("pen.followZoom", true);
    expect(st.m.has("canvast.view")).toBe(false);
    expect(new SettingsStore(st).get("ui.view")).toBe("assets");
  });

  it("works without storage (private mode): values live for the session", () => {
    const s = new SettingsStore(null);
    s.set("pen.stabilizer.on", true);
    expect(s.get("pen.stabilizer.on")).toBe(true);
  });
});

describe("memory tier (Phase 8)", () => {
  it("gives a device with little memory a smaller default for decoded pictures, and the usual one where memory is not reported", async () => {
    const { decodedMbFor } = await import("../../src/settings/settings");
    expect([0.25, 1, 2].map(decodedMbFor)).toEqual(["128", "128", "128"]);
    expect([3, 4].map(decodedMbFor)).toEqual(["256", "256"]);
    expect([6, 8, undefined].map(decodedMbFor)).toEqual(["384", "384", "384"]);
  });
});
