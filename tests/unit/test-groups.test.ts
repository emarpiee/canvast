import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
// @ts-expect-error (a plain .mjs script module, no types)
import { GROUPS, affected, checkGroups, groupsFor } from "../../scripts/lib/test-groups.mjs";

const ALL = Object.keys(GROUPS);
const diff = (changed: string): string => `@@\n   "@playwright/test": "1.64.0",\n${changed}`;

describe("test groups", () => {
  it("every spec on disk is in exactly one group", () => {
    const specs = readdirSync("tests/e2e").filter((f) => f.endsWith(".spec.ts")).map((f) => f.slice(0, -".spec.ts".length));
    expect(checkGroups(specs)).toEqual([]);
    expect(checkGroups([...specs, "new-thing"])).toEqual(["tests/e2e/new-thing.spec.ts is in no group: add it to GROUPS in scripts/lib/test-groups.mjs"]);
  });

  it("a change runs the groups that test it; shared code, test machinery and unknown files run every group; docs run none", () => {
    expect(groupsFor("src/storage/library-mirror.ts")).toEqual(["desktop"]);
    expect(groupsFor("src/storage/idb.ts")).toEqual(["storage", "library", "desktop"]);
    expect(groupsFor("src/ui/assets-view.ts")).toEqual(["library"]);
    expect(groupsFor("tests/e2e/vectors.spec.ts")).toEqual(["drawing"]);
    for (const p of ["src/app/main.ts", "src/styles.css", "tests/e2e/harness.ts", "playwright.config.ts", "src/new-folder/x.ts"]) expect(groupsFor(p)).toEqual(ALL);
    for (const p of ["README.md", "docs/adr/0001.md", "tests/unit/x.test.ts", ".gitignore"]) expect(groupsFor(p)).toEqual([]);
  });

  it("package.json: only what builds or runs the tests runs everything (by the changed lines, not the ones around them)", () => {
    expect(groupsFor("package.json", diff('-  "version": "0.48.2",\n+  "version": "0.49.0",'))).toEqual(["smoke"]);
    expect(groupsFor("package.json", diff('+    "electron-builder": "26.17.0",'))).toEqual(["desktop"]);
    expect(groupsFor("package.json", '-    "@playwright/test": "1.63.0",\n+    "@playwright/test": "1.64.0",')).toEqual(ALL);
    expect(groupsFor("package.json")).toEqual(ALL); // (no diff to look at)
  });

  it("smoke always runs; each group says which files asked for it", () => {
    const r = affected(["README.md"]);
    expect([...r.keys()]).toEqual(["smoke"]);
    expect([...affected(["desktop/main.ts", "src/ui/assets-view.ts"]).entries()]).toEqual([["library", ["src/ui/assets-view.ts"]], ["desktop", ["desktop/main.ts"]], ["smoke", ["(always)"]]]);
  });
});
