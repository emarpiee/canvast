import { describe, expect, it } from "vitest";
// @ts-expect-error (a build script, plain JavaScript)
import { changelogSection, olderThan, releaseNotes, splitBullets } from "../../scripts/lib/release-notes.mjs";

const CHANGELOG = `# Changelog

## 0.2.0 — Hiding things (2026-10-27)

- **Added:** hide an item.
- **Changed:** the list is
  wrapped over two lines.
- **Fixed:** the button was yellow.
- A bullet with no word.

## 0.1.0 — First (2026-10-01)

- **Fixed:** only a fix.
`;

describe("release notes", () => {
  it("reads a section of the changelog with its wrapped bullets", () => {
    const s = changelogSection(CHANGELOG, "0.2.0");
    expect(s?.title).toBe("Hiding things");
    expect(s?.date).toBe("2026-10-27");
    expect(s?.bullets).toEqual(["**Added:** hide an item.", "**Changed:** the list is wrapped over two lines.", "**Fixed:** the button was yellow.", "A bullet with no word."]);
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("keeps fixes apart: only **Fixed:** is a fix", () => {
    const { features, fixes } = splitBullets(changelogSection(CHANGELOG, "0.2.0")!.bullets);
    expect(fixes).toEqual(["**Fixed:** the button was yellow."]);
    expect(features).toHaveLength(3);
  });

  it("always has both headings, even when one is empty", () => {
    const only = releaseNotes({ version: "0.1.0", section: changelogSection(CHANGELOG, "0.1.0"), sha256: "ab", size: 1048576, previousTag: null, repo: "o/r" });
    expect(only).toContain("### Features\n- Nothing new in this release.");
    expect(only).toContain("### Fixes\n- **Fixed:** only a fix.");
    const both = releaseNotes({ version: "0.2.0", section: changelogSection(CHANGELOG, "0.2.0"), sha256: "cd", size: 2097152, previousTag: "v0.1.0", repo: "o/r" });
    expect(both.indexOf("### Features")).toBeLessThan(both.indexOf("### Fixes"));
    expect(both).toContain("compare/v0.1.0...v0.2.0");
    expect(both).toContain("SHA-256: `cd`");
  });

  it("orders versions", () => {
    expect(olderThan("0.45.9", "0.46.0")).toBe(true);
    expect(olderThan("0.46.0", "0.46.0")).toBe(false);
    expect(olderThan("1.0.0", "0.99.9")).toBe(false);
  });
});
