import { describe, expect, it } from "vitest";
import { duplicateRecords } from "../../src/doc/duplicate";
import type { SerializedObject } from "../../src/doc/model";

const rec = (id: string, extra: Record<string, unknown> = {}): SerializedObject => ({ id, kind: "path", ax: "0", ay: "0", ...extra });

describe("a copy of a canvas's stored objects (ADR 0110)", () => {
  it("gives every object a new id and points every link at the copies", () => {
    let n = 0;
    const gen = () => `n${++n}`;
    const [sheet, kid, text] = duplicateRecords(
      [
        rec("a1", { container: { clip: true } }),
        rec("b2", { parent: "a1", attachmentTargetId: "a1", groups: ["g1"], groupNames: { g1: "Pair" }, boolOps: { g1: "union" } }),
        { id: "c3", kind: "text", ax: "0", ay: "0", md: "plain words" },
      ],
      gen,
    );
    expect(new Set([sheet!.id, kid!.id, text!.id]).size).toBe(3);
    expect([sheet!.id, kid!.id, text!.id].some((i) => ["a1", "b2", "c3"].includes(i))).toBe(false);
    expect(kid!["parent"]).toBe(sheet!.id);
    expect(kid!["attachmentTargetId"]).toBe(sheet!.id);
    const g = (kid!["groups"] as string[])[0]!;
    expect(g).not.toBe("g1");
    expect(kid!["groupNames"]).toEqual({ [g]: "Pair" });
    expect(kid!["boolOps"]).toEqual({ [g]: "union" });
  });
});
