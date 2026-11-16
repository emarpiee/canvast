import { describe, expect, it } from "vitest";
// @ts-expect-error (a build script, plain JavaScript)
import { changelogSection, changelogSince, issuesIn, kindOf, notesProblems, olderThan, releaseNotes, userGroups } from "../../scripts/lib/release-notes.mjs";

const CHANGELOG = `# Changelog

## 0.3.0 — Folders (2026-10-28)

Folders move, and the library is quicker.

- **Added:** move a folder. ([Move a folder](README.md#move-a-folder))
- **Fixed:** three.

### Highlights

- Move folders
- A quicker library
- Steadier tests

### For developers

- **Added:** a benchmark.

## 0.2.1 — A patch (2026-10-27)

- **Added:** move a folder. ([Move a folder](README.md#move-a-folder))
- **Fixed before release:** the move dropped a file.
- **Docs:** a new picture.

### Before you update

- Names change once.

## 0.2.0 — Hiding things (2026-10-27)

- **Added:** hide an item.
- **Changed:** the list is
  wrapped over two lines.
- **Removed:** the old button.
- **Fixed:** the button was yellow.
- A bullet with no word.
`;

describe("release notes", () => {
  it("reads a section: its summary, bullets (wrapped lines joined), highlights, before you update and developers' part", () => {
    const s = changelogSection(CHANGELOG, "0.3.0");
    expect(s?.title).toBe("Folders");
    expect(s?.date).toBe("2026-10-28");
    expect(s?.summary).toBe("Folders move, and the library is quicker.");
    expect(s?.bullets).toEqual(["**Added:** move a folder. ([Move a folder](README.md#move-a-folder))", "**Fixed:** three."]);
    expect(s?.highlights).toEqual(["Move folders", "A quicker library", "Steadier tests"]);
    expect(s?.dev).toEqual(["**Added:** a benchmark."]);
    expect(changelogSection(CHANGELOG, "0.2.0")?.bullets[1]).toBe("**Changed:** the list is wrapped over two lines.");
    expect(changelogSection(CHANGELOG, "0.2.1")?.before).toEqual(["Names change once."]);
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("groups the users' bullets as New, Improved and Fixed, and leaves out fixes before release and README-only changes", () => {
    expect(kindOf("**Fixed before release:** x")).toBe("fixedBefore");
    expect(kindOf("**Docs:** x")).toBe("docs");
    const g = userGroups([...changelogSection(CHANGELOG, "0.2.0")!.bullets, ...changelogSection(CHANGELOG, "0.2.1")!.bullets]);
    expect(g.added).toEqual(["**Added:** hide an item.", "**Added:** move a folder. ([Move a folder](README.md#move-a-folder))"]);
    expect(g.improved).toEqual(["**Changed:** the list is wrapped over two lines.", "**Removed:** the old button.", "A bullet with no word."]);
    expect(g.fixed).toEqual(["**Fixed:** the button was yellow."]);
  });

  it("takes in the versions since the last release, each bullet once", () => {
    const s = changelogSince(CHANGELOG, "0.3.0", "0.1.0");
    expect(s.earlier).toEqual(["0.2.1", "0.2.0"]);
    expect(s.bullets.filter((b: string) => b.startsWith("**Added:** move a folder"))).toHaveLength(1);
    expect(s.before).toEqual(["Names change once."]);
    expect(s.highlights).toHaveLength(3);
    expect(changelogSince(CHANGELOG, "0.3.0", "0.2.1").earlier).toEqual([]);
    expect(changelogSince(CHANGELOG, "0.3.0", null).bullets).toHaveLength(2);
  });

  it("lays the notes out: summary, highlights, before you update, for users, for developers, download, the full list", () => {
    const s = changelogSince(CHANGELOG, "0.3.0", "0.1.0");
    const notes = releaseNotes({ version: "0.3.0", section: s, sha256: "ef", size: 1048576, previousTag: "v0.1.0", repo: "o/r", desktop: true });
    const at = (t: string): number => notes.indexOf(t);
    for (const t of ["### ✨ Highlights", "### ⚠️ Before you update", "## 👩‍🎨 For users", "### 🆕 New", "### 🔧 Improved", "### 🐛 Fixed", "## 🛠️ For developers", "## ⬇️ Download", "**Full list:**"]) expect(at(t)).toBeGreaterThan(-1);
    expect(at("Folders move")).toBeLessThan(at("### ✨ Highlights"));
    expect(at("### ✨ Highlights")).toBeLessThan(at("### ⚠️ Before you update"));
    expect(at("## 👩‍🎨 For users")).toBeLessThan(at("## 🛠️ For developers"));
    expect(at("## 🛠️ For developers")).toBeLessThan(at("## ⬇️ Download"));
    // (once each; the kind is the heading's, but Removed stays said; what is not for the notes is not there)
    expect(notes.split("ove a folder. (").length - 1).toBe(1);
    expect(notes).toContain("- Move a folder. ([Move a folder](https://github.com/o/r/blob/v0.3.0/README.md#move-a-folder))");
    expect(notes).toContain("- **Removed:** the old button.");
    expect(notes).not.toContain("dropped a file");
    expect(notes).not.toContain("a new picture");
    expect(notes).toContain("- **Added:** a benchmark.");
    expect(notes).toContain("every change of 0.2.0 to 0.3.0 in [CHANGELOG.md](https://github.com/o/r/blob/v0.3.0/CHANGELOG.md)");
    expect(notes).toContain("compare/v0.1.0...v0.3.0");
    expect(notes).toContain("SHA-256: `ef`");
    expect(notes).toContain("`canvast-0.3.0-<arch>.AppImage`");
    expect(releaseNotes({ version: "0.3.0", section: s, sha256: "ef", size: 1, previousTag: null, repo: "o/r" })).not.toContain("AppImage");
  });

  it("says when nothing changes for users, and leaves out empty groups", () => {
    const log = "## 0.4.1 — Tests (2026-11-01)\n\n### For developers\n\n- **Fixed:** a test.\n";
    const notes = releaseNotes({ version: "0.4.1", section: changelogSection(log, "0.4.1"), sha256: "a", size: 1, previousTag: null, repo: "o/r" });
    expect(notes).toContain("Nothing changes for users in this release.");
    expect(notes).not.toContain("### 🆕 New");
    expect(notes).not.toContain("### ✨ Highlights");
  });

  it("a release (x.y.0) needs its summary and 3 to 6 highlights; a users' line with no README link is said", () => {
    expect(notesProblems(changelogSince(CHANGELOG, "0.3.0", "0.1.0"), "0.3.0").stop).toEqual([]);
    const bare = changelogSection(CHANGELOG, "0.2.0");
    expect(notesProblems(bare, "0.2.0").stop).toHaveLength(2);
    expect(notesProblems(bare, "0.2.1").stop).toEqual([]); // (a patch: no summary needed)
    expect(notesProblems(bare, "0.2.0").warn.length).toBe(5); // (every shown line without a README link)
  });

  it("orders versions", () => {
    expect(olderThan("0.45.9", "0.46.0")).toBe(true);
    expect(olderThan("0.46.0", "0.46.0")).toBe(false);
    expect(olderThan("1.0.0", "0.99.9")).toBe(false);
  });
});

describe("the issues a release fixes (close on release)", () => {
  it("every issue named, once, in order; a colour is no issue", () => {
    expect(issuesIn(["**Fixed:** the slider could not be dragged (GitHub issue #2).", "**Fixed:** two more (issues #7 and issue #12), and #111111 stays a colour.", "**Fixed:** again issue #2."])).toEqual([2, 7, 12]);
    expect(issuesIn(["**Added:** nothing to close."])).toEqual([]);
  });
});
