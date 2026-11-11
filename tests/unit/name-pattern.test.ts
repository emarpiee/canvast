import { describe, expect, it } from "vitest";
import { dateOf, fillPattern, formatDate, hasDate, hasNumber, parseDay } from "../../src/doc/name-pattern";

const at = new Date(2026, 10, 11, 14, 30, 5); // 11 November 2026, 14:30:05
const parts = { name: "pumpkin", number: 7, date: at };

describe("name patterns (one rule for Rename and Export)", () => {
  it("a run of # is the number padded to its length; {n} is ##", () => {
    expect(fillPattern("#-{name}", parts)).toBe("7-pumpkin");
    expect(fillPattern("####_{name}", parts)).toBe("0007_pumpkin");
    expect(fillPattern("{n}", parts)).toBe("07");
  });
  it("what a token puts in is not read again: a name with # keeps it", () => {
    expect(fillPattern("{name}-##", { ...parts, name: "draft #2" })).toBe("draft #2-07");
  });
  it("dates in any format of YYYY YY MM DD HH mm ss; other characters stay", () => {
    expect(fillPattern("{date}", parts)).toBe("2026-11-11");
    expect(fillPattern("{date:YYYYMMDD}", parts)).toBe("20261111");
    expect(fillPattern("{date:DD.MM.YY}", parts)).toBe("11.11.26");
    expect(fillPattern("{date:YYYY-MM-DD_HHmm}", parts)).toBe("2026-11-11_1430");
    expect(formatDate(at, "ss")).toBe("05");
  });
  it("a caller's own tokens; an unknown one stays as written", () => {
    expect(fillPattern("{name}-{w}x{h}", { ...parts, values: { w: "640", h: "480" } })).toBe("pumpkin-640x480");
    expect(fillPattern("{nope}", parts)).toBe("{nope}");
  });
  it("which date: today, a day set, or each one's own", () => {
    expect(formatDate(dateOf("fixed", "2025-03-09"))).toBe("2025-03-09");
    expect(formatDate(dateOf("own", "", at.getTime()))).toBe("2026-11-11");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(hasNumber("{name}")).toBe(false);
    expect(hasDate("x-{date:YY}")).toBe(true);
  });
});
