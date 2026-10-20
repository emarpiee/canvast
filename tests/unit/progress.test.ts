import { describe, expect, it } from "vitest";
import { beginProgress } from "../../src/app/progress";
import type { EditorState } from "../../src/app/editor-state";

/** Just the fields beginProgress uses. */
function fakeEditor() {
  const e = { progressNow: null as { channel: string; text: string; fraction: number | null } | null, progressDone: new Set<string>(), message: "", messageAction: null as unknown, changes: 0, changed() { e.changes++; } };
  return e as typeof e & EditorState;
}

describe("progress notices", () => {
  it("starts at once without a number, then reports a fraction and the stage", () => {
    const e = fakeEditor();
    const p = beginProgress(e, "export", "Exporting the backup");
    expect(e.progressNow).toEqual({ channel: "export", text: "Exporting the backup", fraction: null });
    p.update(0.4, "reading files (4 of 10)");
    expect(e.progressNow).toEqual({ channel: "export", text: "Exporting the backup: reading files (4 of 10) 40%", fraction: 0.4 });
  });

  it("keeps the fraction between 0 and 1 and does not flood: updates inside 80 ms are dropped, except the last (1)", () => {
    const e = fakeEditor();
    const p = beginProgress(e, "x", "Job");
    p.update(5, "over");
    expect(e.progressNow!.fraction).toBe(1);
    const n = e.changes;
    p.update(0.5, "too soon");
    expect(e.changes).toBe(n);
    p.update(1, "end of the stage");
    expect(e.progressNow!.text).toContain("end of the stage");
  });

  it("ends once: done closes the channel and says the result; later calls change nothing", () => {
    const e = fakeEditor();
    const p = beginProgress(e, "export", "Job");
    p.done("Exported a.canvast");
    expect([...e.progressDone]).toEqual(["export"]);
    expect(e.message).toBe("Exported a.canvast");
    e.message = "";
    p.fail("Export failed");
    p.update(0.9);
    expect(e.message).toBe("");
  });

  it("fail closes the channel and says what went wrong", () => {
    const e = fakeEditor();
    beginProgress(e, "import", "Job").fail("Import failed; nothing was changed: x");
    expect([...e.progressDone]).toEqual(["import"]);
    expect(e.message).toMatch(/failed/);
  });
});
