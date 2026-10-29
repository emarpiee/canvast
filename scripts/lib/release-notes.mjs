// The notes of a GitHub release, made from CHANGELOG.md (ADR 0175). The notes are always split into Features and Fixes: a bullet that starts with
// **Fixed:** is a fix; every other bullet (**Added:**, **Changed:**, **Removed:**, or none) is a feature.

/** The section of `version` in the changelog: its title, date and bullets (a bullet's wrapped lines are joined). Null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const head = new RegExp(`^## ${version.replace(/\./g, "\\.")}(?: to [\\d.]+)? — (.*?)(?: \\((\\d{4}-\\d{2}-\\d{2})\\))?\\s*$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const [, title, date] = lines[start].match(head);
  const bullets = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    if (/^- /.test(line)) bullets.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return { title, date: date ?? "", bullets };
}

/**
 * The section of `version` with the bullets of every version after `previousVersion` (the release before it) added: versions that were
 * committed but never released are in their next release's notes. `earlier` names those versions with their titles. Null when `version`
 * has no section.
 */
export function changelogSince(changelog, version, previousVersion) {
  const section = changelogSection(changelog, version);
  if (!section || !previousVersion) return section && { ...section, earlier: [] };
  const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?: to [\d.]+)? — /gm)].map((m) => m[1]);
  const between = versions.filter((v) => olderThan(previousVersion, v) && olderThan(v, version));
  const earlier = between.map((v) => ({ version: v, ...changelogSection(changelog, v) }));
  return { ...section, bullets: [...section.bullets, ...earlier.flatMap((e) => e.bullets)], earlier: earlier.map((e) => `${e.version} (${e.title})`) };
}

/** Features and fixes of a section's bullets. */
export function splitBullets(bullets) {
  const isFix = (b) => /^\*\*Fix(ed)?\b[^*]*:?\*\*/i.test(b);
  return { features: bullets.filter((b) => !isFix(b)), fixes: bullets.filter(isFix) };
}

const list = (items, none) => (items.length ? items.map((b) => `- ${b}`).join("\n") : `- ${none}`);

/** The release notes: the title line, Features, Fixes (both always there), and what to download. */
/** `desktop`: whether the release also gets the desktop app's packages (the Release packages workflow adds them). */
export function releaseNotes({ version, section, sha256, size, previousTag, repo, desktop = false }) {
  const { features, fixes } = splitBullets(section.bullets);
  const mb = (size / 1024 / 1024).toFixed(2);
  return [
    `## ${section.title}${section.date ? ` (${section.date})` : ""}`,
    "",
    ...(section.earlier?.length ? [`With the changes of ${section.earlier.join(", ")}, which had no release of their own.`, ""] : []),
    "### Features",
    list(features, "Nothing new in this release."),
    "",
    "### Fixes",
    list(fixes, "No fixes in this release."),
    "",
    "### Download",
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
    ...(previousTag ? ["", `**Full changelog:** https://github.com/${repo}/compare/${previousTag}...v${version}`] : []),
    "",
  ].join("\n");
}

/** Whether version a is older than b (both "x.y.z"). */
export function olderThan(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}
