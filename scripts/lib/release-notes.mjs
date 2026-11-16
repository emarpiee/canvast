// The notes of a GitHub release, made from CHANGELOG.md (ADR 0175). A summary first (the release's title, a few sentences, its highlights and
// what to know before updating, written by hand in the release's own section), then one part for users and one for developers.
//
// A version's section in the changelog:
//
//   ## 0.61.0 — Short title (2026-11-20)
//
//   One to three sentences: what this release is about.          (the summary: a release has one)
//
//   - **Added:** … ([Move a folder](README.md#move-a-folder))      (for users, each with the README section it is in)
//   - **Changed:** … / **Removed:** … / **Fixed:** …
//   - **Fixed before release:** …   a fix to something not released yet: kept here, never in the notes
//   - **Docs:** …                   the README or its pictures, with no change of the app: kept here, never in the notes
//
//   ### Highlights                  (a release: 3 to 6 lines, what is worth updating for)
//   ### Before you update           (only when something was renamed, removed or changes your data; a patch may have one too)
//   ### For developers              (tests, CI, scripts, build, file formats, the API, dependencies)
//
// The plain bullets come first, then the subsections. A release's notes take in every version since the last release, each bullet once.

const SUBSECTIONS = { highlights: "highlights", "before you update": "before", "for developers": "dev" };

/**
 * The section of `version` in the changelog: its title, date, summary, highlights, what to know before updating, the users' bullets and
 * the developers' (a bullet's wrapped lines are joined). Null when there is none.
 */
export function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const head = new RegExp(`^## ${version.replace(/\./g, "\\.")}(?: to [\\d.]+)? — (.*?)(?: \\((\\d{4}-\\d{2}-\\d{2})\\))?\\s*$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const [, title, date] = lines[start].match(head);
  const out = { title, date: date ?? "", summary: "", highlights: [], before: [], bullets: [], dev: [] };
  let into = "bullets";
  let sub = false;
  let last = null;
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) {
      into = SUBSECTIONS[h[1].toLowerCase()] ?? "bullets";
      sub = true;
      last = null;
      continue;
    }
    if (/^- /.test(line)) {
      out[into].push(line.slice(2).trim());
      last = out[into];
    } else if (/^\s+\S/.test(line) && last?.length) last[last.length - 1] += ` ${line.trim()}`;
    else if (line.trim() && !sub && !out.bullets.length) out.summary += `${out.summary ? " " : ""}${line.trim()}`;
    else if (!line.trim()) last = null;
  }
  return out;
}

/** Each text once, in its first place (the same bullet in a patch and in the release's own section is one). */
const once = (items) => {
  const seen = new Set();
  return items.filter((b) => {
    const k = b.replace(/\s+/g, " ").trim();
    return !seen.has(k) && (seen.add(k), true);
  });
};

/**
 * The section of `version` with what every version after `previousVersion` (the release before it) added: versions that were committed
 * but never released are in their next release's notes, each bullet once. `earlier` lists those versions, oldest last. Null when `version`
 * has no section.
 */
export function changelogSince(changelog, version, previousVersion) {
  const section = changelogSection(changelog, version);
  if (!section || !previousVersion) return section && { ...section, earlier: [] };
  const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?: to [\d.]+)? — /gm)].map((m) => m[1]);
  const between = versions.filter((v) => olderThan(previousVersion, v) && olderThan(v, version));
  const earlier = between.map((v) => changelogSection(changelog, v));
  const all = (key) => once([...section[key], ...earlier.flatMap((e) => e[key])]);
  return { ...section, before: all("before"), bullets: all("bullets"), dev: all("dev"), earlier: between };
}

/**
 * The GitHub issues a release fixes: every "issue #N" (or "issues #N") in its bullets, in order, once each. A bare "#N" is not taken: the
 * changelog also holds colours such as #111111.
 */
export function issuesIn(bullets) {
  const out = [];
  for (const b of bullets) for (const m of b.matchAll(/\bissues?\s+#(\d+)/gi)) if (!out.includes(Number(m[1]))) out.push(Number(m[1]));
  return out;
}

/** The label a fixed issue waits under until the release that carries the fix. */
export const FIXED_LABEL = "fixed: next release";

const KIND = /^\*\*(Added|Changed|Removed|Fixed before release|Fixed|Docs)\b[^*]*?:?\*\*\s*/i;
/** What a bullet is: added, changed, removed, fixed, fixedBefore (not in the notes), docs (not in the notes), or other. */
export function kindOf(bullet) {
  const k = bullet.match(KIND)?.[1]?.toLowerCase();
  return k === "fixed before release" ? "fixedBefore" : (k ?? "other");
}
const shown = (b) => kindOf(b) !== "fixedBefore" && kindOf(b) !== "docs";
/** A bullet without its kind (the heading it is under says it), but for Removed, which a reader must not miss. */
const plain = (b) => (kindOf(b) === "removed" ? b : b.replace(KIND, "").replace(/^./, (c) => c.toUpperCase()));

/** The users' bullets in the notes' three groups (what is never shown is left out). */
export function userGroups(bullets) {
  const list = bullets.filter(shown);
  return {
    added: list.filter((b) => kindOf(b) === "added"),
    improved: list.filter((b) => ["changed", "removed", "other"].includes(kindOf(b))),
    fixed: list.filter((b) => kindOf(b) === "fixed"),
  };
}

/**
 * What stops a release's notes (a minor or major version: x.y.0): no summary, or not 3 to 6 highlights. And what only warns: a users' line
 * with no link to the README section it is in.
 */
export function notesProblems(section, version) {
  const release = /^\d+\.\d+\.0$/.test(version);
  const stop = [];
  if (release && !section.summary) stop.push(`its CHANGELOG section has no summary (one to three sentences under its title)`);
  if (release && (section.highlights.length < 3 || section.highlights.length > 6)) stop.push(`its CHANGELOG section has ${section.highlights.length} highlights under "### Highlights" (3 to 6)`);
  const warn = section.bullets.filter(shown).filter((b) => !/\]\(README\.md#/.test(b)).map((b) => `no README link: ${b.slice(0, 90)}…`);
  return { stop, warn };
}

/** Links to files of the repository work on GitHub's release page too: made whole, at this release's tag. */
const wholeLinks = (text, repo, version) => text.replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, path) => `](https://github.com/${repo}/blob/v${version}/${path})`);

/** The release notes: summary, highlights, before you update, for users, for developers, download, the full list. */
/** `desktop`: whether the release also gets the desktop app's packages (the Release packages workflow adds them). */
export function releaseNotes({ version, section, sha256, size, previousTag, repo, desktop = false }) {
  const { added, improved, fixed } = userGroups(section.bullets);
  const dev = section.dev.filter(shown);
  const items = (list, show = (b) => b) => list.map((b) => `- ${show(b)}`).join("\n");
  const group = (title, list) => (list.length ? [`### ${title}`, "", items(list, plain), ""] : []);
  const mb = (size / 1024 / 1024).toFixed(2);
  const earlier = section.earlier ?? [];
  const range = earlier.length ? `${earlier[earlier.length - 1]} to ${version}` : version;
  const notes = [
    `## ${section.title}${section.date ? ` (${section.date})` : ""}`,
    "",
    ...(section.summary ? [section.summary, ""] : []),
    ...(section.highlights.length ? ["### ✨ Highlights", "", items(section.highlights), ""] : []),
    ...(section.before.length ? ["### ⚠️ Before you update", "", items(section.before), ""] : []),
    "## 👩‍🎨 For users",
    "",
    ...(added.length || improved.length || fixed.length ? [...group("🆕 New", added), ...group("🔧 Improved", improved), ...group("🐛 Fixed", fixed)] : ["Nothing changes for users in this release.", ""]),
    ...(dev.length ? ["## 🛠️ For developers", "", items(dev), ""] : []),
    "## ⬇️ Download",
    "",
    `**\`canvast.html\`** (${mb} MB) is the whole app in one file: save it anywhere and open it in a browser, no install and no server. SHA-256: \`${sha256}\``,
    ...(desktop
      ? [
          "",
          "The desktop app for Linux, whose workspace is a folder of ordinary files on your disk (see the README's Installation section), for x86_64 and aarch64 (ARM64):",
          "",
          "| Format | File |",
          "| --- | --- |",
          `| AppImage (any distribution; updates itself with an AppImage updater) | \`canvast-${version}-<arch>.AppImage\` |`,
          `| Debian, Ubuntu | \`canvast-${version}-<arch>.deb\` |`,
          `| Fedora, RHEL, openSUSE | \`canvast-${version}-<arch>.rpm\` |`,
          `| Any, without installing | \`canvast-${version}-<arch>.tar.gz\` |`,
          "",
          "Each has its SHA-256 beside it (`.sha256`). The packages are built and checked on GitHub's machines and added to this release a few minutes after it is published.",
        ]
      : []),
    "",
    `**Full list:** every change of ${range} in [CHANGELOG.md](CHANGELOG.md)${previousTag ? ` · [what changed in the code](https://github.com/${repo}/compare/${previousTag}...v${version})` : ""}`,
    "",
  ].join("\n");
  return wholeLinks(notes, repo, version);
}

/** Whether version a is older than b (both "x.y.z"). */
export function olderThan(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}
