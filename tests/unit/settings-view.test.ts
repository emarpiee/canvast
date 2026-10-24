import { describe, expect, it } from "vitest";
import { SETTINGS } from "../../src/settings/settings";
import type { Def } from "../../src/settings/settings";
import { SETTINGS_TABS } from "../../src/ui/settings-view";

describe("settings view table (ADR 0048)", () => {
  const rows = SETTINGS_TABS.flatMap((t) => t.rows ?? []);

  it("lists each setting once and only declared ones", () => {
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(SETTINGS[k], k).toBeDefined();
  });

  it("offers only values the setting accepts: range ends, every option, and the default", () => {
    for (const r of rows) {
      const def = SETTINGS[r.key] as Def<unknown>;
      expect(def.validate(def.default), `${r.key} default`).toBeDefined();
      if (r.control.kind === "range") {
        expect(def.validate(r.control.min), `${r.key} min`).toBeDefined();
        expect(def.validate(r.control.max), `${r.key} max`).toBeDefined();
      } else if (r.control.kind === "select") {
        for (const [v] of r.control.options) expect(def.validate(v), `${r.key} ${v}`).toBeDefined();
      }
    }
  });
});

describe("tool keys (ADR 0049, 0158)", () => {
  it("are the letters the toolbar has always shown, one tool each", async () => {
    const { TOOL_ORDER, TOOL_COMMAND } = await import("../../src/settings/shortcuts");
    const { commandById } = await import("../../src/settings/keymap");
    const keys = TOOL_ORDER.map((t) => commandById(TOOL_COMMAND[t])!.defaults[0]);
    expect(keys).toEqual(["H", "V", "N", "P", "U", "B", "C", "L", "T", "M", "E"]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("friendlyZoom (ADR 0055)", () => {
  it("reads a zoom as a magnification, and very deep ones as a power of ten", async () => {
    const { friendlyZoom } = await import("../../src/app/hud");
    const f = (l: bigint, z: number) => friendlyZoom(l, z);
    expect([f(0n, 0), f(0n, 1), f(3n, 0), f(0n, 0.41), f(-1n, 0), f(10n, 0), f(-3n, 0)]).toEqual(["1×", "2×", "8×", "1.33×", "0.5×", "1,024×", "0.13×"]);
    expect([f(40n, 0), f(-40n, 0), f(3000n, 0)]).toEqual(["10^12×", "10^-12×", "10^903×"]);
  });
});
