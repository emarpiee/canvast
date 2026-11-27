import { describe, expect, it } from "vitest";
import { ago } from "../../src/ui/format";

describe("ago", () => {
  const now = new Date(2026, 10, 27, 15, 0).getTime();
  it("says minutes and hours within the day", () => {
    expect(ago(now - 20_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 h ago");
  });
  it("says Yesterday, a weekday within the week, else the date", () => {
    expect(ago(new Date(2026, 10, 26, 9, 0).getTime(), now)).toBe("Yesterday");
    expect(ago(new Date(2026, 10, 23, 9, 0).getTime(), now)).toBe("Mon");
    expect(ago(new Date(2026, 9, 2, 9, 0).getTime(), now)).toBe("2 Oct");
  });
});
