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

/** Features and fixes of a section's bullets. */
export function splitBullets(bullets) {
  const isFix = (b) => /^\*\*Fix(ed)?\b[^*]*:?\*\*/i.test(b);
  return { features: bullets.filter((b) => !isFix(b)), fixes: bullets.filter(isFix) };
}

const list = (items, none) => (items.length ? items.map((b) => `- ${b}`).join("\n") : `- ${none}`);

/** The release notes: the title line, Features, Fixes (both always there), and what to download. */
export function releaseNotes({ version, section, sha256, size, previousTag, repo, appImage = null }) {
  const { features, fixes } = splitBullets(section.bullets);
  const mb = (size / 1024 / 1024).toFixed(2);
  return [
    `## ${section.title}${section.date ? ` (${section.date})` : ""}`,
    "",
    "### Features",
    list(features, "Nothing new in this release."),
    "",
    "### Fixes",
    list(fixes, "No fixes in this release."),
    "",
    "### Download",
    `**\`canvast.html\`** (${mb} MB) is the whole app in one file: save it anywhere and open it in a browser, no install and no server. SHA-256: \`${sha256}\``,
    ...(appImage
      ? ["", `**\`canvast-${version}-x86_64.AppImage\`** (${(appImage.size / 1024 / 1024).toFixed(1)} MB) is the desktop app for Linux: your workspace is a folder of ordinary files on your disk. Make it executable and run it. SHA-256: \`${appImage.sha256}\``]
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
