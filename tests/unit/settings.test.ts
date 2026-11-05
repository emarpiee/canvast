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

  it("takes the settings of a backup only where this device has set none, rejects invalid ones, and keeps them", () => {
    const from = { "pen.widthPx": 12, "pen.color": "#2563eb", "nav.mode": "anywhere", "lasso.filter": "mars", "unknown.key": 1 };
    const st = memory();
    const s = new SettingsStore(st);
    s.set("pen.widthPx", 5); // set here: kept
    expect(s.restorable(from)).toBe(2); // pen.color and nav.mode (width is set here; the invalid and unknown ones are not settings)
    expect(s.restore(from)).toBe(2);
    expect([s.get("pen.widthPx"), s.get("pen.color"), s.get("nav.mode"), s.get("lasso.filter")]).toEqual([5, "#2563eb", "anywhere", "strokes"]);
    expect(new SettingsStore(st).get("nav.mode")).toBe("anywhere"); // stored
    expect(s.restore(from)).toBe(0); // nothing left to take
    expect(s.restore(null)).toBe(0);
    expect(new SettingsStore(memory()).snapshot()).toEqual({}); // defaults are not carried
    expect(s.snapshot()).toEqual({ "pen.widthPx": 5, "pen.color": "#2563eb", "nav.mode": "anywhere" });
  });
});

describe("settings (workspace scope)", () => {
  it("lists only the workspace's settings, takes the workspace's, leaves device settings alone, and tells what changed", () => {
    const s = new SettingsStore(memory());
    s.set("pen.widthPx", 8); // device
    s.set("notes.folder", "Journal"); // workspace
    s.set("library.keepFileNames", false);
    expect(s.workspaceValues()).toEqual({ "notes.folder": "Journal", "library.keepFileNames": false });
    const heard: Array<[string, boolean]> = [];
    s.subscribe((k) => heard.push([k, s.adopting]));
    // Another device's: one changed, one back to the default (absent), an invalid one ignored, a device setting never taken.
    const changed = s.adoptWorkspace({ "notes.folder": "Diary", "storage.trashDays": "nope", "pen.widthPx": 20 });
    expect(changed.sort()).toEqual(["library.keepFileNames", "notes.folder"]);
    expect([s.get("notes.folder"), s.get("library.keepFileNames"), s.get("storage.trashDays"), s.get("pen.widthPx")]).toEqual(["Diary", true, "0", 8]);
    expect(heard.every(([, adopting]) => adopting)).toBe(true);
    expect(s.adopting).toBe(false);
    expect(s.adoptWorkspace({ "notes.folder": "Diary" })).toEqual([]); // the same: nothing told
  });

  it("keeps folder pins as a list of ids, and a hidden-mode saved search on the device only, out of backups unless asked", async () => {
    const s = new SettingsStore(memory());
    expect(s.set("library.pinned", JSON.stringify(["f1", "f2"]))).toBe(true);
    expect(s.set("library.pinned", "[1]")).toBe(false);
    expect(s.set("search.saved.hidden", JSON.stringify([{ q: "cat", m: "all", u: 1 }]))).toBe(true);
    expect(Object.keys(s.workspaceValues())).toEqual(["library.pinned"]);
    const { PRIVACY_KEYS } = await import("../../src/settings/settings");
    expect(PRIVACY_KEYS).toContain("search.saved.hidden");
  });
});
