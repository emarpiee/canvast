import { describe, expect, it } from "vitest";
import { lifetimeOf } from "../../src/ui/notices";

describe("notice lifetime follows its words", () => {
  it("a short success goes quickly, a long one stays to be read, with a cap", () => {
    expect(lifetimeOf({ text: "Copied", kind: "success" })).toBe(2200);
    const long = lifetimeOf({ text: "x".repeat(120), kind: "success" });
    expect(long).toBeGreaterThan(5000);
    expect(lifetimeOf({ text: "x".repeat(2000), kind: "success" })).toBe(8000);
  });
  it("an error and a notice with a button stay longer than the same words alone", () => {
    expect(lifetimeOf({ text: "Could not save", kind: "error" })).toBeGreaterThanOrEqual(6000);
    const t = "Imported 3 files";
    expect(lifetimeOf({ text: t, kind: "info", action: { label: "View", run() {} } })).toBeGreaterThan(lifetimeOf({ text: t, kind: "info" }));
  });
});
