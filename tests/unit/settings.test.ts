import { describe, expect, it } from "vitest";
import { SettingsStore } from "../../src/settings/settings";
import { keyOwner, releaseStepKeys } from "../../src/settings/shortcuts";

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

describe("step keys W A S D (ADR 0072)", () => {
  it("take back a tool key set to one of them, and leave the others alone", () => {
    const st = memory({ "canvast.settings": JSON.stringify({ "key.pen": "w", "key.lasso": "d", "key.text": "x" }) });
    const s = new SettingsStore(st);
    expect(releaseStepKeys(s).sort()).toEqual(["lasso", "pen"]);
    expect(s.get("key.pen")).toBe("p");
    expect(s.get("key.lasso")).toBe("l");
    expect(s.get("key.text")).toBe("x");
    expect(releaseStepKeys(s)).toEqual([]);
    expect(keyOwner(s, "w", "key.pen")).toBe("Step up");
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
